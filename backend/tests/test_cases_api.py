"""4단계: 사건·공동 담당·검색 조건·미처리 알림 집계 (실제 PostgreSQL)."""
import pytest

pytestmark = pytest.mark.db

PT = lambda lon, lat: {"type": "Point", "coordinates": [lon, lat]}  # noqa: E731
CASE = {"title": "김민준 실종", "person_type": "child", "person_name": " 김민준 ", "person_age": 8,
        "last_seen_place_name": "  ", "last_seen_at": "2026-11-20T10:00:00+09:00", "last_seen_location": PT(126.0002, 34.0)}


@pytest.fixture
def world(as_user, demo_settings):
    admin = as_user("admin", role="admin")
    near = admin.post("/api/cameras", {"kind": "waypoint", "name": "정문", "location": PT(126.0, 34.0)}).json()["camera"]["node_id"]
    admin.post("/api/cameras", {"kind": "waypoint", "name": "후문", "location": PT(126.01, 34.01)})
    return admin, near


def test_create_case_fills_defaults_origin_and_owner(world, as_user):
    admin, near = world
    user = as_user("user1")
    res = user.post("/api/cases", CASE)
    assert res.status_code == 201, res.text
    c = res.json()
    assert c["person_name"] == "김민준" and c["last_seen_place_name"] is None  # 공백만 → null
    assert c["origin_node_id"] == near and c["search_conditions"]["similarity_threshold"] == pytest.approx(0.6)
    assert c["search_conditions"]["alert_high_threshold"] == pytest.approx(0.8)
    assert c["query"]["status"] == "not_set" and c["query"]["query_version"] == 1
    assert c["summary"] == {"confirmed_count": 0, "pending_count": None} and c["latest_search"] is None
    assert [a["is_owner"] for a in c["assignees"]] == [True] and c["status"] == "open"


def test_create_case_errors(as_user, demo_settings):
    user = as_user("user1")
    no_nodes = user.post("/api/cases", CASE)
    assert no_nodes.status_code == 409 and no_nodes.json()["error"]["code"] == "NO_MAP_NODES"
    future = user.post("/api/cases", {**CASE, "last_seen_at": "2099-01-01T00:00:00+09:00"})
    assert future.status_code == 422 and future.json()["error"]["code"] == "INVALID_LAST_SEEN_AT"


def test_settings_not_configured_without_default_threshold(as_user):
    admin = as_user("admin", role="admin")
    admin.post("/api/cameras", {"kind": "waypoint", "name": "정문", "location": PT(126.0, 34.0)})
    res = as_user("user1").post("/api/cases", CASE)
    assert res.status_code == 409 and res.json()["error"]["code"] == "SETTINGS_NOT_CONFIGURED"


def test_case_visibility_list_and_404_for_others(world, as_user):
    admin, _ = world
    u1, u2 = as_user("user1"), as_user("user2")
    cid = u1.post("/api/cases", CASE).json()["case_id"]
    assert [c["case_id"] for c in u1.get("/api/cases").json()["items"]] == [cid]
    assert u2.get("/api/cases").json()["items"] == []
    hidden = u2.get(f"/api/cases/{cid}")
    assert hidden.status_code == 404 and hidden.json()["error"]["message"] == "사건을 찾을 수 없거나 접근 권한이 없습니다."
    assert admin.get(f"/api/cases/{cid}").status_code == 200
    assert u1.get("/api/cases", params={"query": "민준"}).json()["items"][0]["case_id"] == cid
    assert u1.get("/api/cases", params={"status": "closed"}).json()["items"] == []


def test_patch_case_version_and_basis_change(world, as_user):
    user = as_user("user1")
    c = user.post("/api/cases", CASE).json()
    stale = user.patch(f"/api/cases/{c['case_id']}", {"title": "x", "expected_version": 9})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "VERSION_CONFLICT"
    ok = user.patch(f"/api/cases/{c['case_id']}", {"person_age": None, "last_seen_location": PT(126.0099, 34.0099),
                                                    "expected_version": c["version"]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["person_age"] is None and ok.json()["origin_node_id"] != c["origin_node_id"]
    assert ok.json()["version"] == c["version"] + 1


def test_assignees_owner_only_and_404_after_removal(world, as_user):
    owner, mate, other = as_user("owner"), as_user("mate"), as_user("other")
    cid = owner.post("/api/cases", CASE).json()["case_id"]
    mate_id = mate.get("/api/auth/me").json()["user"]["user_id"]
    other_id = other.get("/api/auth/me").json()["user"]["user_id"]
    added = owner.post(f"/api/cases/{cid}/assignees", {"user_id": mate_id})
    assert added.status_code == 201 and len(added.json()["items"]) == 2
    dup = owner.post(f"/api/cases/{cid}/assignees", {"user_id": mate_id})
    assert dup.json()["error"]["code"] == "ASSIGNEE_ALREADY_EXISTS"
    assert mate.get(f"/api/cases/{cid}").status_code == 200
    by_mate = mate.post(f"/api/cases/{cid}/assignees", {"user_id": other_id})
    assert by_mate.status_code == 403  # 공동 담당자는 조회만
    owner_id = owner.get("/api/auth/me").json()["user"]["user_id"]
    no = owner.delete(f"/api/cases/{cid}/assignees/{owner_id}")
    assert no.status_code == 409 and no.json()["error"]["code"] == "OWNER_REMOVAL_FORBIDDEN"
    assert owner.delete(f"/api/cases/{cid}/assignees/{mate_id}").status_code == 200
    assert owner.delete(f"/api/cases/{cid}/assignees/{mate_id}").status_code == 200  # 이미 없음 → 현재 목록
    assert mate.get(f"/api/cases/{cid}").status_code == 404  # 권한 회수 즉시


def test_close_case_is_read_only_afterwards(world, as_user):
    user = as_user("user1")
    c = user.post("/api/cases", CASE).json()
    need_found_at = user.post(f"/api/cases/{c['case_id']}/close", {"outcome": "found", "reason": "발견", "expected_version": c["version"]})
    assert need_found_at.status_code == 422
    closed = user.post(f"/api/cases/{c['case_id']}/close", {"outcome": "found", "reason": "발견",
                                                            "found_at": "2026-11-21T09:00:00+09:00", "expected_version": c["version"]})
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed" and closed.json()["close_outcome"] == "found" and closed.json()["watch_enabled"] is False
    again = user.patch(f"/api/cases/{c['case_id']}", {"title": "y", "expected_version": closed.json()["version"]})
    assert again.status_code == 409 and again.json()["error"]["code"] == "CASE_CLOSED"


def test_search_conditions_version(world, as_user):
    user = as_user("user1")
    c = user.post("/api/cases", CASE).json()
    cond = user.get(f"/api/cases/{c['case_id']}/search-conditions").json()
    assert cond["version"] == 1
    res = user.patch(f"/api/cases/{c['case_id']}/search-conditions", {"similarity_threshold": 0.7, "expected_version": 1})
    assert res.status_code == 200 and res.json()["version"] == 2 and res.json()["similarity_threshold"] == pytest.approx(0.7)
    stale = user.patch(f"/api/cases/{c['case_id']}/search-conditions", {"similarity_threshold": 0.65, "expected_version": 1})
    assert stale.status_code == 409


def test_pending_alert_count_scoped_and_sorted(world, as_user):
    from app.db import session_scope
    from app.models import Camera, WatchAlert

    admin, near = world
    u1 = as_user("user1")
    a = u1.post("/api/cases", CASE).json()["case_id"]
    b = u1.post("/api/cases", CASE).json()["case_id"]
    cam = admin.post("/api/cameras", {"kind": "camera", "name": "C", "location": PT(126, 34), "direction_deg": 0,
                                      "field_of_view_deg": 60}).json()["camera"]["camera_id"]
    with session_scope() as db:
        assert db.get(Camera, cam)
        for cid, n in ((a, 1), (b, 2)):
            for _ in range(n):
                db.add(WatchAlert(case_id=cid, camera_id=cam, detected_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
                                  score=0.85, level="high", snapshot_path="alerts/x.jpg"))
    res = u1.get("/api/alerts/pending-count").json()
    assert res == {"count": 3, "by_case": [{"case_id": b, "count": 2}, {"case_id": a, "count": 1}]}
    assert as_user("user2").get("/api/alerts/pending-count").json() == {"count": 0, "by_case": []}
