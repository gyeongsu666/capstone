"""테스트 DB 준비.

- TEST_DATABASE_URL이 있으면 그 DB(PostGIS 포함 서버 DB)에 0001_initial.sql을 그대로 적용한다.
- 없으면 pgserver(내장 PostgreSQL + pgvector, Python 3.11)를 띄운다. PostGIS가 없어서
  geography 칸만 bytea로 바꿔 적용한다(좌표 계산 테스트는 서버 DB에서 한다).
- 둘 다 없으면 DB 테스트(@pytest.mark.db)는 건너뛴다.
app 모듈은 DATABASE_URL을 읽고 엔진을 만들기 때문에, 이 파일이 app보다 먼저 환경 변수를 정한다.
"""
import os
import re
import tempfile
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_SQL = ROOT / "alembic/versions/0001_initial.sql"
_server = None
DB_URL = os.environ.get("TEST_DATABASE_URL")
HAS_POSTGIS = bool(DB_URL)


def _start_pgserver() -> str | None:
    global _server
    try:
        import pgserver
    except ImportError:
        return None
    _server = pgserver.get_server(tempfile.mkdtemp(prefix="left-pg-"), cleanup_mode="delete")
    _server.psql("DROP DATABASE IF EXISTS left_test;")
    _server.psql("CREATE DATABASE left_test;")
    uri = _server.get_uri().rsplit("/", 1)[0] + "/left_test"
    return uri.replace("postgresql://", "postgresql+psycopg://", 1)


if DB_URL is None:
    DB_URL = _start_pgserver()

os.environ["DATABASE_URL"] = DB_URL or "postgresql+psycopg://none:none@127.0.0.1:1/none"
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"
os.environ["SESSION_SECRET"] = "test-secret-" + "x" * 32
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"
os.environ["MEDIA_ROOT"] = tempfile.mkdtemp(prefix="left-media-")


def schema_sql_for_test() -> str:
    import sys

    sys.path.insert(0, str(ROOT / "tools"))
    from pg_stub import without_postgis

    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    return sql if HAS_POSTGIS else without_postgis(sql)


def pytest_configure(config):
    config.addinivalue_line("markers", "db: 실제 PostgreSQL이 필요한 테스트")


def pytest_unconfigure(config):
    if _server is not None:
        _server.cleanup()


@pytest.fixture(scope="session")
def schema():
    if DB_URL is None:
        pytest.skip("테스트용 PostgreSQL 없음(pgserver 또는 TEST_DATABASE_URL 필요)")
    import psycopg

    raw = DB_URL.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(raw, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        conn.execute(schema_sql_for_test())
    return raw


TABLES = [
    "search_candidates", "decisions", "watch_alerts", "tasks", "search_runs", "case_assignees",
    "tracklet_embeddings", "cases", "tracklets", "videos", "sessions", "route_edges",
    "idempotency_keys", "cameras", "audit_logs", "users", "nodes", "hazard_zones",
]


class FakeRedis:
    """로그인 시도 제한에 쓰는 만큼만 흉내 낸다."""

    def __init__(self):
        self.data, self.expiry = {}, {}

    def get(self, k):
        return self.data.get(k)

    def ttl(self, k):
        return int(self.expiry.get(k, time.time()) - time.time())

    def delete(self, k):
        self.data.pop(k, None)

    def pipeline(self):
        outer = self

        class P:
            def incr(self, k):
                outer.data[k] = int(outer.data.get(k, 0)) + 1

            def expire(self, k, s, nx=False):
                if not (nx and k in outer.expiry):
                    outer.expiry[k] = time.time() + s

            def execute(self):
                return []

        return P()


@pytest.fixture
def db_clean(schema):
    """테스트마다 업무 테이블을 비우고 설정 두 줄을 되돌린다."""
    import psycopg

    with psycopg.connect(schema, autocommit=True) as conn:
        conn.execute(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE;")
        conn.execute("DELETE FROM system_settings;")
        conn.execute(re.search(r"INSERT INTO system_settings .*?;", SCHEMA_SQL.read_text(encoding="utf-8"), re.S).group(0))
        conn.execute("DELETE FROM retention_policy; INSERT INTO retention_policy (id) VALUES (1);")
    yield


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    import app.common

    monkeypatch.setattr(app.common, "_redis", lambda: fake)
    import app.routers.watch
    import app.tracking_common

    monkeypatch.setattr(app.tracking_common, "notify_watch", lambda case_id: None)
    monkeypatch.setattr(app.routers.watch, "read_heartbeats", lambda ids: {})
    return fake


@pytest.fixture
def client(db_clean, fake_redis):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app, base_url="http://testserver") as c:
        yield c


@pytest.fixture
def make_user(db_clean):
    """사용자를 만들고 (User, 비밀번호)를 돌려준다."""
    from app.db import session_scope
    from app.models import User
    from app.security import hash_password

    def _make(username="user1", password="test-password-1", role="user", must_change=False, active=True):
        with session_scope() as db:
            u = User(username=username, display_name=username.upper(), password_hash=hash_password(password),
                     role=role, must_change_password=must_change, active=active,
                     deactivated_at=None if active else __import__("datetime").datetime.now(__import__("datetime").timezone.utc))
            db.add(u)
            db.flush()
            db.refresh(u)
            return u, password

    return _make


ORIGIN = {"Origin": "http://localhost:5173"}


def login(client, username, password):
    res = client.post("/api/auth/login", json={"username": username, "password": password}, headers=ORIGIN)
    assert res.status_code == 200, res.text
    return res.json()["csrf_token"]


@pytest.fixture
def sent_tasks(monkeypatch):
    """Celery로 보낸 작업을 기록만 한다(테스트에는 Redis가 없다)."""
    from app.worker import celery_app

    sent = []
    monkeypatch.setattr(celery_app, "send_task", lambda name, kwargs=None, queue=None, task_id=None, **_: sent.append(
        {"name": name, "kwargs": kwargs, "queue": queue, "task_id": task_id}))
    return sent


class Api:
    """로그인한 클라이언트. 변경 요청에 CSRF·Origin·Idempotency-Key를 붙인다."""

    def __init__(self, client, csrf):
        self.c, self.csrf = client, csrf

    def _h(self, extra=None, idem=None):
        import uuid

        h = {**ORIGIN, "X-CSRF-Token": self.csrf, "Idempotency-Key": idem or str(uuid.uuid4())}
        return {**h, **(extra or {})}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, json=None, idem=None, **kw):
        return self.c.post(url, json=json, headers=self._h(kw.pop("headers", None), idem), **kw)

    def patch(self, url, json=None, **kw):
        return self.c.patch(url, json=json, headers=self._h(), **kw)

    def put(self, url, json=None, **kw):
        return self.c.put(url, json=json, headers=self._h(), **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self._h(), **kw)


@pytest.fixture
def as_user(client, make_user, sent_tasks):
    """as_user('admin', role='admin') → Api. 같은 TestClient 쿠키를 바꿔 끼운다."""
    from fastapi.testclient import TestClient

    from app.main import app

    def _login(username="user1", role="user"):
        make_user(username, "test-password-1", role=role)
        c = TestClient(app)
        return Api(c, login(c, username, "test-password-1"))

    return _login


DEMO_SETTINGS_SQL = """UPDATE system_settings SET walking_speed_presets='[{"person_type":"adult","speed_mps":1.2,"max_speed_mps":1.8},{"person_type":"child","speed_mps":1.0,"max_speed_mps":1.6},{"person_type":"elderly","speed_mps":0.8,"max_speed_mps":1.2},{"person_type":"other","speed_mps":1.0,"max_speed_mps":1.6}]',
 default_similarity_threshold=0.6, alert_high_threshold=0.8, area_level_ratios='[0.5,0.8,1]', area_buffer_m=30, max_upload_bytes=2000000000"""


@pytest.fixture
def demo_settings(schema, db_clean):
    import psycopg

    with psycopg.connect(schema, autocommit=True) as conn:
        conn.execute(DEMO_SETTINGS_SQL)
