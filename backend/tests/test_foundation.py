"""1·2단계 기반 테스트: DB 없이 돌아가는 것만. 실제 DB 적용은 서버에서 scripts/left.sh migrate로 확인한다."""
import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def test_twenty_tables_and_names():
    from app.models import Base

    names = set(Base.metadata.tables)
    assert len(names) == 20
    # 모델 브랜치의 기존 11개 테이블 이름을 유지한다
    assert {
        "nodes", "cameras", "route_edges", "hazard_zones", "videos", "tracklets",
        "tracklet_embeddings", "users", "cases", "decisions", "watch_alerts",
    } <= names


def test_initial_migration_matches_models():
    """0001_initial.sql은 tools/dump_schema_sql.py 출력과 같아야 한다(모델만 고치고 SQL을 안 바꾸는 실수 방지)."""
    import sys

    sys.path.insert(0, str(ROOT / "tools"))
    dump = importlib.import_module("dump_schema_sql")
    frozen = (ROOT / "alembic/versions/0001_initial.sql").read_text(encoding="utf-8")
    assert dump.render() == frozen


def test_initial_sql_has_no_doubled_percent_and_seeds_settings():
    sql = (ROOT / "alembic/versions/0001_initial.sql").read_text(encoding="utf-8")
    assert "%%" not in sql
    assert "INSERT INTO system_settings (id) VALUES (1);" in sql
    assert "INSERT INTO retention_policy (id) VALUES (1);" in sql
    # 순환 외래 키는 테이블 생성 뒤에 붙는다
    for fk in ("nodes_case_id_fkey", "videos_case_id_fkey", "search_runs_anchor_decision_fkey"):
        assert f"ADD CONSTRAINT {fk}" in sql


def test_create_table_order_respects_foreign_keys():
    sql = (ROOT / "alembic/versions/0001_initial.sql").read_text(encoding="utf-8")
    order = [line.split()[2] for line in sql.splitlines() if line.startswith("CREATE TABLE")]
    pos = {name: i for i, name in enumerate(order)}
    for child, parent in [
        ("cameras", "nodes"), ("videos", "cameras"), ("tracklets", "videos"), ("cases", "tracklets"),
        ("decisions", "search_runs"), ("decisions", "watch_alerts"), ("search_candidates", "search_runs"),
        ("tasks", "cases"), ("tasks", "videos"), ("sessions", "users"),
    ]:
        assert pos[parent] < pos[child], (child, parent)


def test_one_active_decision_per_tracklet_index():
    from app.models import Decision

    idx = {i.name: i for i in Decision.__table__.indexes}
    active = idx["decisions_active_tracklet_key"]
    assert active.unique
    assert "status='active'" in str(active.dialect_options["postgresql"]["where"])


def test_password_hash_roundtrip():
    from app.security import hash_password, temporary_password, verify_password

    pw = temporary_password()
    assert len(pw) == 16
    h = hash_password(pw)
    assert verify_password(h, pw)
    assert not verify_password(h, pw + "x")
    assert not verify_password("not-a-hash", pw)


def test_allowed_origins_comma_separated(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173, http://100.74.97.103:5173")
    assert Settings().allowed_origins == ["http://localhost:5173", "http://100.74.97.103:5173"]


@pytest.fixture
def down_client(monkeypatch):
    """DB·Redis가 닿지 않는 상태를 흉내 낸다(다른 테스트의 엔진은 건드리지 않는다)."""
    from sqlalchemy import create_engine

    import app.main

    monkeypatch.setattr(app.main, "engine", create_engine("postgresql+psycopg://x:y@127.0.0.1:1/none",
                                                          connect_args={"connect_timeout": 1}))
    monkeypatch.setattr(app.main.settings, "redis_url", "redis://127.0.0.1:1/0")
    return TestClient(app.main.app)


def test_health_reports_degraded_when_dependencies_down(down_client):
    res = down_client.get("/api/health")
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "degraded"
    assert body["checks"]["db"]["ok"] is False and body["checks"]["redis"]["ok"] is False
    assert res.headers["Cache-Control"] == "no-store"
    assert res.headers["X-Request-ID"]


def test_error_format_for_unknown_route_and_request_id_echo(down_client):
    res = down_client.get("/api/nope", headers={"X-Request-ID": "abc-123"})
    assert res.status_code == 404
    body = res.json()
    assert body["request_id"] == "abc-123"
    assert body["error"]["code"] == "RESOURCE_NOT_FOUND"
    assert set(body["error"]) == {"code", "message", "fields", "context", "retryable"}


def test_cli_rejects_bad_admin_name():
    from app.cli import create_admin

    assert create_admin("", "관리자") == 2
