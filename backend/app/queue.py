"""오래 걸리는 작업 접수: tasks 행을 DB에 먼저 커밋한 뒤 Celery로 보낸다(x-data-rules.queue).

큐 발행이 확실히 실패하면 작업을 failed(QUEUE_PUBLISH_FAILED)로 바꾼다.
워커는 task_id로 DB 행을 읽어 상태를 갱신한다. DB가 기준이고 Redis는 전달용이다.
"""
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth import utcnow
from app.models import Task

TASK_NAMES = {
    "video_analysis": ("refind.video.analyze.v1", "analysis"),
    "query_embedding": ("left.query.embed", "default"),
    "candidate_search": ("left.search.run", "default"),
    "walk_graph_recalculation": ("left.walk.recalculate", "default"),
}


def new_task(db: Session, kind: str, *, created_by: int | None, case_id: int | None = None,
             video_id: int | None = None, seq: int = 1) -> Task:
    task = Task(kind=kind, created_by=created_by, case_id=case_id, video_id=video_id, seq=seq)
    db.add(task)
    db.flush()
    db.refresh(task)
    return task


def publish(db: Session, task: Task, kwargs: dict[str, Any]) -> bool:
    """커밋된 작업을 큐에 보낸다. 실패하면 작업을 failed로 표시하고 False."""
    from app.worker import celery_app

    name, queue = TASK_NAMES[task.kind]
    try:
        celery_app.send_task(name, kwargs={"task_id": str(task.id), **kwargs}, queue=queue, task_id=str(task.id))
        return True
    except Exception:  # Redis 연결 실패 등
        mark_failed(db, task.id, "QUEUE_PUBLISH_FAILED", "작업 대기열에 넣지 못했어요. 잠시 후 다시 시도해 주세요.", retryable=True)
        return False


def mark_failed(db: Session, task_id: UUID, code: str, message: str, *, retryable: bool = False) -> None:
    task = db.get(Task, task_id)
    if task is None:
        return
    task.status, task.stage, task.updated_at = "failed", "failed", utcnow()
    task.error = {"code": code, "message": message, "retryable": retryable}
    db.commit()


def task_accepted(task: Task) -> dict[str, Any]:
    status = task.status if task.status in ("queued", "running") else "queued"
    return {"task_id": task.id, "status": status, "status_url": f"/api/tasks/{task.id}"}
