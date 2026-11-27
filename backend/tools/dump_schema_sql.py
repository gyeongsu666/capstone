"""app/models.py로 PostgreSQL DDL을 만든다.

초기 마이그레이션(alembic/versions/0001_initial.sql)을 만들 때와,
테스트에서 모델과 초기 마이그레이션이 같은지 비교할 때 쓴다.
사용: python tools/dump_schema_sql.py > alembic/versions/0001_initial.sql
"""
import sys
from pathlib import Path

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import AddConstraint, CreateIndex, CreateTable

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models import Base  # noqa: E402

HEADER = """-- LEFT 초기 스키마(openapi 1.1.0 기준, 20개 테이블). tools/dump_schema_sql.py로 생성.
-- 이후 변경은 이 파일을 고치지 말고 새 Alembic 리비전으로 추가한다.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
"""

FOOTER = """
-- 설정 두 테이블은 한 줄짜리. 값은 미정(null)으로 시작하고 관리자가 정한다.
INSERT INTO system_settings (id) VALUES (1);
INSERT INTO retention_policy (id) VALUES (1);
"""


def render() -> str:
    # named 파라미터 방식이면 CHECK 안의 % 를 %% 로 바꾸지 않는다
    dialect = postgresql.dialect(paramstyle="named")
    parts = [HEADER]
    tables = Base.metadata.sorted_tables
    for table in tables:
        parts.append(str(CreateTable(table).compile(dialect=dialect)).strip() + ";")
        for index in sorted(table.indexes, key=lambda i: i.name):
            parts.append(str(CreateIndex(index).compile(dialect=dialect)).strip() + ";")
    for table in tables:
        for fk in sorted(table.foreign_key_constraints, key=lambda c: c.name or ""):
            if fk.use_alter:
                parts.append(str(AddConstraint(fk).compile(dialect=dialect)).strip() + ";")
    parts.append(FOOTER)
    return "\n\n".join(parts).replace("\t", "  ") + "\n"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdout.write(render())
