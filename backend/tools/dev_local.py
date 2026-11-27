"""로컬 PC에서 백엔드 API를 띄워 Front를 실제 서버 모드로 붙여 보는 개발용 실행기(서버 배포용 아님).

- DB: pgserver(내장 PostgreSQL + pgvector, Python 3.11). PostGIS가 없어 tools/pg_stub.py로 바꿔 끼운다
- Redis: fakeredis TCP 서버(작업 접수·로그인 제한용. 워커는 돌지 않는다 → 영상 분석·사진 질의 작업은 대기에 머문다)
- 시연 데이터: Front docs/mock-scenario.md와 같은 도림캠퍼스 카메라 12대·도보 구간 20개·저수지 위험 지역,
  계정 admin/user1/user2(비밀번호 test1234, user2는 첫 로그인 변경), 분석이 끝난 것처럼 만든 영상·트랙렛·썸네일,
  사건 하나(기준 대상 = C1 장면)
사용: ../.venv311/Scripts/python tools/dev_local.py [--reset]   →  http://127.0.0.1:8000/api/docs
Front: .env.local에 VITE_USE_MOCK=false, API_PROXY_TARGET=http://127.0.0.1:8000
"""
import argparse
import math
import os
import random
import shutil
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".localdev"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

# Front 시나리오와 같은 카메라(코드, 이름, 위도, 경도, 방향, 화각)
CAMERAS = [
    ("C1", "대학본부 앞", 34.90853, 126.43424, 70, 90), ("C2", "도서관 앞", 34.90894, 126.43549, 20, 80),
    ("C3", "학생회관 앞", 34.90987, 126.43574, 75, 100), ("C4", "자연과학대학 앞", 34.91019, 126.43718, 15, 70),
    ("C5", "체육관 앞", 34.90697, 126.43381, 0, 90), ("C6", "공과대학 앞", 34.91276, 126.43798, 180, 80),
    ("C7", "사회과학대학 앞", 34.90818, 126.43612, 300, 60), ("C8", "대외협력관 앞", 34.9142, 126.43827, 190, 110),
    ("C9", "고시생활관 앞", 34.90746, 126.43585, 340, 75), ("C10", "인문대학 앞", 34.91097, 126.43531, 120, 90),
    ("C11", "창업보육센터 앞", 34.91358, 126.44082, 230, 100), ("C12", "한울관 앞", 34.9103, 126.44087, 270, 65),
]
EDGES = [("C1", "C2"), ("C1", "C5"), ("C1", "C10"), ("C2", "C3"), ("C2", "C4"), ("C2", "C7"), ("C2", "C9"), ("C3", "C4"),
         ("C3", "C7"), ("C3", "C10"), ("C4", "C6"), ("C4", "C7"), ("C4", "C12"), ("C5", "C9"), ("C6", "C8"), ("C6", "C10"),
         ("C6", "C11"), ("C7", "C9"), ("C8", "C11"), ("C11", "C12")]
# 실종자 동선(분 전) C1 → C2 → C3 → C4 → C6, 함정(비슷한 옷) C7·C5·C8·C11
TRUE_PATH = [("C1", 69, 0.96), ("C2", 56, 0.86), ("C3", 38, 0.82), ("C4", 31, 0.79), ("C6", 26, 0.77)]
DECOYS = [("C7", 35, 0.72), ("C5", 30, 0.68), ("C8", 24, 0.66), ("C11", 20, 0.64)]
MODEL = "person-reidentification-retail-0287"


def offset(lat, lng, bearing_deg, dist_m):
    b = math.radians(bearing_deg)
    return lat + dist_m * math.cos(b) / 110_540, lng + dist_m * math.sin(b) / (111_320 * math.cos(math.radians(lat)))


def unit_vec(sim: float, seed: int) -> list[float]:
    """기준 벡터 e0와 코사인 유사도가 sim인 256차원 단위 벡터(나머지 성분은 무작위)."""
    rnd = random.Random(seed)
    rest = [rnd.gauss(0, 1) for _ in range(255)]
    n = math.sqrt(sum(x * x for x in rest))
    k = math.sqrt(max(0.0, 1 - sim * sim))
    return [sim] + [x / n * k for x in rest]


def thumbnail(path: Path, color: tuple[int, int, int], seed: int) -> None:
    """사람 모양 그림(실제 사진 아님)."""
    from PIL import Image, ImageDraw

    rnd = random.Random(seed)
    im = Image.new("RGB", (128, 256), (rnd.randint(150, 200),) * 3)
    d = ImageDraw.Draw(im)
    d.ellipse((44, 18, 84, 58), fill=(230, 200, 170))
    d.rectangle((36, 62, 92, 160), fill=color)
    d.rectangle((40, 160, 62, 240), fill=(50, 50, 70))
    d.rectangle((66, 160, 88, 240), fill=(50, 50, 70))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "JPEG", quality=85)


def start_postgres(reset: bool) -> str:
    import pgserver

    pgdir = STATE / "pg"
    if reset and STATE.exists():
        shutil.rmtree(STATE, ignore_errors=True)
    fresh = not pgdir.exists()
    pgdir.mkdir(parents=True, exist_ok=True)
    srv = pgserver.get_server(str(pgdir), cleanup_mode="stop")
    if fresh:
        srv.psql("CREATE DATABASE left_dev;")
    uri = srv.get_uri().rsplit("/", 1)[0] + "/left_dev"
    return uri, fresh


def start_redis(port: int) -> None:
    from fakeredis import TcpFakeServer

    server = TcpFakeServer(("127.0.0.1", port), server_type="redis")
    threading.Thread(target=server.serve_forever, daemon=True).start()


def seed(raw_uri: str) -> None:
    import psycopg

    from pg_stub import without_postgis

    sql = (ROOT / "alembic/versions/0001_initial.sql").read_text(encoding="utf-8")
    with psycopg.connect(raw_uri, autocommit=True) as conn:
        conn.execute(without_postgis(sql))

    from app.db import session_scope
    from app.geo import haversine_m
    from app.models import (
        Camera, Case, CaseAssignee, HazardZone, Node, RetentionPolicy, RouteEdge, SystemSettings, Task, Tracklet,
        TrackletEmbedding, User, Video,
    )
    from app.cli import DEMO_RETENTION, DEMO_SETTINGS
    from app.media import abs_path
    from app.security import hash_password
    from sqlalchemy import update

    now = datetime.now(timezone.utc).replace(microsecond=0)
    with session_scope() as db:
        db.execute(update(SystemSettings).values(**{**DEMO_SETTINGS, "out_of_filter_threshold": 0.85}))
        db.execute(update(RetentionPolicy).values(**DEMO_RETENTION))
        users = {}
        for username, name, role, must in [("admin", "관리자", "admin", False), ("user1", "김수색", "user", False),
                                           ("user2", "박수색", "user", True)]:
            u = User(username=username, display_name=name, role=role, must_change_password=must,
                     password_hash=hash_password("test1234"))
            db.add(u)
            db.flush()
            users[username] = u.id
        ids, points = {}, {}
        for code, name, lat, lng, direction, fov in CAMERAS:
            n = Node(kind="camera", name=f"{code} {name}", location=f"SRID=4326;POINT({lng} {lat})")
            db.add(n)
            db.flush()
            db.add(Camera(node_id=n.id, heading_deg=direction, fov_deg=fov, edge_node_map={},
                          stream_url="file:///data/media/demo/stream.mp4" if code == "C10" else None))
            ids[code], points[code] = n.id, (lng, lat)
        for a, b in EDGES:
            x, y = sorted((ids[a], ids[b]))
            straight = haversine_m(points[a], points[b])
            manual = {a, b} == {"C1", "C5"}
            dist = 300.0 if manual else round(straight * 1.3, 1)
            pa, pb = (points[a], points[b]) if ids[a] == x else (points[b], points[a])
            db.add(RouteEdge(from_node_id=x, to_node_id=y, distance_m=dist, duration_s=round(dist / 1.2, 1),
                             path=f"SRID=4326;LINESTRING({pa[0]} {pa[1]}, {pb[0]} {pb[1]})",
                             source="manual" if manual else "api", status="ok", straight_distance_m=round(straight, 1),
                             suspected_detour=False, error_code=None if manual else "STRAIGHT_LINE_ESTIMATE"))
            db.flush()
        lat0, lng0 = 34.90453, 126.43489
        ring = [offset(lat0, lng0, i * 36, 190 if i % 2 == 0 else 150) for i in range(10)]
        ring.append(ring[0])
        db.add(HazardZone(name="도림제(저수지)", kind="water", severity="high", description="캠퍼스 남쪽 저수지",
                          area="SRID=4326;POLYGON((" + ", ".join(f"{lng} {lat}" for lat, lng in ring) + "))"))
        db.flush()

        start = now - timedelta(minutes=80)
        videos = {}
        for code, *_ in CAMERAS[:-1]:  # C12는 영상 없음
            v = Video(camera_id=ids[code], file_path=f"demo/{code}.mp4", recorded_start_at=start, duration_s=3600, fps=25,
                      width_px=1920, height_px=1080, status="done", stage="done", progress=100, attempt_seq=1,
                      model_name=MODEL, total_samples=90000, processed_samples=90000)
            db.add(v)
            db.flush()
            # 영상 응답(VideoAnalysis)에는 분석 작업 ID가 꼭 있어야 한다 → 끝난 작업 행도 만든다
            task = Task(kind="video_analysis", video_id=v.id, status="done", stage="done", progress=100,
                        processed_samples=90000, total_samples=90000, created_by=users["admin"])
            db.add(task)
            db.flush()
            v.task_id = task.id
            videos[code] = v
        seq = 0
        query_tracklet = None

        def add_track(code, minutes_ago, sim, color):
            nonlocal seq
            seq += 1
            v = videos[code]
            begin = now - timedelta(minutes=minutes_ago)
            rel = f"tracklets/{v.id}/{seq:05d}/00000.jpg"
            thumbnail(abs_path(rel), color, seq)
            off = (begin - v.recorded_start_at).total_seconds()
            t = Tracklet(video_id=v.id, camera_id=v.camera_id, track_no=seq, start_at=begin, end_at=begin + timedelta(seconds=6),
                         trajectory=[[off, 400, 300, 120, 300], [off + 6, 1400, 320, 120, 300]], thumbnail_path=rel)
            db.add(t)
            db.flush()
            db.add(TrackletEmbedding(tracklet_id=t.id, model_name=MODEL, embedding=unit_vec(sim, seq)))
            return t

        for code, ago, sim in TRUE_PATH:
            t = add_track(code, ago, sim, (200, 30, 30))
            query_tracklet = query_tracklet or t
        for code, ago, sim in DECOYS:
            add_track(code, ago, sim, (190, 60, 50))
        rnd = random.Random(7)
        for code in videos:
            for _ in range(4):
                add_track(code, rnd.randint(10, 75), rnd.uniform(0.1, 0.45), (rnd.randint(20, 120), rnd.randint(60, 160), rnd.randint(80, 200)))
        for v in videos.values():
            v.analysis_metadata = {"demo_metadata": True}

        case = Case(title="김민준 실종", person_type="child", person_name="김민준", person_age=8,
                    last_seen_place_name="대학본부 앞", appearance="빨간 점퍼, 남색 바지",
                    last_seen_at=now - timedelta(minutes=72), last_seen_location=f"SRID=4326;POINT({points['C1'][0]} {points['C1'][1]})",
                    origin_node_id=ids["C1"], owner_id=users["user1"], similarity_threshold=0.6,
                    query_status="ready", query_source="tracklet", query_version=2, query_tracklet_id=query_tracklet.id,
                    query_embedding=unit_vec(1.0, 0), query_model_name=MODEL)
        db.add(case)
        db.flush()
        db.add(CaseAssignee(case_id=case.id, user_id=users["user1"], is_owner=True, assigned_by=users["user1"]))
        db.add(CaseAssignee(case_id=case.id, user_id=users["user2"], is_owner=False, assigned_by=users["user1"]))
    print("시연 데이터를 넣었어요: 카메라 12, 도보 구간 20, 위험 지역 1, 계정 3, 사건 1")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="로컬 DB·미디어를 지우고 처음부터")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uri, fresh = start_postgres(args.reset)
    start_redis(6390)
    os.environ.update({
        "DATABASE_URL": uri.replace("postgresql://", "postgresql+psycopg://", 1),
        "REDIS_URL": "redis://127.0.0.1:6390/0",
        "MEDIA_ROOT": str(STATE / "media"),
        "SESSION_SECRET": "local-dev-secret-" + "x" * 24,
        "ALLOWED_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
        "WALK_ROUTE_PROVIDER": "straight",
    })
    (STATE / "media").mkdir(parents=True, exist_ok=True)
    if fresh:
        seed(uri)
    import uvicorn

    print(f"API: http://127.0.0.1:{args.port}/api/docs  (계정 admin/user1/user2, 비밀번호 test1234)")
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
