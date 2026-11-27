"""4단계: 영상 등록·조회·재처리, 사건 영상, 기준 대상(사진·트랙렛), 분석 보조 함수."""
import io
from datetime import datetime, timedelta, timezone

import pytest

from app.media import VideoProbe

PT = lambda lon, lat: {"type": "Point", "coordinates": [lon, lat]}  # noqa: E731
START = "2026-11-20T09:00:00+09:00"


@pytest.fixture
def fake_probe(monkeypatch):
    import app.routers.videos as videos

    monkeypatch.setattr(videos, "probe_video", lambda path: VideoProbe(duration_s=60.0, fps=30.0, width=1920, height=1080,
                                                                         format_name="mov,mp4,m4a,3gp,3g2,mj2"))


@pytest.fixture
def setup(as_user, demo_settings, fake_probe):
    admin = as_user("admin", role="admin")
    cam = admin.post("/api/cameras", {"kind": "camera", "name": "C1 정문", "location": PT(126.0, 34.0), "direction_deg": 90,
                                      "field_of_view_deg": 70}).json()["camera"]["camera_id"]
    return admin, cam


def upload(api, cam, data=b"fake-mp4-bytes", name="a.mp4", start=START, idem=None):
    return api.post("/api/videos", files={"file": (name, io.BytesIO(data), "video/mp4")},
                    data={"camera_id": str(cam), "recorded_start_at": start}, idem=idem)


def make_done_video_with_tracklet(video_id, model="person-reidentification-retail-0287", trajectory=None):
    """분석이 끝난 것처럼 트랙렛 하나와 벡터·썸네일을 넣는다."""
    from app.db import session_scope
    from app.media import abs_path
    from app.models import Tracklet, TrackletEmbedding, Video

    with session_scope() as db:
        v = db.get(Video, video_id)
        v.status, v.stage, v.progress = "done", "done", 100
        thumb = f"tracklets/{video_id}/00001/00010.jpg"
        p = abs_path(thumb)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
        t = Tracklet(video_id=video_id, camera_id=v.camera_id, track_no=1,
                     start_at=v.recorded_start_at + timedelta(seconds=10), end_at=v.recorded_start_at + timedelta(seconds=14),
                     trajectory=trajectory or [[10.0, 100, 200, 50, 120], [14.0, 1800, 200, 50, 120]], thumbnail_path=thumb)
        db.add(t)
        db.flush()
        vec = [0.0] * 256
        vec[0] = 1.0
        db.add(TrackletEmbedding(tracklet_id=t.id, model_name=model, embedding=vec))
        return t.id


@pytest.mark.db
def test_upload_video_queues_analysis_and_is_idempotent(setup, sent_tasks):
    admin, cam = setup
    res = upload(admin, cam, idem="k1")
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["status"] == "queued" and body["progress"] == 0 and body["warnings"] == []
    assert sent_tasks[-1]["name"] == "refind.video.analyze.v1" and sent_tasks[-1]["queue"] == "analysis"
    assert sent_tasks[-1]["kwargs"]["video_id"] == body["video_id"]
    again = upload(admin, cam, idem="k1")
    assert again.json() == body  # 같은 파일·같은 키 → 같은 응답, 새 영상 없음
    other = upload(admin, cam, data=b"different", idem="k1")
    assert other.status_code == 409 and other.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    v = admin.get(f"/api/videos/{body['video_id']}").json()
    assert v["analysis"]["status"] == "queued" and v["analysis"]["task_id"] == body["task_id"]
    assert v["scope"] == "global" and v["camera_name"] == "C1 정문" and v["playback_url"] is None
    assert v["location"] == PT(126.0, 34.0) and v["duration_s"] == 60.0

    overlap = upload(admin, cam, data=b"second", start="2026-11-20T09:00:30+09:00")
    assert overlap.json()["warnings"][0]["code"] == "RECORDING_OVERLAP"
    assert overlap.json()["warnings"][0]["related_video_ids"] == [body["video_id"]]

    stats = admin.get("/api/videos/stats").json()
    assert stats["total"] == 2 and stats["by_status"]["queued"] == 2 and stats["by_camera"][0]["camera_id"] == cam
    assert [i["video_id"] for i in admin.get("/api/videos").json()["items"]] == [overlap.json()["video_id"], body["video_id"]]


@pytest.mark.db
def test_upload_validation(setup):
    admin, cam = setup
    bad_ext = upload(admin, cam, name="a.txt")
    assert bad_ext.status_code == 422 and bad_ext.json()["error"]["code"] == "UNSUPPORTED_VIDEO_FORMAT"
    no_cam = upload(admin, 999)
    assert no_cam.status_code == 422 and no_cam.json()["error"]["code"] == "CAMERA_NOT_FOUND"
    future = upload(admin, cam, start="2099-01-01T00:00:00+09:00")
    assert future.json()["error"]["code"] == "INVALID_RECORDED_START_AT"


@pytest.mark.db
def test_retry_only_failed(setup, sent_tasks):
    from app.db import session_scope
    from app.models import Video

    admin, cam = setup
    vid = upload(admin, cam).json()["video_id"]
    busy = admin.post(f"/api/videos/{vid}/analysis", {"reason": "다시"})
    assert busy.status_code == 409
    with session_scope() as db:
        v = db.get(Video, vid)
        v.status, v.stage, v.error_code = "failed", "failed", "TRANSCODE_FAILED"
    ok = admin.post(f"/api/videos/{vid}/analysis", {"reason": "다시"})
    assert ok.status_code == 202, ok.text
    v = admin.get(f"/api/videos/{vid}").json()["analysis"]
    assert v["seq"] == 2 and v["status"] == "queued" and v["error_code"] is None and v["task_id"] == ok.json()["task_id"]
    make_done_video_with_tracklet(vid)
    done = admin.post(f"/api/videos/{vid}/analysis", {"reason": "또"})
    assert done.json()["error"]["code"] == "ANALYSIS_ALREADY_DONE"


@pytest.mark.db
def test_tracklets_scene_thumbnail_and_stream(setup, as_user):
    from app.db import session_scope
    from app.media import abs_path
    from app.models import Video

    admin, cam = setup
    vid = upload(admin, cam).json()["video_id"]
    user = as_user("user1")
    not_ready = user.get(f"/api/videos/{vid}/tracklets")
    assert not_ready.status_code == 409 and not_ready.json()["error"]["code"] == "VIDEO_NOT_READY"
    tid = make_done_video_with_tracklet(vid)
    items = user.get(f"/api/videos/{vid}/tracklets").json()["items"]
    assert items[0]["tracklet_id"] == str(tid) and items[0]["embedding_dimension"] == 256
    assert items[0]["thumbnail_url"] == f"/api/tracklets/{tid}/thumbnail"
    scene = user.get(f"/api/tracklets/{tid}").json()
    assert scene["media"]["clip_start_s"] == 5.0 and scene["media"]["clip_end_s"] == 19.0  # 10~14초 ± 5초
    assert scene["trajectory"][0] == {"offset_s": 10.0, "x_px": 100.0, "y_px": 200.0, "width_px": 50.0, "height_px": 120.0}
    assert scene["source_width_px"] == 1920 and scene["media"]["highlight_status"] == "not_available"
    thumb = user.get(f"/api/tracklets/{tid}/thumbnail")
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"
    assert user.get(f"/api/videos/{vid}/stream").json()["error"]["code"] == "VIDEO_NOT_READY"
    p = abs_path(f"videos/{vid}/playback.mp4")
    p.write_bytes(b"0123456789")
    with session_scope() as db:
        db.get(Video, vid).playback_path = f"videos/{vid}/playback.mp4"
    part = user.get(f"/api/videos/{vid}/stream", headers={"Range": "bytes=2-5"})
    assert part.status_code == 206 and part.content == b"2345"  # 구간 재생
    assert user.get(f"/api/tracklets/{tid}/highlight").status_code == 501


@pytest.mark.db
def test_case_video_creates_case_only_camera(setup, as_user, sent_tasks):
    admin, cam = setup
    owner, stranger = as_user("owner"), as_user("stranger")
    cid = owner.post("/api/cases", {"title": "t", "person_type": "adult", "person_name": "홍길동",
                                    "last_seen_at": "2026-11-20T08:00:00+09:00", "last_seen_location": PT(126.0, 34.0)}).json()["case_id"]
    res = owner.post(f"/api/cases/{cid}/videos", files={"file": ("b.mov", io.BytesIO(b"cctv"), "video/quicktime")},
                     data={"longitude": "126.002", "latitude": "34.001", "direction_deg": "45",
                           "recorded_start_at": START, "camera_name": "편의점 CCTV"})
    assert res.status_code == 202, res.text
    names = [t["name"] for t in sent_tasks]
    assert "refind.video.analyze.v1" in names and names.count("left.walk.recalculate") >= 2
    vid = res.json()["video_id"]
    video = owner.get(f"/api/videos/{vid}").json()
    assert video["scope"] == "case" and video["case_id"] == cid and video["direction_deg"] == 45
    assert stranger.get(f"/api/videos/{vid}").status_code == 404
    assert [v["video_id"] for v in owner.get(f"/api/cases/{cid}/videos").json()["items"]] == [vid]
    global_names = [c["name"] for c in owner.get("/api/cameras").json()["items"]]
    case_names = [c["name"] for c in owner.get("/api/cameras", params={"case_id": cid}).json()["items"]]
    assert "편의점 CCTV" not in global_names and "편의점 CCTV" in case_names
    assert admin.get("/api/videos/stats").json()["total"] == 0  # 사건 전용 영상은 전역 집계에서 제외


def _png(w=64, h=128):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


@pytest.mark.db
def test_query_photo_flow(setup, as_user, sent_tasks):
    admin, cam = setup
    user = as_user("user1")
    case = user.post("/api/cases", {"title": "t", "person_type": "child", "person_name": "김민준",
                                    "last_seen_at": "2026-11-20T08:00:00+09:00", "last_seen_location": PT(126.0, 34.0)}).json()
    cid, v = case["case_id"], case["query"]["query_version"]
    bad = user.post(f"/api/cases/{cid}/query/photo", files={"photo": ("x.png", io.BytesIO(b"not-image"), "image/png")},
                    data={"expected_query_version": str(v)})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_IMAGE"
    ok = user.post(f"/api/cases/{cid}/query/photo", files={"photo": ("x.png", io.BytesIO(_png()), "image/png")},
                   data={"expected_query_version": str(v)})
    assert ok.status_code == 202, ok.text
    assert ok.json()["query_version"] == v + 1 and sent_tasks[-1]["name"] == "left.query.embed"
    assert sent_tasks[-1]["kwargs"] == {"task_id": ok.json()["task_id"], "case_id": cid, "query_version": v + 1}
    c = user.get(f"/api/cases/{cid}").json()
    assert c["query"]["status"] == "queued" and c["query"]["source_type"] == "photo"
    assert c["query"]["photo_url"] == f"/api/cases/{cid}/query/photo"
    busy = user.post(f"/api/cases/{cid}/query/photo", files={"photo": ("x.png", io.BytesIO(_png()), "image/png")},
                     data={"expected_query_version": str(v + 1)})
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "QUERY_UPDATE_IN_PROGRESS"
    stale = user.post(f"/api/cases/{cid}/query/photo", files={"photo": ("x.png", io.BytesIO(_png()), "image/png")},
                      data={"expected_query_version": str(v)})
    assert stale.json()["error"]["code"] == "QUERY_VERSION_CONFLICT"
    img = user.get(f"/api/cases/{cid}/query/photo")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg" and img.content[:2] == b"\xff\xd8"


@pytest.mark.db
def test_query_tracklet_copies_vector(setup, as_user):
    admin, cam = setup
    vid = upload(admin, cam).json()["video_id"]
    tid = make_done_video_with_tracklet(vid)
    user = as_user("user1")
    case = user.post("/api/cases", {"title": "t", "person_type": "child", "person_name": "김민준",
                                    "last_seen_at": "2026-11-20T08:00:00+09:00", "last_seen_location": PT(126.0, 34.0)}).json()
    res = user.post(f"/api/cases/{case['case_id']}/query/tracklet", {"tracklet_id": str(tid), "expected_query_version": 1})
    assert res.status_code == 200, res.text
    q = res.json()
    assert q["status"] == "ready" and q["source_type"] == "tracklet" and q["tracklet_id"] == str(tid)
    assert q["model_name"] == "person-reidentification-retail-0287" and q["embedding_dimension"] == 256 and q["query_version"] == 2
    vid2 = upload(admin, cam, data=b"v2").json()["video_id"]
    other = make_done_video_with_tracklet(vid2, model="osnet")
    mm = user.post(f"/api/cases/{case['case_id']}/query/tracklet", {"tracklet_id": str(other), "expected_query_version": 2})
    assert mm.status_code == 409 and mm.json()["error"]["code"] == "MODEL_MISMATCH"


# ---------------------------------------------------------------- 분석 보조 함수(DB 없음)
def test_progress_is_floor_99_until_saved():
    from app.analysis import progress_value

    assert progress_value(0, 100) == 0 and progress_value(50, 100) == 49 and progress_value(100, 100) == 99
    assert progress_value(5, None) == 0


def test_entry_exit_nodes_from_frame_edges():
    from app.analysis import entry_exit_nodes, nearest_edge

    assert nearest_edge((0, 400, 100, 300), 1920, 1080) == "left"
    assert nearest_edge((900, 400, 100, 200), 1920, 1080) is None  # 화면 가운데
    traj = [[0.0, 10, 400, 80, 300], [3.0, 1830, 400, 80, 300]]
    assert entry_exit_nodes(traj, {"left": 7, "right": 9}, 1920, 1080) == (7, 9)
    assert entry_exit_nodes(traj, {}, 1920, 1080) == (None, None)


def test_pick_person_rules():
    from app.analysis import AnalysisError
    from app.query_worker import pick_person

    assert pick_person([(1, 2, 30, 80)], None) == (1, 2, 30, 80)
    assert pick_person([], [10, 20, 30, 40]) == (10, 20, 40, 60)
    with pytest.raises(AnalysisError) as e:
        pick_person([(0, 0, 1, 1), (2, 2, 3, 3)], None)
    assert e.value.code == "MULTIPLE_PERSONS"
    with pytest.raises(AnalysisError) as e:
        pick_person([], None)
    assert e.value.code == "NO_PERSON_DETECTED"


def test_clip_window_clamps_to_video():
    from types import SimpleNamespace

    from app.video_view import clip_window

    t0 = datetime(2026, 11, 20, tzinfo=timezone.utc)
    v = SimpleNamespace(recorded_start_at=t0, duration_s=20.0)
    assert clip_window(v, t0 + timedelta(seconds=2), t0 + timedelta(seconds=18)) == (0.0, 20.0)
    assert clip_window(v, t0 + timedelta(seconds=8), t0 + timedelta(seconds=9)) == (3.0, 14.0)
