"""Celery 작업. 1단계는 연결 확인용 ping만 둔다. 실제 작업은 4~5단계에서 추가한다."""
import platform
import socket

from app.worker import celery_app


@celery_app.task(name="left.system.ping")
def ping() -> dict:
    """api → Redis → 워커 → 결과 왕복 확인용."""
    info = {"worker": socket.gethostname(), "python": platform.python_version(), "cuda": None}
    try:  # GPU 워커에서만 torch가 있다
        import torch

        info["cuda"] = {
            "available": torch.cuda.is_available(),
            "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }
    except ImportError:
        pass
    return info
