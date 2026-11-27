"""공통: 작업 상태 조회(폴링). admin, 사건 담당자, 본인이 접수한 작업만. 그 밖에는 404."""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, can_access_case, require_user
from app.db import get_db
from app.errors import ApiError
from app.models import Task
from app.serializers import dump, task_out

router = APIRouter(prefix="/api/tasks", tags=["공통"])


@router.get("/{task_id}", response_model=S.Task, summary="작업 상태 조회")
def get_task(task_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    not_found = ApiError(404, "TASK_NOT_FOUND", "작업을 찾을 수 없어요.")
    try:
        tid = UUID(task_id)
    except ValueError:
        raise not_found from None
    task = db.get(Task, tid)
    if task is None:
        raise not_found
    allowed = (
        auth.is_admin
        or task.created_by == auth.user.id
        or (task.case_id is not None and can_access_case(db, auth, task.case_id))
    )
    if not allowed:
        raise not_found
    return dump(S.Task, task_out(task))
