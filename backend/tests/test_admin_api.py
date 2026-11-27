"""4단계: 계정·이용 기록·설정·보관·지도 관리 API (실제 PostgreSQL)."""
import pytest

pytestmark = pytest.mark.db

PT = lambda lon, lat: {"type": "Point", "coordinates": [lon, lat]}  # noqa: E731
SQUARE = {"type": "Polygon", "coordinates": [[[126.0, 34.0], [126.01, 34.0], [126.01, 34.01], [126.0, 34.0]]]}


def test_admin_creates_user_with_temp_password_and_idempotent_replay(as_user):
    admin = as_user("admin", role="admin")
    body = {"username": "kim", "display_name": "김경수", "role": "user"}
    first = admin.post("/api/users", body, idem="same-key")
    assert first.status_code == 201, first.text
    again = admin.post("/api/users", body, idem="same-key")
    assert again.status_code == 201 and again.json() == first.json()
    assert again.headers.get("idempotent-replayed") == "true"
    assert first.json()["must_change_password"] is True and len(first.json()["temporary_password"]) == 16
    dup = admin.post("/api/users", {**body, "username": "KIM"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "USERNAME_ALREADY_EXISTS"


def test_non_admin_gets_403_on_admin_api(as_user):
    user = as_user("user1")
    res = user.get("/api/users")
    assert res.status_code == 403 and res.json()["error"]["code"] == "FORBIDDEN"


def test_last_admin_protected_and_role_change_revokes_sessions(as_user):
    admin = as_user("admin", role="admin")
    me = admin.get("/api/auth/me").json()["user"]
    res = admin.patch(f"/api/users/{me['user_id']}/role", {"role": "user", "expected_version": me["version"]})
    assert res.status_code == 409 and res.json()["error"]["code"] == "LAST_ADMIN_PROTECTED"

    user = as_user("user1")
    target = user.get("/api/auth/me").json()["user"]
    stale = admin.patch(f"/api/users/{target['user_id']}/role", {"role": "admin", "expected_version": 99})
    assert stale.status_code == 409 and stale.json()["error"]["context"]["current_version"] == 1
    ok = admin.patch(f"/api/users/{target['user_id']}/role", {"role": "admin", "expected_version": 1})
    assert ok.status_code == 200 and ok.json()["role"] == "admin" and ok.json()["version"] == 2
    assert user.get("/api/auth/me").status_code == 401  # 다시 로그인해야 한다


def test_deactivate_blocks_open_case_owner(as_user, demo_settings):
    admin = as_user("admin", role="admin")
    admin.post("/api/cameras", {"kind": "waypoint", "name": "정문", "location": PT(126.0, 34.0)})
    owner = as_user("owner")
    case = owner.post("/api/cases", {"title": "t", "person_type": "child", "person_name": "김민준",
                                     "last_seen_at": "2026-11-20T10:00:00+09:00", "last_seen_location": PT(126.0, 34.0)})
    assert case.status_code == 201, case.text
    uid = owner.get("/api/auth/me").json()["user"]["user_id"]
    res = admin.post(f"/api/users/{uid}/deactivate", {"reason": "퇴사", "expected_version": 1})
    assert res.status_code == 409 and res.json()["error"]["code"] == "ACTIVE_CASE_OWNER"
    assert res.json()["error"]["context"]["blocking_case_ids"] == [case.json()["case_id"]]


def test_password_reset_forces_change(as_user):
    admin = as_user("admin", role="admin")
    user = as_user("user1")
    uid = user.get("/api/auth/me").json()["user"]["user_id"]
    res = admin.post(f"/api/users/{uid}/password-reset", {"reason": "분실", "expected_version": 1})
    assert res.status_code == 200 and res.json()["user"]["must_change_password"] is True
    assert user.get("/api/auth/me").status_code == 401


def test_directory_only_active_users_without_secrets(as_user):
    user = as_user("user1")
    as_user("user2")
    res = user.get("/api/users/directory", params={"query": "USER"})
    assert res.status_code == 200
    items = res.json()["items"]
    assert {i["username"] for i in items} == {"user1", "user2"}
    assert set(items[0]) == {"user_id", "username", "display_name", "role", "active"}


def test_audit_logs_filter_and_paging(as_user):
    admin = as_user("admin", role="admin")
    for i in range(3):
        admin.post("/api/users", {"username": f"user{i}x", "display_name": f"U{i}", "role": "user"})
    page1 = admin.get("/api/audit-logs", params={"action": "ACCOUNT_CREATE", "limit": 2}).json()
    assert len(page1["items"]) == 2 and page1["has_more"]
    page2 = admin.get("/api/audit-logs", params={"action": "ACCOUNT_CREATE", "limit": 2, "cursor": page1["next_cursor"]}).json()
    assert len(page2["items"]) == 1 and not page2["has_more"]
    bad = admin.get("/api/audit-logs", params={"action": "LOGIN", "cursor": page1["next_cursor"]})
    assert bad.status_code == 422  # 필터가 바뀌면 이전 cursor는 거절


def test_settings_validation_and_user_can_read(as_user):
    admin = as_user("admin", role="admin")
    user = as_user("user1")
    s = user.get("/api/settings").json()
    assert s["default_similarity_threshold"] is None and s["out_of_filter_threshold"] is None
    bad = admin.patch("/api/settings", {"default_similarity_threshold": 0.9, "alert_high_threshold": 0.8, "expected_version": 1})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_SETTINGS"
    presets = [{"person_type": t, "speed_mps": 1.0, "max_speed_mps": 1.5} for t in ("adult", "child", "elderly", "other")]
    ok = admin.patch("/api/settings", {"walking_speed_presets": presets, "default_similarity_threshold": 0.6,
                                       "alert_high_threshold": 0.8, "area_level_ratios": [0.5, 0.8, 1],
                                       "out_of_filter_threshold": 0.85, "expected_version": 1})
    assert ok.status_code == 200, ok.text
    assert ok.json()["version"] == 2 and ok.json()["out_of_filter_threshold"] == pytest.approx(0.85)
    cleared = admin.patch("/api/settings", {"out_of_filter_threshold": None, "expected_version": 2})
    assert cleared.json()["out_of_filter_threshold"] is None  # R5: null로 해제
    assert user.patch("/api/settings", {"area_buffer_m": 10, "expected_version": 3}).status_code == 403


def test_retention_and_deletion_candidates_never_delete(as_user):
    admin = as_user("admin", role="admin")
    r = admin.get("/api/retention-policy").json()
    assert r["automatic_deletion_enabled"] is False and r["deletion_mode"] == "manual_approval_required"
    r2 = admin.patch("/api/retention-policy", {"audit_retention_days": 1, "apply_to_existing": True, "expected_version": 1})
    assert r2.status_code == 200 and r2.json()["audit_retention_days"] == 1
    items = admin.get("/api/deletion-candidates").json()["items"]
    assert items and items[0]["resource_type"] == "audit_log" and items[0]["approval_required"] is True


def test_camera_crud_with_route_task_and_references(as_user, sent_tasks):
    admin = as_user("admin", role="admin")
    wp = admin.post("/api/cameras", {"kind": "waypoint", "name": "갈림길", "location": PT(126.001, 34.001)})
    assert wp.status_code == 201, wp.text
    wp_id = wp.json()["camera"]["node_id"]
    cam = admin.post("/api/cameras", {"kind": "camera", "name": "C1 정문", "location": PT(126.0, 34.0), "direction_deg": 90,
                                      "field_of_view_deg": 70, "edge_node_map": {"top": None, "right": None, "bottom": None, "left": wp_id}, "stream_url": "file:///data/demo.mp4"})
    assert cam.status_code == 201, cam.text
    body = cam.json()
    assert body["camera"]["camera_id"] == body["camera"]["node_id"] and body["camera"]["has_stream"] is True
    assert body["camera"]["location"] == PT(126.0, 34.0)
    assert body["route_task"]["status_url"].startswith("/api/tasks/")
    assert [t["name"] for t in sent_tasks] == ["left.walk.recalculate", "left.walk.recalculate"]

    bad_ref = admin.post("/api/cameras", {"kind": "camera", "name": "C2", "location": PT(126, 34), "direction_deg": 0,
                                          "field_of_view_deg": 60, "edge_node_map": {"top": 999, "right": None, "bottom": None, "left": None}})
    assert bad_ref.status_code == 422 and bad_ref.json()["error"]["code"] == "INVALID_NODE_REFERENCE"
    bad_wp = admin.post("/api/cameras", {"kind": "waypoint", "name": "x", "location": PT(126, 34), "direction_deg": 10})
    assert bad_wp.status_code == 422

    cid = body["camera"]["node_id"]
    kind = admin.patch(f"/api/cameras/{cid}", {"kind": "waypoint", "expected_version": 1})
    assert kind.status_code == 409 and kind.json()["error"]["code"] == "NODE_KIND_IMMUTABLE"
    moved = admin.patch(f"/api/cameras/{cid}", {"name": "C1 정문(수정)", "stream_url": None, "expected_version": 1})
    assert moved.status_code == 200 and moved.json()["has_stream"] is False and moved.json()["version"] == 2

    refd = admin.delete(f"/api/cameras/{wp_id}")  # C1의 edge_node_map이 참조
    assert refd.status_code == 409 and refd.json()["error"]["code"] == "RESOURCE_REFERENCED"
    assert admin.delete(f"/api/cameras/{cid}").json() == {"id": str(cid), "deleted": True}

    user = as_user("user1")
    listed = user.get("/api/cameras").json()["items"]
    assert [c["node_id"] for c in listed] == [wp_id] and "stream_url" not in listed[0]


def test_danger_zone_validation_and_crud(as_user):
    admin = as_user("admin", role="admin")
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
    bad = admin.post("/api/danger-zones", {"name": "x", "kind": "water", "severity": "high", "geometry": bowtie})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_GEOMETRY"
    z = admin.post("/api/danger-zones", {"name": "연못", "kind": "water", "severity": "high", "geometry": SQUARE, "description": "깊음"})
    assert z.status_code == 201, z.text
    zid = z.json()["zone_id"]
    assert z.json()["geometry"] == SQUARE
    p = admin.patch(f"/api/danger-zones/{zid}", {"severity": "medium", "expected_version": 1})
    assert p.json()["severity"] == "medium" and p.json()["version"] == 2
    user = as_user("user1")
    assert len(user.get("/api/danger-zones").json()["items"]) == 1
    assert admin.delete(f"/api/danger-zones/{zid}").status_code == 200


def test_walk_edge_manual_patch(as_user):
    from app.db import session_scope
    from app.models import RouteEdge

    admin = as_user("admin", role="admin")
    a = admin.post("/api/cameras", {"kind": "waypoint", "name": "A", "location": PT(126.0, 34.0)}).json()["camera"]["node_id"]
    b = admin.post("/api/cameras", {"kind": "waypoint", "name": "B", "location": PT(126.001, 34.0)}).json()["camera"]["node_id"]
    with session_scope() as db:
        e = RouteEdge(from_node_id=a, to_node_id=b, source="api", status="needs_manual", straight_distance_m=92.0)
        db.add(e)
        db.flush()
        eid = e.id
    # 계산 작업이 대기 중이면 수정할 수 없다(카메라 등록이 만든 작업)
    busy = admin.patch(f"/api/walk-graph/{eid}", {"correction_factor": 1.2, "expected_version": 1})
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "RECALCULATION_IN_PROGRESS"
    from sqlalchemy import update

    from app.models import Task
    with session_scope() as db:
        db.execute(update(Task).values(status="done", stage="done", progress=100))
    far = {"type": "LineString", "coordinates": [[127.0, 35.0], [127.1, 35.0]]}
    mismatch = admin.patch(f"/api/walk-graph/{eid}", {"geometry": far, "distance_m": 200, "duration_s": 150, "expected_version": 1})
    assert mismatch.status_code == 422 and mismatch.json()["error"]["code"] == "EDGE_ENDPOINT_MISMATCH"
    line = {"type": "LineString", "coordinates": [[126.0, 34.0], [126.0005, 34.0003], [126.001, 34.0]]}
    ok = admin.patch(f"/api/walk-graph/{eid}", {"geometry": line, "distance_m": 200, "duration_s": 150, "expected_version": 1})
    assert ok.status_code == 200, ok.text
    edge = ok.json()
    assert edge["source"] == "manual" and edge["status"] == "ok" and edge["suspected_detour"] is True
    assert edge["detour_ratio"] == pytest.approx(200 / 92, rel=1e-3)
    assert admin.get("/api/walk-graph", params={"suspected_detour": True}).json()["items"][0]["edge_id"] == eid
    rec = admin.post("/api/walk-graph/recalculations", {"include_manual": False, "reason": "점검"})
    assert rec.status_code == 202 and rec.json()["status"] == "queued"
