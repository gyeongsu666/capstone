"""영상·트랙렛 응답 조립과 접근 검사."""
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AuthContext, can_access_case
from app.errors import ApiError
from app.geo import as_geojson, parse_geojson
from app.models import Camera, Node, Tracklet, TrackletEmbedding, Video

CLIP_PADDING_S = 5.0  # 장면 앞뒤 여유(초)
VIDEO_NOT_FOUND = "영상을 찾을 수 없어요."


def analysis_out(v: Video) -> dict[str, Any]:
    return {
        "task_id": v.task_id, "status": v.status, "stage": v.stage, "progress": v.progress, "seq": v.attempt_seq,
        "processed_samples": v.processed_samples, "total_samples": v.total_samples, "skipped_samples": v.skipped_samples,
        "error_code": v.error_code, "message": v.error_message, "heartbeat_at": v.heartbeat_at, "updated_at": v.updated_at,
        "video_id": v.id, "sample_interval_s": v.sample_interval_s, "model_name": v.model_name,
    }


def video_rows(db: Session, stmt) -> list[tuple[Video, Node, Camera, str, int]]:
    """select(Video)에 카메라 이름·위치·방향·트랙렛 수를 붙여 읽는다."""
    count = select(func.count()).select_from(Tracklet).where(Tracklet.video_id == Video.id).scalar_subquery()
    full = stmt.add_columns(Node, Camera, as_geojson(Node.location), count) \
        .join(Node, Node.id == Video.camera_id).join(Camera, Camera.node_id == Video.camera_id)
    return [tuple(r) for r in db.execute(full).all()]


def video_out(v: Video, node: Node, cam: Camera, location_json: str, tracklet_count: int) -> dict[str, Any]:
    return {
        "video_id": v.id, "camera_id": v.camera_id, "camera_name": node.name, "case_id": v.case_id,
        "scope": "case" if v.case_id else "global", "location": parse_geojson(location_json),
        "direction_deg": cam.heading_deg, "recorded_start_at": v.recorded_start_at, "duration_s": v.duration_s,
        "analysis": analysis_out(v), "tracklet_count": tracklet_count,
        "playback_url": f"/api/videos/{v.id}/stream" if v.playback_path else None,
        "lifecycle": v.lifecycle, "retain_until": v.retain_until, "hold": v.hold, "warnings": v.warnings,
        "created_at": v.created_at,
    }


def load_video_out(db: Session, video_id: int) -> dict[str, Any]:
    rows = video_rows(db, select(Video).where(Video.id == video_id))
    return video_out(*rows[0])


def check_video_access(db: Session, auth: AuthContext, video: Video | None) -> Video:
    """관리자 전체, 사건 전용 영상은 그 사건 담당자만, 전역 영상은 로그인 사용자(검색 대상)."""
    if video is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", VIDEO_NOT_FOUND)
    if auth.is_admin:
        return video
    if video.case_id is not None and not can_access_case(db, auth, video.case_id):
        raise ApiError(404, "RESOURCE_NOT_FOUND", VIDEO_NOT_FOUND)
    return video


def ensure_video_ready(video: Video) -> None:
    if video.lifecycle != "active":
        raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
    if video.status != "done":
        raise ApiError(409, "VIDEO_NOT_READY", "영상 분석이 아직 끝나지 않았어요.", context={"video_id": video.id, "current_status": video.status})


def tracklet_out(t: Tracklet, camera_name: str, model_name: str | None) -> dict[str, Any]:
    return {
        "tracklet_id": str(t.id), "video_id": t.video_id, "camera_id": t.camera_id, "camera_name": camera_name,
        "start_at": t.start_at, "end_at": t.end_at, "thumbnail_url": f"/api/tracklets/{t.id}/thumbnail",
        "entry_node_id": t.entry_node_id, "exit_node_id": t.exit_node_id,
        "model_name": model_name or "", "embedding_dimension": 256,
    }


def tracklet_select():
    model = select(TrackletEmbedding.model_name).where(TrackletEmbedding.tracklet_id == Tracklet.id) \
        .order_by(TrackletEmbedding.model_name).limit(1).scalar_subquery()
    return select(Tracklet, Node.name, model).join(Node, Node.id == Tracklet.camera_id)


def clip_window(video: Video, start_at: datetime, end_at: datetime, padding: float = CLIP_PADDING_S) -> tuple[float, float]:
    """원본 시작 기준 초로 장면 구간 ± 여유. 0 ~ 영상 길이 안으로 자른다."""
    duration = float(video.duration_s or 0) or (end_at - video.recorded_start_at).total_seconds() + padding
    start = max(0.0, (start_at - video.recorded_start_at).total_seconds() - padding)
    end = min(duration, (end_at - video.recorded_start_at).total_seconds() + padding)
    if end <= start:
        end = min(duration, start + 1.0) if duration > start else start + 1.0
    return round(start, 3), round(end, 3)


def media_out(video: Video, start_at: datetime, end_at: datetime) -> dict[str, Any]:
    clip_start, clip_end = clip_window(video, start_at, end_at)
    return {
        "video_id": video.id, "playback_url": f"/api/videos/{video.id}/stream", "recorded_start_at": video.recorded_start_at,
        "duration_s": float(video.duration_s or clip_end), "clip_start_s": clip_start, "clip_end_s": clip_end,
        "highlight_url": None, "highlight_status": "not_available",  # 하이라이트 영상은 만들지 않는다(D01)
    }


def trajectory_out(points: list) -> list[dict[str, float]]:
    """DB [offset_s, x, y, w, h] → TrajectoryPoint. 모델 브랜치 옛 형식([offset, cx, cy])은 건너뛴다."""
    out = []
    for p in points:
        if len(p) >= 5 and p[3] > 0 and p[4] > 0:
            out.append({"offset_s": max(0.0, float(p[0])), "x_px": max(0.0, float(p[1])), "y_px": max(0.0, float(p[2])),
                        "width_px": float(p[3]), "height_px": float(p[4])})
    return out
