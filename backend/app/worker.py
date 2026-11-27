"""Celery 앱. 큐는 둘: analysis(GPU 사전 분석), default(CPU: 사진 질의·검색·도보 경로·변환)."""
from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery("left", broker=settings.redis_url, backend=settings.redis_url, include=["app.tasks"])
celery_app.conf.update(
    task_default_queue="default",
    task_routes={"refind.video.analyze.v1": {"queue": "analysis"}},
    task_acks_late=True,  # 워커가 죽으면 다시 받는다. 작업은 DB 상태로 중복 실행을 막는다
    worker_prefetch_multiplier=1,
    task_track_started=True,
    result_expires=3600,
    timezone="Asia/Seoul",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
)
