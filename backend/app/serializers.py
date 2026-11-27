"""DB 행 → openapi 응답 dict. 모양은 schemas_gen(openapi.json에서 생성)으로 검증한다."""
from typing import Any

from app import schemas_gen as S
from app.models import Task, User, UserSession


def user_out(u: User) -> dict[str, Any]:
    return {
        "user_id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "active": u.active,
        "must_change_password": u.must_change_password,
        "created_at": u.created_at,
        "updated_at": u.updated_at,
        "version": u.version,
    }


def user_summary_out(u: User) -> dict[str, Any]:
    return {"user_id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role, "active": u.active}


def login_out(u: User, session: UserSession) -> dict[str, Any]:
    from app.auth import session_expires_at

    return {"user": user_out(u), "csrf_token": session.csrf_token, "expires_at": session_expires_at(session)}


def task_out(t: Task) -> dict[str, Any]:
    return {
        "task_id": t.id,
        "kind": t.kind,
        "case_id": t.case_id,
        "video_id": t.video_id,
        "status": t.status,
        "stage": t.stage,
        "progress": t.progress,
        "seq": t.seq,
        "processed_samples": t.processed_samples,
        "total_samples": t.total_samples,
        "skipped_samples": t.skipped_samples,
        "heartbeat_at": t.heartbeat_at,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
        "error": t.error,
        "result": t.result,
    }


def dump(model: type[S.BaseModel], data: dict[str, Any]) -> dict[str, Any]:
    """명세 모델로 검증한 뒤 JSON으로 보낼 dict(시각은 RFC3339 문자열)."""
    return model.model_validate(data).model_dump(mode="json", exclude_unset=False)
