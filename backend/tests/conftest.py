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


def schema_sql_for_test() -> str:
    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    if HAS_POSTGIS:
        return sql
    sql = sql.replace("CREATE EXTENSION IF NOT EXISTS postgis;", "")
    sql = re.sub(r"geography\([A-Z]+,4326\)", "bytea", sql)
    # bytea에는 gist 인덱스를 만들 수 없다
    sql = re.sub(r"CREATE INDEX \w+ ON \w+ USING gist \(\w+\);", "", sql)
    # GeoAlchemy가 쓰는 변환 함수의 흉내(값을 그대로 보관만 한다)
    stubs = """
CREATE FUNCTION ST_GeogFromText(text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to($1, 'UTF8') $$;
CREATE FUNCTION ST_AsBinary(bytea) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION ST_AsEWKB(bytea) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
"""
    return stubs + sql


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
        conn.execute("DELETE FROM system_settings; INSERT INTO system_settings (id) VALUES (1);")
        conn.execute("DELETE FROM retention_policy; INSERT INTO retention_policy (id) VALUES (1);")
    yield


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    import app.common

    monkeypatch.setattr(app.common, "_redis", lambda: fake)
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
