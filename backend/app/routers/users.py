"""관리자·계정(SYS01-007), 공동 담당 계정 검색(SYS02-012), 이용 기록(SYS01-008)."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, require_admin, require_user, revoke_sessions, utcnow
from app.common import (
    CursorParam,
    Idempotency,
    LimitParam,
    SortKey,
    check_version,
    keyset_page,
    record_audit,
    request_fingerprint,
    scope_of,
)
from app.db import get_db
from app.errors import ApiError
from app.models import AuditLog, Case, User
from app.security import hash_password, temporary_password
from app.serializers import dump, user_out, user_summary_out

router = APIRouter(tags=["관리자·계정"])
NO_STORE = {"Cache-Control": "no-store"}


def _get_user(db: Session, user_id: int, *, for_update: bool = False) -> User:
    stmt = select(User).where(User.id == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    user = db.scalar(stmt)
    if user is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "계정을 찾을 수 없어요.")
    return user


def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _active_admins(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.active)) or 0


def _page_response(model, items, page) -> dict:
    return dump(model, {"items": items, "next_cursor": page.next_cursor, "has_more": page.has_more})


@router.get("/api/users", response_model=S.UserPage, summary="계정 목록")
def list_users(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    active: bool | None = None,
    role: str | None = Query(None, pattern="^(user|admin)$"),
    query: str | None = Query(None, max_length=100),
    _: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(User)
    if active is not None:
        stmt = stmt.where(User.active.is_(active))
    if role:
        stmt = stmt.where(User.role == role)
    if query:
        stmt = stmt.where(or_(User.username.ilike(_like(query)), User.display_name.ilike(_like(query))))
    page = keyset_page(db, stmt, [SortKey(User.created_at), SortKey(User.id)], limit=limit, cursor=cursor,
                       scope=scope_of("users", active=active, role=role, query=query), key_of=lambda u: (u.created_at, u.id))
    return _page_response(S.UserPage, [user_out(u) for u in page.rows], page)


@router.post("/api/users", status_code=201, response_model=S.TemporaryPasswordResponse, summary="계정 생성")
def create_user(body: S.UserCreateRequest, request: Request, auth: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    """임시 비밀번호는 응답에 한 번 보여 준다. 같은 요청 재전송(멱등) 때만 같은 응답을 다시 준다."""
    data = body.model_dump(mode="json")
    idem = Idempotency.begin(db, request, auth.user, "create_user", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    username = data["username"].strip()
    if db.scalar(select(User.id).where(func.lower(User.username) == username.lower())):
        raise ApiError(409, "USERNAME_ALREADY_EXISTS", "이미 있는 아이디예요.",
                       fields=[{"field": "username", "code": "duplicate", "message": "이미 있음"}])
    password = temporary_password()
    user = User(username=username, display_name=data["display_name"].strip(), role=data["role"],
                password_hash=hash_password(password), must_change_password=True)
    db.add(user)
    db.flush()
    db.refresh(user)
    record_audit(db, request, auth.user, "ACCOUNT_CREATE", "user", user.id, changed_fields=["username", "display_name", "role"])
    out = dump(S.TemporaryPasswordResponse, {"user": user_out(user), "temporary_password": password, "must_change_password": True})
    response = idem.complete(201, out)
    db.commit()
    return response


@router.patch("/api/users/{user_id}/role", response_model=S.User, summary="역할 변경")
def change_role(user_id: int, body: S.UserRolePatch, request: Request, auth: AuthContext = Depends(require_admin),
                db: Session = Depends(get_db)):
    data = body.model_dump(mode="json")
    user = _get_user(db, user_id, for_update=True)
    check_version(user.version, data["expected_version"])
    if not user.active:
        raise ApiError(409, "USER_INACTIVE", "비활성화된 계정이에요.")
    if user.role == data["role"]:
        return dump(S.User, user_out(user))
    if user.role == "admin" and _active_admins(db) <= 1:
        raise ApiError(409, "LAST_ADMIN_PROTECTED", "마지막 관리자는 강등할 수 없어요.")
    user.role, user.version, user.updated_at = data["role"], user.version + 1, utcnow()
    revoke_sessions(db, user.id, "role_changed")  # 권한이 바뀌면 다시 로그인
    record_audit(db, request, auth.user, "ACCOUNT_ROLE_CHANGE", "user", user.id, changed_fields=["role"])
    db.commit()
    db.refresh(user)
    return dump(S.User, user_out(user))


@router.post("/api/users/{user_id}/deactivate", response_model=S.User, summary="계정 비활성화")
def deactivate_user(user_id: int, body: S.UserDeactivateRequest, request: Request,
                    auth: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    """삭제하지 않고 비활성화(이력 보존). 진행 중 사건의 주 담당자는 비활성화할 수 없다."""
    data = body.model_dump(mode="json")
    user = _get_user(db, user_id, for_update=True)
    check_version(user.version, data["expected_version"])
    if not user.active:
        return dump(S.User, user_out(user))
    if user.role == "admin" and _active_admins(db) <= 1:
        raise ApiError(409, "LAST_ADMIN_PROTECTED", "마지막 관리자는 비활성화할 수 없어요.")
    owned = db.scalars(select(Case.id).where(Case.owner_id == user.id, Case.status == "open")).all()
    if owned:
        raise ApiError(409, "ACTIVE_CASE_OWNER", "진행 중인 사건의 주 담당자예요. 사건을 먼저 종료해 주세요.",
                       context={"blocking_case_ids": list(owned)})
    now = utcnow()
    user.active, user.deactivated_at, user.deactivation_reason = False, now, data["reason"]
    user.version, user.updated_at = user.version + 1, now
    revoke_sessions(db, user.id, "deactivated")
    record_audit(db, request, auth.user, "ACCOUNT_DEACTIVATE", "user", user.id, changed_fields=["active"])
    db.commit()
    db.refresh(user)
    return dump(S.User, user_out(user))


@router.post("/api/users/{user_id}/password-reset", response_model=S.TemporaryPasswordResponse, summary="비밀번호 초기화")
def reset_password(user_id: int, body: S.PasswordResetRequest, request: Request,
                   auth: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    data = body.model_dump(mode="json")
    idem = Idempotency.begin(db, request, auth.user, f"reset_password:{user_id}", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    user = _get_user(db, user_id, for_update=True)
    check_version(user.version, data["expected_version"])
    if not user.active:
        raise ApiError(409, "USER_INACTIVE", "비활성화된 계정이에요.")
    password = temporary_password()
    user.password_hash, user.must_change_password = hash_password(password), True
    user.version, user.updated_at = user.version + 1, utcnow()
    revoke_sessions(db, user.id, "password_reset")
    record_audit(db, request, auth.user, "ACCOUNT_PASSWORD_RESET", "user", user.id, changed_fields=["password"])
    db.flush()
    db.refresh(user)
    out = dump(S.TemporaryPasswordResponse, {"user": user_out(user), "temporary_password": password, "must_change_password": True})
    response = idem.complete(200, out)
    db.commit()
    return response


@router.get("/api/users/directory", response_model=S.UserDirectoryPage, tags=["보조 조회"], summary="공동 담당 추가용 계정 검색")
def user_directory(
    query: str = Query(..., max_length=100),
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    _: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """활성 계정의 이름·아이디·역할만. 관리자 정보(임시 비밀번호 등)는 없다."""
    stmt = select(User).where(User.active)
    q = query.strip()
    if q:
        stmt = stmt.where(or_(User.username.ilike(_like(q)), User.display_name.ilike(_like(q))))
    page = keyset_page(db, stmt, [SortKey(User.display_name, False), SortKey(User.id, False)], limit=limit, cursor=cursor,
                       scope=scope_of("directory", q=q), key_of=lambda u: (u.display_name, u.id))
    return _page_response(S.UserDirectoryPage, [user_summary_out(u) for u in page.rows], page)


@router.get("/api/audit-logs", response_model=S.AuditPage, tags=["관리자·이용 기록"], summary="이용 기록 조회")
def list_audit_logs(
    request: Request,
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    user_id: int | None = Query(None, ge=1),
    case_id: int | None = Query(None, ge=1),
    action: str | None = Query(None, max_length=50),
    result: str | None = Query(None, pattern="^(success|failure)$"),
    auth: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    for name, value in (("from", from_), ("to", to)):
        if value is not None and value.tzinfo is None:
            raise ApiError(422, "VALIDATION_ERROR", "시각에는 시간대가 있어야 해요.", fields=[{"field": name, "code": "timezone", "message": "시간대 필요"}])
    if from_ and to and from_ > to:
        raise ApiError(422, "VALIDATION_ERROR", "기간의 시작이 끝보다 늦어요.", fields=[{"field": "from", "code": "range", "message": "from ≤ to"}])
    stmt = select(AuditLog)
    if from_:
        stmt = stmt.where(AuditLog.occurred_at >= from_)
    if to:
        stmt = stmt.where(AuditLog.occurred_at <= to)
    if user_id:
        stmt = stmt.where(AuditLog.actor_user_id == user_id)
    if case_id:
        stmt = stmt.where(AuditLog.case_id == case_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if result:
        stmt = stmt.where(AuditLog.result == result)
    page = keyset_page(db, stmt, [SortKey(AuditLog.occurred_at), SortKey(AuditLog.id)], limit=limit, cursor=cursor,
                       scope=scope_of("audit", f=from_, t=to, u=user_id, c=case_id, a=action, r=result),
                       key_of=lambda r: (r.occurred_at, r.id))
    items = [{
        "log_id": str(r.id), "occurred_at": r.occurred_at, "actor_user_id": r.actor_user_id, "actor_name": r.actor_name,
        "case_id": r.case_id, "action": r.action, "resource_type": r.resource_type, "resource_id": r.resource_id,
        "request_id": r.request_id, "result": r.result, "changed_fields": list(r.changed_fields),
    } for r in page.rows]
    # 조회 자체도 기록(첫 페이지만)
    if not cursor:
        record_audit(db, request, auth.user, "AUDIT_VIEW", "audit_log")
        db.commit()
    return JSONResponse(_page_response(S.AuditPage, items, page), headers=NO_STORE)
