"""LEFT API (openapi 1.1.0, docs 브랜치 docs/api/openapi.json)."""
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.errors import install_error_handlers

settings = get_settings()
app = FastAPI(title="LEFT API", version="1.1.0", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None)
install_error_handlers(app)


def check_db() -> dict:
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT extname, extversion FROM pg_extension WHERE extname IN ('postgis','vector')"))
            ext = {name: version for name, version in rows}
        return {"ok": {"postgis", "vector"} <= ext.keys(), "extensions": ext}
    except Exception as e:  # 연결 실패도 상태로 보여 준다
        return {"ok": False, "error": type(e).__name__}


def check_redis() -> dict:
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        return {"ok": bool(client.ping())}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


@app.get("/api/health", tags=["운영"], summary="DB·Redis 연결 상태")
def health():
    checks = {"db": check_db(), "redis": check_redis()}
    ok = all(c["ok"] for c in checks.values())
    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "checks": checks},
        headers={"Cache-Control": "no-store"},
    )
