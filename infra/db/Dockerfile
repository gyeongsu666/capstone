# PostgreSQL 18 + PostGIS 3.6 + pgvector
# 모델 검증에 쓴 로컬 DB(PostgreSQL 18.6, PostGIS 3.6.2, pgvector 0.8.1)와 같은 주 버전 조합.
FROM postgis/postgis:18-3.6

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-pgvector \
    && rm -rf /var/lib/apt/lists/*
