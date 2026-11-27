"""5단계 전체 흐름(실제 PostgreSQL): 검색 → 판단 → 동선 → 기준 검색 → 번복(R3) → 범위 → 감시·출현 알림."""
import math
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.db

PT = lambda lon, lat: {"type": "Point", "coordinates": [lon, lat]}  # noqa: E731
T0 = datetime(2026, 11, 20, 0, 0, tzinfo=timezone.utc)
MODEL = "person-reidentification-retail-0287"


def vec(sim: float) -> list[float]:
    """기준 벡터 e0와 코사인 유사도가 sim인 256차원 단위 벡터."""
    v = [0.0] * 256
    v[0], v[1] = sim, math.sqrt(max(0.0, 1 - sim * sim))
    return v


@pytest.fixture
def world(as_user, demo_settings):
    """C1(정문) ─120m─ WP ─80m─ C2(후문). 두 카메라에 분석 끝난 영상과 트랙렛."""
    from sqlalchemy import update

    from app.db import session_scope
    from app.models import RouteEdge, Task, Tracklet, TrackletEmbedding, Video

    admin = as_user("admin", role="admin")
    c1 = admin.post("/api/cameras", {"kind": "camera", "name": "C1 정문", "location": PT(126.0, 34.0), "direction_deg": 90,
                                     "field_of_view_deg": 70}).json()["camera"]["node_id"]
    wp = admin.post("/api/cameras", {"kind": "waypoint", "name": "갈림길", "location": PT(126.0013, 34.0)}).json()["camera"]["node_id"]
    c2 = admin.post("/api/cameras", {"kind": "camera", "name": "C2 후문", "location": PT(126.0022, 34.0), "direction_deg": 270,
                                     "field_of_view_deg": 70,
                                     "edge_node_map": {"top": None, "right": None, "bottom": None, "left": wp}}).json()["camera"]["node_id"]
    ids = {}
    with session_scope() as db:
        db.execute(update(Task).values(status="done", stage="done", progress=100))
        db.add(RouteEdge(from_node_id=c1, to_node_id=wp, distance_m=120, duration_s=100, source="manual", status="ok",
                         path="SRID=4326;LINESTRING(126.0 34.0, 126.0013 34.0)"))
        db.flush()  # 한 번에 여러 줄을 넣으면 ::geography 형변환이 붙는데, 테스트용 DB(PostGIS 없음)에는 그 타입이 없다
        db.add(RouteEdge(from_node_id=wp, to_node_id=c2, distance_m=80, duration_s=66, source="manual", status="ok",
                         path="SRID=4326;LINESTRING(126.0013 34.0, 126.0022 34.0)"))
        db.flush()
        videos = {}
        for cam in (c1, c2):
            v = Video(camera_id=cam, file_path=f"videos/x{cam}.mp4", playback_path=f"videos/x{cam}.mp4", recorded_start_at=T0,
                      duration_s=1200, fps=30, width_px=1920, height_px=1080, status="done", stage="done", progress=100)
            db.add(v)
            db.flush()
            videos[cam] = v.id
        # (이름, 카메라, 시작 초, 유사도, 진입 노드)
        for name, cam, start, sim, entry in [("anchor", c1, 10, 1.0, None), ("good", c2, 220, 0.9, wp),
                                             ("fast", c2, 40, 0.95, wp), ("low", c2, 300, 0.5, wp), ("mid", c2, 400, 0.7, None)]:
            t = Tracklet(video_id=videos[cam], camera_id=cam, track_no=len(ids) + 1, start_at=T0 + timedelta(seconds=start),
                         end_at=T0 + timedelta(seconds=start + 5), entry_node_id=entry, thumbnail_path="tracklets/x.jpg",
                         trajectory=[[start, 10, 10, 50, 100]])
            db.add(t)
            db.flush()
            db.add(TrackletEmbedding(tracklet_id=t.id, model_name=MODEL, embedding=vec(sim)))
            ids[name] = t.id
    user = as_user("user1")
    case = user.post("/api/cases", {"title": "t", "person_type": "adult", "person_name": "홍길동",
                                    "last_seen_at": T0.isoformat(), "last_seen_location": PT(126.0, 34.0)}).json()
    q = user.post(f"/api/cases/{case['case_id']}/query/tracklet", {"tracklet_id": str(ids["anchor"]), "expected_query_version": 1})
    assert q.status_code == 200, q.text
    return admin, user, case["case_id"], ids, (c1, wp, c2)


def search(user, cid, **extra):
    c = user.get(f"/api/cases/{cid}").json()
    body = {"direction": "forward", "expected_query_version": c["query"]["query_version"],
            "expected_conditions_version": c["search_conditions"]["version"], **extra}
    res = user.post(f"/api/cases/{cid}/searches", body)
    assert res.status_code == 201, res.text
    return res.json()


def decide(user, cid, search_id, tid, verdict):
    version = user.get(f"/api/cases/{cid}").json()["version"]
    return user.post(f"/api/cases/{cid}/decisions", {"tracklet_id": str(tid), "search_id": search_id, "verdict": verdict,
                                                     "expected_case_version": version})


def test_search_applies_spatiotemporal_filter_and_reasons(world):
    admin, user, cid, ids, (c1, wp, c2) = world
    run = search(user, cid)
    assert run["status"] == "done" and run["stale"] is False and run["candidate_count"] == 3
    page = user.get(f"/api/cases/{cid}/candidates", params={"search_id": run["search_id"]}).json()
    got = [(i["tracklet"]["tracklet_id"], round(i["similarity"], 2)) for i in page["items"]]
    # fast: 200m를 최대 1.8m/s로 최소 111초인데 40초 만에 → 예외 기준 없음(null)이라 제외 / low: 유사도 기준 미만
    assert got == [(str(ids["anchor"]), 1.0), (str(ids["good"]), 0.9), (str(ids["mid"]), 0.7)]
    good = page["items"][1]["reason"]
    assert good["time_feasible"] is True and good["minimum_travel_time_s"] == pytest.approx(111.1, abs=0.2)
    assert good["reason_codes"] == ["APPEARANCE_MATCH", "TIME_FEASIBLE"] and good["threshold"] == pytest.approx(0.6)
    assert page["items"][1]["decision"] is None and page["search"]["search_id"] == run["search_id"]
    case = user.get(f"/api/cases/{cid}").json()
    assert case["latest_search"]["search_id"] == run["search_id"] and case["summary"]["pending_count"] == 3


def test_out_of_filter_threshold_includes_fast_candidate(world):
    admin, user, cid, ids, _ = world
    s = admin.get("/api/settings").json()
    admin.patch("/api/settings", {"out_of_filter_threshold": 0.93, "expected_version": s["version"]})
    run = search(user, cid)
    items = user.get(f"/api/cases/{cid}/candidates", params={"search_id": run["search_id"]}).json()["items"]
    fast = next(i for i in items if i["tracklet"]["tracklet_id"] == str(ids["fast"]))
    assert fast["reason"]["time_feasible"] is False and "TIME_REVIEW_REQUIRED" in fast["reason"]["reason_codes"]


def test_decide_route_anchor_reverse_flow(world):
    admin, user, cid, ids, (c1, wp, c2) = world
    run1 = search(user, cid)
    d_anchor = decide(user, cid, run1["search_id"], ids["anchor"], "confirmed")
    assert d_anchor.status_code == 201, d_anchor.text
    dup = decide(user, cid, run1["search_id"], ids["anchor"], "rejected")
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "ALREADY_DECIDED" and "USER1님" in dup.json()["error"]["message"]
    stale_version = user.post(f"/api/cases/{cid}/decisions", {"tracklet_id": str(ids["good"]), "search_id": run1["search_id"],
                                                              "verdict": "confirmed", "expected_case_version": 1})
    assert stale_version.json()["error"]["code"] == "VERSION_CONFLICT"

    # 확정 장면을 기준으로 다음 구간 검색 → 기준 장면 자신은 후보에서 빠지고, 판단은 그 기준에 의존
    run2 = search(user, cid, anchor_decision_id=d_anchor.json()["decision_id"])
    items = user.get(f"/api/cases/{cid}/candidates", params={"search_id": run2["search_id"]}).json()["items"]
    assert str(ids["anchor"]) not in [i["tracklet"]["tracklet_id"] for i in items]
    d_good = decide(user, cid, run2["search_id"], ids["good"], "confirmed").json()
    assert d_good["depends_on_decision_id"] == d_anchor.json()["decision_id"]

    route = user.get(f"/api/cases/{cid}/route").json()
    assert [s["scene_id"] for s in route["scenes"]] == [f"tracklet:{ids['anchor']}", f"tracklet:{ids['good']}"]
    seg = route["segments"][0]
    assert seg["status"] == "estimated" and seg["distance_m"] == 200.0 and len(seg["geometry"]["coordinates"]) == 3
    assert seg["estimated_duration_s"] == pytest.approx(200 / 1.2, abs=0.2)  # 평소 속도
    scene = user.get(f"/api/cases/{cid}/scenes/tracklet:{ids['good']}").json()
    assert scene["scene"]["camera_name"] == "C2 후문" and scene["media"]["clip_start_s"] == 215.0
    assert user.get(f"/api/cases/{cid}").json()["summary"]["confirmed_count"] == 2

    # '예' 번복(사유 없이, 8초 되돌리기) → 후속 장면 재확인 필요, 검색 모두 무효화
    a = user.get(f"/api/cases/{cid}/decisions", params={"verdict": "confirmed"}).json()["items"]
    target = next(d for d in a if d["decision_id"] == d_anchor.json()["decision_id"])
    rev = user.post(f"/api/cases/{cid}/decisions/{target['decision_id']}/reverse", {"expected_version": target["version"]})
    assert rev.status_code == 200, rev.text
    body = rev.json()
    assert body["decision"]["status"] == "reversed" and body["decision"]["reversal_reason"] is None
    assert [s["decision_id"] for s in body["affected_scenes"]] == [d_good["decision_id"]]
    assert set(body["invalidated_search_ids"]) == {run1["search_id"], run2["search_id"]}
    assert user.get(f"/api/cases/{cid}/route").json()["scenes"] == []  # 재확인 필요 장면은 동선에서 빠진다
    assert user.get(f"/api/cases/{cid}/searches/{run2['search_id']}").json()["stale"] is True
    blocked = decide(user, cid, run2["search_id"], ids["mid"], "confirmed")
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "SEARCH_STALE"
    again = user.post(f"/api/cases/{cid}/decisions/{target['decision_id']}/reverse", {"expected_version": target["version"] + 1})
    assert again.json()["error"]["code"] == "DECISION_ALREADY_REVERSED"
    recon = user.get(f"/api/cases/{cid}/decisions", params={"needs_reconfirmation": True}).json()["items"]
    assert [d["decision_id"] for d in recon] == [d_good["decision_id"]]


def test_deferred_reversal_keeps_search_valid(world):
    admin, user, cid, ids, _ = world
    run = search(user, cid)
    d = decide(user, cid, run["search_id"], ids["mid"], "deferred").json()
    rev = user.post(f"/api/cases/{cid}/decisions/{d['decision_id']}/reverse", {"expected_version": d["version"], "reason": "다시 보기"})
    assert rev.json()["invalidated_search_ids"] == [] and rev.json()["decision"]["reversal_reason"] == "다시 보기"
    assert user.get(f"/api/cases/{cid}/searches/{run['search_id']}").json()["stale"] is False
    again = decide(user, cid, run["search_id"], ids["mid"], "confirmed")  # 같은 검색에서 바로 다시 판단(R3)
    assert again.status_code == 201
    blank = user.post(f"/api/cases/{cid}/decisions/{again.json()['decision_id']}/reverse", {"expected_version": 1, "reason": "   "})
    assert blank.status_code == 422


def test_search_area_levels_from_origin_and_from_decision(world):
    admin, user, cid, ids, (c1, wp, c2) = world
    as_of = (T0 + timedelta(seconds=100)).isoformat()
    area = user.get(f"/api/cases/{cid}/search-area", params={"as_of": as_of})
    assert area.status_code == 200, area.text
    a = area.json()
    assert a["basis_decision_id"] is None and a["walking_speed_mps"] == pytest.approx(1.2)
    assert [l["max_travel_time_s"] for l in a["levels"]] == [50.0, 80.0, 100.0]
    assert all(l["geometry"]["type"] in ("Polygon", "MultiPolygon") for l in a["levels"])
    run = search(user, cid)
    decide(user, cid, run["search_id"], ids["good"], "confirmed")
    a2 = user.get(f"/api/cases/{cid}/search-area", params={"as_of": (T0 + timedelta(seconds=600)).isoformat()}).json()
    assert a2["basis_decision_id"] is not None and a2["basis_location"] == PT(126.0022, 34.0)
    assert user.get(f"/api/cases/{cid}/search-area", params={"as_of": "2026-11-20T00:00:00"}).json()["error"]["code"] == "INVALID_AS_OF"


def test_watch_and_alert_decision(world):
    from app.db import session_scope
    from app.models import WatchAlert

    admin, user, cid, ids, (c1, wp, c2) = world
    version = user.get(f"/api/cases/{cid}").json()["version"]
    no_stream = user.put(f"/api/cases/{cid}/watch", {"enabled": True, "expected_case_version": version})
    assert no_stream.status_code == 409 and no_stream.json()["error"]["code"] == "NO_STREAM_CAMERA"
    cam = admin.get("/api/cameras").json()["items"]
    c2_version = next(c["version"] for c in cam if c["node_id"] == c2)
    admin.patch(f"/api/cameras/{c2}", {"stream_url": "file:///data/media/demo/c2.mp4", "expected_version": c2_version})
    on = user.put(f"/api/cases/{cid}/watch", {"enabled": True, "expected_case_version": version})
    assert on.status_code == 200, on.text
    assert on.json()["enabled"] is True and on.json()["status"] == "starting" and on.json()["cameras"][0]["camera_id"] == c2

    with session_scope() as db:
        alert = WatchAlert(case_id=cid, camera_id=c2, detected_at=T0 + timedelta(minutes=30), score=0.84, level="high",
                           snapshot_path="alerts/x.jpg", reason={"threshold": 0.6, "model_name": MODEL, "time_feasible": True,
                                                                 "reason_codes": ["APPEARANCE_MATCH", "TIME_FEASIBLE"], "summary": "s"})
        db.add(alert)
        db.flush()
        aid = alert.id
    items = user.get(f"/api/cases/{cid}/alerts", params={"status": "pending"}).json()["items"]
    assert [i["alert_id"] for i in items] == [str(aid)] and items[0]["camera_name"] == "C2 후문"
    assert user.get("/api/alerts/pending-count").json()["count"] == 1
    res = user.post(f"/api/cases/{cid}/alerts/{aid}/decision", {"decision": "confirmed", "expected_version": 1})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["alert"]["status"] == "confirmed" and body["decision"]["source_type"] == "alert"
    assert body["alert"]["decided_by"]["username"] == "user1"
    twice = user.post(f"/api/cases/{cid}/alerts/{aid}/decision", {"decision": "rejected", "expected_version": 2})
    assert twice.json()["error"]["code"] == "ALERT_ALREADY_DECIDED"
    assert user.get("/api/alerts/pending-count").json()["count"] == 0
    route = user.get(f"/api/cases/{cid}/route").json()
    assert route["scenes"][-1]["scene_id"] == f"alert:{aid}"
    scene = user.get(f"/api/cases/{cid}/scenes/alert:{aid}").json()
    assert scene["media"] is None and scene["media_unavailable_reason"] == "LIVE_ALERT_SNAPSHOT_ONLY"
    # 알림 판단 번복 → 알림은 다시 대기
    d = body["decision"]
    user.post(f"/api/cases/{cid}/decisions/{d['decision_id']}/reverse", {"expected_version": d["version"]})
    assert user.get(f"/api/cases/{cid}/alerts/{aid}").json()["status"] == "pending"
    off_version = user.get(f"/api/cases/{cid}").json()["version"]
    off = user.put(f"/api/cases/{cid}/watch", {"enabled": False, "expected_case_version": off_version})
    assert off.json()["status"] == "stopped"
