"""초기 스키마: 20개 테이블(openapi 1.1.0 기준)

모델 브랜치 db/001·003 SQL(11개 테이블)을 대체한다. 내용은 같은 폴더의 0001_initial.sql.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-28
"""
from pathlib import Path

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

SQL_FILE = Path(__file__).with_name("0001_initial.sql")
TABLES = [
    "search_candidates", "decisions", "watch_alerts", "tasks", "search_runs", "case_assignees",
    "tracklet_embeddings", "cases", "tracklets", "videos", "system_settings", "sessions", "route_edges",
    "retention_policy", "idempotency_keys", "cameras", "audit_logs", "users", "nodes", "hazard_zones",
]


def upgrade() -> None:
    sql = SQL_FILE.read_text(encoding="utf-8")
    if op.get_context().as_sql:  # --sql(오프라인) 출력: 파일 내용을 그대로 쓴다
        op.get_context().impl.static_output(sql)
        return
    # 여러 문장을 한 번에 보내고, CHECK 안의 '%'를 자리표시자로 해석하지 않도록 드라이버 커서로 직접 실행한다
    cursor = op.get_bind().connection.driver_connection.cursor()
    cursor.execute(sql)


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
