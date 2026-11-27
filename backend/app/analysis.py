"""영상 사전 분석(GPU 워커, analysis 대기열): 재생본 변환 → 사람 검출·추적 → 트랙렛·썸네일·Re-ID 벡터 저장.

검출·추적·썸네일 선택·벡터 평균은 모델 브랜치 scripts/tracklet_pipeline.py와 같은 방식이다
(YOLO26n + ByteTrack, ID별 초마다 품질 최고 썸네일, 저장한 JPEG를 Intel Re-ID에 넣어 평균 후 L2 정규화).
바뀐 점: 파일은 MEDIA_ROOT 상대 경로, 궤적은 [offset_s, x, y, w, h], 진입·이탈 노드 기록, 진행률을 DB에 갱신.
"""
import json
import math
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, update

from app.auth import utcnow
from app.config import get_settings
from app.db import session_scope
from app.media import abs_path, rel_path
from app.models import Camera, Task, Tracklet, TrackletEmbedding, Video

EDGE_NEAR = 0.2  # 화면 가장자리에서 이 비율 안쪽이면 그 방향으로 들어오고 나갔다고 본다
PROGRESS_EVERY_S = 2.0


class AnalysisError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code, self.message, self.retryable = code, message, retryable


# ---------------------------------------------------------------- 순수 함수(테스트 대상)
def progress_value(processed: int, total: int | None) -> int:
    """영상 진행 = floor(99 × processed / total). 저장 끝나야 100."""
    if not total:
        return 0
    return min(99, math.floor(99 * processed / total))


def nearest_edge(box: tuple[float, float, float, float], width: int, height: int) -> str | None:
    """bbox(x, y, w, h)의 중심이 가장 가까운 화면 가장자리. 가운데쯤이면 None."""
    x, y, w, h = box
    cx, cy = (x + w / 2) / width, (y + h / 2) / height
    distances = {"left": cx, "right": 1 - cx, "top": cy, "bottom": 1 - cy}
    edge, d = min(distances.items(), key=lambda kv: kv[1])
    return edge if d <= EDGE_NEAR else None


def entry_exit_nodes(trajectory: list[list[float]], edge_map: dict, width: int, height: int) -> tuple[int | None, int | None]:
    """궤적의 처음·마지막 박스가 닿은 가장자리 → cameras.edge_node_map의 인접 노드."""
    if not trajectory:
        return None, None
    first, last = trajectory[0], trajectory[-1]
    entry = nearest_edge(tuple(first[1:5]), width, height)
    exit_ = nearest_edge(tuple(last[1:5]), width, height)
    return (edge_map.get(entry) if entry else None), (edge_map.get(exit_) if exit_ else None)


def mean_vector(vectors: list, np) -> Any:
    v = np.mean(np.asarray(vectors, dtype=np.float32), axis=0)
    n = float(np.linalg.norm(v))
    if not math.isfinite(n) or n == 0:
        raise AnalysisError("EMBEDDING_FAILED", "특징 벡터를 만들지 못했어요.")
    return v / n


# ---------------------------------------------------------------- DB 상태 갱신
def _set(task_id: UUID, video_id: int, **fields: Any) -> bool:
    """이 작업이 아직 영상의 현재 작업일 때만 쓴다(재처리로 바뀐 옛 작업의 쓰기 차단)."""
    now = utcnow()
    with session_scope() as db:
        video = db.get(Video, video_id)
        if video is None or video.task_id != task_id:
            return False
        task_fields = {k: v for k, v in fields.items() if k in ("status", "stage", "progress", "processed_samples",
                                                                 "total_samples", "skipped_samples")}
        db.execute(update(Task).where(Task.id == task_id).values(**task_fields, heartbeat_at=now, updated_at=now,
                                                                 **({"error": fields["error"]} if "error" in fields else {}),
                                                                 **({"result": fields["result"]} if "result" in fields else {})))
        video_fields = {k: v for k, v in fields.items() if k not in ("error", "result")}
        db.execute(update(Video).where(Video.id == video_id).values(**video_fields, heartbeat_at=now, updated_at=now))
    return True


def _fail(task_id: UUID, video_id: int, err: AnalysisError) -> None:
    _set(task_id, video_id, status="failed", stage="failed", error_code=err.code, error_message=err.message,
         error={"code": err.code, "message": err.message, "retryable": err.retryable})


# ---------------------------------------------------------------- 단계
def transcode(src, dst) -> None:
    """브라우저용 H.264 MP4. 프레임 시각을 그대로 두어 원본과 시간이 대응한다."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.stem + ".part.mp4")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast",
           "-crf", "23", "-pix_fmt", "yuv420p", "-vsync", "passthrough", "-movflags", "+faststart", "-an", str(tmp)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=6 * 3600)
        tmp.replace(dst)
    except (subprocess.SubprocessError, OSError) as e:
        tmp.unlink(missing_ok=True)
        raise AnalysisError("TRANSCODE_FAILED", "재생용 영상으로 바꾸지 못했어요.", retryable=True) from e


def load_models():
    """모델 브랜치 코드(모델벤치/search_benchmark.py)의 IntelEncoder와 YOLO26n 가중치를 쓴다."""
    root = get_settings().model_root
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    try:
        import cv2
        import numpy as np
        import torch
        from search_benchmark import IntelEncoder, read_image, resolve_device, save_image
        from ultralytics import YOLO

        device = resolve_device("auto", torch)
        return dict(cv2=cv2, np=np, yolo=YOLO(str(root / "yolo26n.pt")), encoder=IntelEncoder(cv2, np),
                    read_image=read_image, save_image=save_image, device=device)
    except Exception as e:
        raise AnalysisError("MODEL_LOAD_FAILED", f"모델을 불러오지 못했어요({type(e).__name__}).", retryable=True) from e


@dataclass
class Track:
    track_no: int
    start_s: float
    end_s: float
    trajectory: list = field(default_factory=list)
    samples: list = field(default_factory=list)
    vectors: list = field(default_factory=list)
    candidate: dict | None = None
    best_quality: float = -1.0
    thumbnail: str | None = None


def track_people(task_id: UUID, video: Video, m: dict) -> tuple[dict[int, Track], int]:
    cv2, np = m["cv2"], m["np"]
    cap = cv2.VideoCapture(str(abs_path(video.file_path)))
    if not cap.isOpened():
        raise AnalysisError("VIDEO_DECODE_FAILED", "영상을 열지 못했어요.")
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or float(video.fps or 0)
    total = round(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or None
    if not fps or not math.isfinite(fps):
        cap.release()
        raise AnalysisError("VIDEO_DECODE_FAILED", "fps를 읽지 못했어요.")
    out_dir = abs_path(f"tracklets/{video.id}")
    out_dir.mkdir(parents=True, exist_ok=True)
    tracker = out_dir / "bytetrack.yaml"
    tracker.write_text(json.dumps(dict(tracker_type="bytetrack", track_high_thresh=.25, track_low_thresh=.1, new_track_thresh=.25,
                                       track_buffer=90, match_thresh=.8, fuse_score=True)), encoding="utf-8")
    _set(task_id, video.id, stage="analyzing", total_samples=total, sample_interval_s=round(1 / fps, 6),
         model_name=m["encoder"].model_id)
    tracks: dict[int, Track] = {}
    count, skipped, bucket, last_report = 0, 0, None, 0.0

    def flush():
        for t in tracks.values():
            c, t.candidate = t.candidate, None
            if c is None:
                continue
            path = out_dir / f"{t.track_no:05d}" / f"{c['second']:05d}.jpg"
            path.parent.mkdir(parents=True, exist_ok=True)
            m["save_image"](path, c["crop"], cv2)
            t.vectors.append(m["encoder"].embed(m["read_image"](path, cv2, np)))  # 저장한 JPEG 자체를 인코딩
            t.samples.append(dict(second=c["second"], offset_s=c["time"], box=c["box"], confidence=c["confidence"],
                                  quality=c["quality"], path=rel_path(path)))
            if c["quality"] > t.best_quality:
                t.best_quality, t.thumbnail = c["quality"], rel_path(path)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            seconds = count / fps
            second = int(seconds)
            if bucket is not None and second != bucket:
                flush()
            bucket = second
            try:
                result = m["yolo"].track(frame, persist=True, tracker=str(tracker), classes=[0], conf=.1, iou=.7,
                                         imgsz=1280, device=m["device"], verbose=False)[0]
            except Exception:
                skipped += 1  # 손상 프레임은 건너뛴다
                count += 1
                continue
            boxes = result.boxes
            if boxes is not None and boxes.id is not None:
                h, w = frame.shape[:2]
                for no, xyxy, conf in zip(boxes.id.cpu().numpy(), boxes.xyxy.cpu().numpy(), boxes.conf.cpu().numpy()):
                    x1, y1, x2, y2 = map(int, xyxy)
                    x1, x2, y1, y2 = max(0, x1), min(w, x2), max(0, y1), min(h, y2)
                    if x2 <= x1 or y2 <= y1:
                        continue
                    t = tracks.setdefault(int(no), Track(track_no=int(no), start_s=seconds, end_s=seconds))
                    t.end_s = seconds
                    t.trajectory.append([round(seconds, 3), x1, y1, x2 - x1, y2 - y1])
                    crop = frame[y1:y2, x1:x2]
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    quality = float(conf) * math.sqrt(crop.shape[0] * crop.shape[1]) * math.log1p(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
                    if t.candidate is None or quality > t.candidate["quality"]:
                        t.candidate = dict(crop=crop.copy(), quality=quality, second=second, time=round(seconds, 3),
                                           box=[x1, y1, x2 - x1, y2 - y1], confidence=float(conf))
            count += 1
            if seconds - last_report >= PROGRESS_EVERY_S:
                last_report = seconds
                if not _set(task_id, video.id, processed_samples=count, skipped_samples=skipped,
                            progress=progress_value(count, total)):
                    raise AnalysisError("TASK_SUPERSEDED", "다른 작업으로 교체됐어요.")
        flush()
    finally:
        cap.release()
    if count == 0 or count == skipped:
        raise AnalysisError("NO_VALID_FRAMES", "읽을 수 있는 프레임이 없어요.")
    _set(task_id, video.id, processed_samples=count, skipped_samples=skipped, total_samples=total or count)
    return {k: t for k, t in tracks.items() if t.vectors}, count


def save_tracklets(task_id: UUID, video_id: int, tracks: dict[int, Track], model_name: str, np) -> int:
    with session_scope() as db:
        video = db.get(Video, video_id)
        if video is None or video.task_id != task_id:
            raise AnalysisError("TASK_SUPERSEDED", "다른 작업으로 교체됐어요.")
        cam = db.get(Camera, video.camera_id)
        db.execute(delete(Tracklet).where(Tracklet.video_id == video_id))  # 같은 영상의 이전 미완성 결과
        for t in sorted(tracks.values(), key=lambda t: t.track_no):
            entry, exit_ = entry_exit_nodes(t.trajectory, cam.edge_node_map or {}, video.width_px or 1, video.height_px or 1)
            row = Tracklet(video_id=video.id, camera_id=video.camera_id, track_no=t.track_no,
                           start_at=video.recorded_start_at + timedelta(seconds=t.start_s),
                           end_at=video.recorded_start_at + timedelta(seconds=t.end_s),
                           entry_node_id=entry, exit_node_id=exit_, trajectory=t.trajectory,
                           thumbnail_path=t.thumbnail, thumbnail_samples=t.samples)
            db.add(row)
            db.flush()
            db.add(TrackletEmbedding(tracklet_id=row.id, model_name=model_name, embedding=mean_vector(t.vectors, np)))
    return len(tracks)


def run_video_analysis(task_id: str, video_id: int) -> dict:
    tid = UUID(task_id)
    with session_scope() as db:
        video = db.get(Video, video_id)
        if video is None or video.task_id != tid or video.status == "done":
            return {"skipped": True}
        db.execute(update(Task).where(Task.id == tid).values(status="running", stage="preparing", updated_at=utcnow()))
        video.status, video.stage = "running", "preparing"
    try:
        with session_scope() as db:
            video = db.get(Video, video_id)
            db.expunge(video)
        src = abs_path(video.file_path)
        if not src.is_file():
            raise AnalysisError("SOURCE_NOT_FOUND", "원본 영상 파일이 없어요.")
        _set(tid, video_id, stage="converting")
        playback = abs_path(f"videos/{video_id}/playback.mp4")
        transcode(src, playback)
        _set(tid, video_id, playback_path=rel_path(playback))
        m = load_models()
        tracks, frames = track_people(tid, video, m)
        _set(tid, video_id, stage="saving", progress=99)
        n = save_tracklets(tid, video_id, tracks, m["encoder"].model_id, m["np"])
        result = {"video_id": video_id, "tracklet_count": n}
        _set(tid, video_id, status="done", stage="done", progress=100, result=result)
        return result
    except AnalysisError as e:
        if e.code != "TASK_SUPERSEDED":
            _fail(tid, video_id, e)
        return {"failed": e.code}
    except Exception as e:  # 예상 못 한 오류도 작업 상태에 남긴다
        _fail(tid, video_id, AnalysisError("ANALYSIS_FAILED", f"분석 중 오류가 났어요({type(e).__name__}).", retryable=True))
        raise
