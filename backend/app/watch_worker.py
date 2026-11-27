"""알고리즘 H: 실시간 감시 워커(compose의 watch 서비스, `python -m app.watch_worker`).

1. 5초마다 DB에서 감시 중인 사건(기준 벡터·유사도 기준·마지막 확정 장면)과 스트림 카메라를 읽는다(Redis 알림이 오면 바로)
2. 카메라마다 스레드가 스트림을 읽어(file://은 끝나면 처음부터 반복, 시연용) 초당 몇 장만 YOLO + ByteTrack으로 추적
3. 트랙마다 가장 좋은 사람 이미지를 Intel Re-ID로 인코딩해 각 사건 기준 벡터와 코사인 비교
4. 유사도 기준 이상이면 알림(높음 기준 이상 high, 아니면 mid). 같은 트랙은 사건마다 한 번만(DB 고유 제약)
5. 마지막 확정 지점에서 그 카메라까지 시간상 갈 수 있는지(B와 같은 방식)를 근거로 남긴다
카메라 상태는 Redis 심박(watch:camera:<id>, 30초 만료)으로 API에 알린다.
"""
import json
import logging
import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.db import session_scope
from app.media import abs_path, rel_path
from app.models import Camera, Case, Node, SystemSettings, WatchAlert
from app.search_algo import minutes

log = logging.getLogger("watch")
SAMPLE_FPS = 4.0
EVAL_AFTER_FRAMES = 3  # 트랙이 이만큼 보이면 한 번 평가
HEARTBEAT_TTL = 30


# ---------------------------------------------------------------- 순수 함수(테스트 대상)
def classify_level(score: float, threshold: float, high: float | None) -> str | None:
    """유사도 기준 미만이면 알림 없음. 높음 기준 이상 high, 그 밖 mid."""
    if score < threshold:
        return None
    return "high" if high is not None and score >= high else "mid"


def alert_reason(score: float, threshold: float, model_name: str, *, min_travel_s: float | None,
                 available_s: float | None) -> dict:
    feasible = None if min_travel_s is None or available_s is None else available_s >= min_travel_s
    codes = ["APPEARANCE_MATCH"]
    if feasible is True:
        codes.append("TIME_FEASIBLE")
        summary = f"마지막 확정 지점에서 도보 최소 {minutes(min_travel_s)}, {minutes(available_s)} 뒤 나타남"
    elif feasible is False:
        codes.append("TIME_REVIEW_REQUIRED")
        summary = f"도보 최소 {minutes(min_travel_s)}인데 {minutes(available_s)} 만에 나타남(확인 필요)"
    else:
        codes += ["ROUTE_UNKNOWN", "MANUAL_REVIEW_REQUIRED"]
        summary = "이동 시간을 판단할 기준이 없음(직접 확인)"
    return {"similarity": score, "threshold": threshold, "model_name": model_name, "time_feasible": feasible,
            "minimum_travel_time_s": None if min_travel_s is None else round(min_travel_s, 1),
            "available_time_s": None if available_s is None else round(available_s, 1), "reason_codes": codes, "summary": summary}


def cosine(a, b) -> float:
    num = sum(x * y for x, y in zip(a, b))
    den = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return num / den if den else 0.0


# ---------------------------------------------------------------- 감시 설정
@dataclass
class WatchCase:
    case_id: int
    query: list[float]
    threshold: float
    max_speed: float
    last_camera: int | None
    last_time: datetime | None


@dataclass
class Config:
    cases: list[WatchCase] = field(default_factory=list)
    cameras: dict[int, str] = field(default_factory=dict)  # 카메라 id → 스트림 주소
    high: float | None = None
    dist: dict[tuple[int, int], float] = field(default_factory=dict)  # (출발 노드, 카메라) → 유효 거리


def load_config() -> Config:
    from app.tracking_common import active_route_decisions
    from app.walkgraph import dijkstra, load_graph

    cfg = Config()
    with session_scope() as db:
        settings = db.get(SystemSettings, 1)
        cfg.high = settings.alert_high_threshold
        cfg.cameras = dict(db.execute(select(Camera.node_id, Camera.stream_url).join(Node, Node.id == Camera.node_id)
                                      .where(Node.scope == "global", Camera.stream_url.is_not(None))).all())
        graph = load_graph(db)
        for case in db.scalars(select(Case).where(Case.status == "open", Case.watch_enabled, Case.query_status == "ready")).all():
            speeds = {p["person_type"]: p["max_speed_mps"] for p in settings.walking_speed_presets or []}
            route = active_route_decisions(db, case.id)
            last = route[-1] if route else None
            wc = WatchCase(case.id, [float(x) for x in case.query_embedding], case.similarity_threshold,
                           float(speeds.get(case.person_type, 1.5)), last.camera_id if last else case.origin_node_id,
                           last.observed_end_at if last else case.last_seen_at)
            if wc.last_camera in graph.nodes:
                dist, _ = dijkstra(graph, wc.last_camera)
                for cam in cfg.cameras:
                    if cam in dist:
                        cfg.dist[(wc.last_camera, cam)] = dist[cam]
            cfg.cases.append(wc)
    return cfg


def save_alert(wc: WatchCase, camera_id: int, session_id, track_no: int, score: float, level: str, crop, cv2, high,
               cfg: Config, model_name: str) -> None:
    now = datetime.now(timezone.utc)
    d = cfg.dist.get((wc.last_camera, camera_id))
    min_travel = None if d is None else d / wc.max_speed
    available = None if wc.last_time is None else (now - wc.last_time).total_seconds()
    reason = alert_reason(score, wc.threshold, model_name, min_travel_s=min_travel, available_s=available)
    path = abs_path(f"alerts/{wc.case_id}/{uuid4().hex}.jpg")
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), crop)
    with session_scope() as db:
        result = db.execute(insert(WatchAlert).values(
            case_id=wc.case_id, camera_id=camera_id, detected_at=now, score=round(score, 4), level=level,
            snapshot_path=rel_path(path), reason=reason, stream_session_id=session_id, stream_track_no=track_no,
        ).on_conflict_do_nothing(constraint="watch_alerts_track_key"))
        if result.rowcount == 0:
            path.unlink(missing_ok=True)
        else:
            log.info("alert case=%s camera=%s score=%.3f level=%s", wc.case_id, camera_id, score, level)


# ---------------------------------------------------------------- 카메라 스레드
class CameraRunner(threading.Thread):
    def __init__(self, camera_id: int, url: str, shared: dict, models_factory, redis_client):
        super().__init__(daemon=True, name=f"camera-{camera_id}")
        self.camera_id, self.url, self.shared = camera_id, url, shared
        self.models_factory, self.redis = models_factory, redis_client
        self.stop_event = threading.Event()
        self.session_id = uuid4()
        self.seq = 0

    def heartbeat(self, status: str, reason: str | None = None, last_frame: datetime | None = None) -> None:
        self.seq += 1
        payload = {"stream_session_id": str(self.session_id), "seq": self.seq, "status": status, "reason_code": reason,
                   "heartbeat_at": datetime.now(timezone.utc).isoformat(),
                   "last_frame_at": last_frame.isoformat() if last_frame else None}
        try:
            self.redis.set(f"watch:camera:{self.camera_id}", json.dumps(payload), ex=HEARTBEAT_TTL)
        except Exception:
            pass

    def source(self) -> str:
        return self.url[len("file://"):] if self.url.startswith("file://") else self.url

    def run(self) -> None:
        m = self.models_factory()
        cv2, tracker_cfg = m["cv2"], abs_path(f"watch/bytetrack-{self.camera_id}.yaml")
        tracker_cfg.parent.mkdir(parents=True, exist_ok=True)
        tracker_cfg.write_text(json.dumps(dict(tracker_type="bytetrack", track_high_thresh=.25, track_low_thresh=.1,
                                               new_track_thresh=.25, track_buffer=60, match_thresh=.8, fuse_score=True)))
        evaluated: set[int] = set()
        seen: dict[int, int] = {}
        best: dict[int, tuple[float, object]] = {}
        while not self.stop_event.is_set():
            cap = cv2.VideoCapture(self.source())
            if not cap.isOpened():
                self.heartbeat("reconnecting", "STREAM_OPEN_FAILED")
                time.sleep(5)
                continue
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            step = max(1, round(fps / SAMPLE_FPS))
            frame_no, last_beat = 0, 0.0
            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    break  # 파일이면 처음부터 다시(시연용 반복 재생), 스트림이면 재연결
                frame_no += 1
                if frame_no % step:
                    continue
                now = time.monotonic()
                if now - last_beat > 2:
                    self.heartbeat("watching", last_frame=datetime.now(timezone.utc))
                    last_beat = now
                cfg: Config = self.shared["config"]
                if not cfg.cases:
                    continue
                result = m["yolo"].track(frame, persist=True, tracker=str(tracker_cfg), classes=[0], conf=.25,
                                         device=m["device"], verbose=False)[0]
                if result.boxes is None or result.boxes.id is None:
                    continue
                h, w = frame.shape[:2]
                for no, xyxy, conf in zip(result.boxes.id.cpu().numpy(), result.boxes.xyxy.cpu().numpy(), result.boxes.conf.cpu().numpy()):
                    no = int(no)
                    if no in evaluated:
                        continue
                    x1, y1, x2, y2 = map(int, xyxy)
                    x1, x2, y1, y2 = max(0, x1), min(w, x2), max(0, y1), min(h, y2)
                    if x2 - x1 < 16 or y2 - y1 < 32:
                        continue
                    area = float(conf) * math.sqrt((x2 - x1) * (y2 - y1))
                    if area > best.get(no, (-1, None))[0]:
                        best[no] = (area, frame[y1:y2, x1:x2].copy())
                    seen[no] = seen.get(no, 0) + 1
                    if seen[no] < EVAL_AFTER_FRAMES:
                        continue
                    evaluated.add(no)
                    crop = best.pop(no)[1]
                    vector = [float(x) for x in m["encoder"].embed(crop)]
                    for wc in cfg.cases:
                        score = cosine(vector, wc.query)
                        level = classify_level(score, wc.threshold, cfg.high)
                        if level:
                            save_alert(wc, self.camera_id, self.session_id, no, score, level, crop, cv2, cfg.high, cfg,
                                       m["encoder"].model_id)
            cap.release()
            if not self.source().startswith(("rtsp", "http")):
                self.session_id, evaluated, seen, best = uuid4(), set(), {}, {}  # 반복 재생마다 새 세션(같은 트랙 번호 재사용 대비)
        self.heartbeat("stopped")


def main() -> None:
    import redis

    from app.analysis import load_models

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    r = redis.Redis.from_url(get_settings().redis_url)
    shared = {"config": Config()}
    runners: dict[int, CameraRunner] = {}
    pubsub = r.pubsub(ignore_subscribe_messages=True)
    pubsub.subscribe("watch.config_changed")
    while True:
        try:
            cfg = load_config()
        except Exception:
            log.exception("감시 설정을 읽지 못했어요")
            time.sleep(5)
            continue
        shared["config"] = cfg
        wanted = cfg.cameras if cfg.cases else {}
        for cam_id, url in wanted.items():
            runner = runners.get(cam_id)
            if runner is None or not runner.is_alive() or runner.url != url:
                if runner:
                    runner.stop_event.set()
                runners[cam_id] = CameraRunner(cam_id, url, shared, load_models, r)
                runners[cam_id].start()
        for cam_id in list(runners):
            if cam_id not in wanted:
                runners.pop(cam_id).stop_event.set()
        pubsub.get_message(timeout=5.0)  # 변경 알림이 오면 바로, 아니면 5초마다


if __name__ == "__main__":
    main()
