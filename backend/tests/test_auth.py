"""3단계: 세션·CSRF·Origin·첫 로그인 제한·로그인 시도 제한·작업 조회 권한 (실제 PostgreSQL)."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from tests.conftest import ORIGIN, login

pytestmark = pytest.mark.db


def test_login_sets_httponly_cookie_and_returns_csrf(client, make_user):
    make_user("user1", "test-password-1")
    res = client.post("/api/auth/login", json={"username": "user1", "password": "test-password-1"}, headers=ORIGIN)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"user", "csrf_token", "expires_at"}
    assert body["user"]["username"] == "user1" and body["user"]["role"] == "user"
    cookie = res.headers["set-cookie"]
    assert "refind_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    assert "Secure" not in cookie  # 로컬 HTTP 개발(COOKIE_SECURE=false)
    assert res.headers["cache-control"] == "no-store"


def test_login_failure_does_not_reveal_account(client, make_user):
    make_user("user1", "test-password-1")
    wrong = client.post("/api/auth/login", json={"username": "user1", "password": "nope-nope-1"}, headers=ORIGIN)
    missing = client.post("/api/auth/login", json={"username": "ghost", "password": "nope-nope-1"}, headers=ORIGIN)
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json()["error"]["code"] == missing.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert wrong.json()["error"]["message"] == missing.json()["error"]["message"]


def test_inactive_account_is_403_only_with_right_password(client, make_user):
    make_user("old", "test-password-1", active=False)
    bad = client.post("/api/auth/login", json={"username": "old", "password": "wrong-password"}, headers=ORIGIN)
    assert bad.status_code == 401
    res = client.post("/api/auth/login", json={"username": "old", "password": "test-password-1"}, headers=ORIGIN)
    assert res.status_code == 403 and res.json()["error"]["code"] == "ACCOUNT_INACTIVE"


def test_login_rejects_foreign_origin(client, make_user):
    make_user("user1", "test-password-1")
    res = client.post("/api/auth/login", json={"username": "user1", "password": "test-password-1"},
                      headers={"Origin": "http://evil.example"})
    assert res.status_code == 403 and res.json()["error"]["code"] == "CSRF_INVALID"


def test_login_rate_limited_after_ten_failures(client, make_user):
    make_user("user1", "test-password-1")
    for _ in range(10):
        client.post("/api/auth/login", json={"username": "user1", "password": "wrong-password"}, headers=ORIGIN)
    res = client.post("/api/auth/login", json={"username": "user1", "password": "test-password-1"}, headers=ORIGIN)
    assert res.status_code == 429 and res.json()["error"]["code"] == "RATE_LIMITED"
    assert int(res.headers["retry-after"]) > 0


def test_me_restores_session_without_rotating_csrf(client, make_user):
    make_user("user1", "test-password-1")
    csrf = login(client, "user1", "test-password-1")
    for _ in range(2):
        me = client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["csrf_token"] == csrf
    assert me.headers["cache-control"] == "no-store"


def test_me_without_cookie_is_401_unauthenticated(client, db_clean):
    res = client.get("/api/auth/me")
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHENTICATED"


def test_idle_session_expires_with_session_expired_code(client, make_user):
    from sqlalchemy import update

    from app.db import session_scope
    from app.models import UserSession

    make_user("user1", "test-password-1")
    login(client, "user1", "test-password-1")
    with session_scope() as db:
        db.execute(update(UserSession).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    res = client.get("/api/auth/me")
    assert res.status_code == 401 and res.json()["error"]["code"] == "SESSION_EXPIRED"
    assert "refind_session=" in res.headers.get("set-cookie", "")  # 쿠키도 지운다
    assert client.get("/api/auth/me").json()["error"]["code"] == "UNAUTHENTICATED"


def test_logout_requires_csrf_and_revokes(client, make_user):
    make_user("user1", "test-password-1")
    csrf = login(client, "user1", "test-password-1")
    no_csrf = client.post("/api/auth/logout", headers=ORIGIN)
    assert no_csrf.status_code == 403 and no_csrf.json()["error"]["code"] == "CSRF_INVALID"
    wrong = client.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": "x" * 43})
    assert wrong.status_code == 403
    ok = client.post("/api/auth/logout", headers={**ORIGIN, "X-CSRF-Token": csrf})
    assert ok.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_first_login_restricted_until_password_change(client, make_user):
    make_user("user2", "temp-pass-123", must_change=True)
    csrf = login(client, "user2", "temp-pass-123")
    assert client.get("/api/auth/me").json()["user"]["must_change_password"] is True
    blocked = client.get(f"/api/tasks/{uuid4()}")
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    h = {**ORIGIN, "X-CSRF-Token": csrf}
    same = client.post("/api/auth/password", json={"current_password": "temp-pass-123", "new_password": "temp-pass-123"}, headers=h)
    assert same.status_code == 422 and same.json()["error"]["code"] == "PASSWORD_UNCHANGED"
    short = client.post("/api/auth/password", json={"current_password": "temp-pass-123", "new_password": "short"}, headers=h)
    assert short.status_code == 422 and short.json()["error"]["code"] == "PASSWORD_POLICY_VIOLATION"
    wrong = client.post("/api/auth/password", json={"current_password": "nope", "new_password": "brand-new-pass-1"}, headers=h)
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "CURRENT_PASSWORD_INVALID"

    ok = client.post("/api/auth/password", json={"current_password": "temp-pass-123", "new_password": "brand-new-pass-1"}, headers=h)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["user"]["must_change_password"] is False and body["user"]["version"] == 2
    assert body["csrf_token"] != csrf  # 세션 회전
    # 새 쿠키로 계속 쓸 수 있고, 제한이 풀린다
    assert client.get(f"/api/tasks/{uuid4()}").json()["error"]["code"] == "TASK_NOT_FOUND"


def test_password_change_revokes_other_sessions(client, make_user):
    from fastapi.testclient import TestClient

    from app.main import app

    make_user("user1", "test-password-1")
    other = TestClient(app)
    login(other, "user1", "test-password-1")
    csrf = login(client, "user1", "test-password-1")
    res = client.post("/api/auth/password", json={"current_password": "test-password-1", "new_password": "another-pass-22"},
                      headers={**ORIGIN, "X-CSRF-Token": csrf})
    assert res.status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me").status_code == 200


def test_login_audited_including_failure(client, make_user):
    from sqlalchemy import select

    from app.db import session_scope
    from app.models import AuditLog

    make_user("user1", "test-password-1")
    client.post("/api/auth/login", json={"username": "user1", "password": "wrong-password"}, headers=ORIGIN)
    login(client, "user1", "test-password-1")
    with session_scope() as db:
        rows = db.execute(select(AuditLog.action, AuditLog.result).order_by(AuditLog.id)).all()
    assert [tuple(r) for r in rows] == [("LOGIN", "failure"), ("LOGIN", "success")]


def _task(created_by=None, case_id=None):
    from app.db import session_scope
    from app.models import Task

    with session_scope() as db:
        t = Task(kind="walk_graph_recalculation", created_by=created_by, case_id=case_id)
        db.add(t)
        db.flush()
        return t.id


def test_task_visible_to_creator_and_admin_only(client, make_user):
    owner, pw = make_user("user1", "test-password-1")
    make_user("user2", "test-password-2")
    make_user("admin", "test-password-3", role="admin")
    tid = _task(created_by=owner.id)

    login(client, "user2", "test-password-2")
    res = client.get(f"/api/tasks/{tid}")
    assert res.status_code == 404 and res.json()["error"]["code"] == "TASK_NOT_FOUND"

    login(client, "user1", pw)
    res = client.get(f"/api/tasks/{tid}")
    assert res.status_code == 200
    body = res.json()
    assert body["task_id"] == str(tid) and body["status"] == "queued" and body["progress"] == 0

    login(client, "admin", "test-password-3")
    assert client.get(f"/api/tasks/{tid}").status_code == 200
    assert client.get("/api/tasks/not-a-uuid").json()["error"]["code"] == "TASK_NOT_FOUND"
