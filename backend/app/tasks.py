"""Celery 작업 등록. 실제 처리는 각 모듈(analysis, query_worker, …)에 있다."""
import platform
import socket

from app.worker import celery_app


@celery_app.task(name="left.system.ping")
def ping() -> dict:
    """api → Redis → 워커 → 결과 왕복 확인용."""
    info = {"worker": socket.gethostname(), "python": platform.python_version(), "cuda": None}
    try:  # 워커 이미지에만 torch가 있다
        import torch

        info["cuda"] = {
            "available": torch.cuda.is_available(),
            "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }
    except ImportError:
        pass
    return info


@celery_app.task(name="refind.video.analyze.v1", acks_late=True)
def analyze_video(task_id: str, video_id: int) -> dict:
    from app.analysis import run_video_analysis

    return run_video_analysis(task_id, video_id)


@celery_app.task(name="left.query.embed", acks_late=True)
def embed_query(task_id: str, case_id: int, query_version: int) -> dict:
    from app.query_worker import run_query_embedding

    return run_query_embedding(task_id, case_id, query_version)


@celery_app.task(name="left.walk.recalculate", acks_late=True)
def recalculate_walk(task_id: str, node_ids: list[int] | None = None, edge_ids: list[int] | None = None,
                     include_manual: bool = False) -> dict:
    """알고리즘 A: 노드 쌍마다 도보 경로 계산."""
    from app.walk_worker import run_walk_recalculation

    return run_walk_recalculation(task_id, node_ids, edge_ids, include_manual)
