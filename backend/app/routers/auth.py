"""공통: 로그인·로그아웃·내 정보·비밀번호 변경 (SYS00-001, SYS01-007)."""
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import Field
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import (
    AuthContext,
    check_origin,
    clear_session_cookie,
    create_session,
    load_session,
    require_session,
    revoke_sessions,
    set_session_cookie,
    utcnow,
)
from app.common import (
    check_login_rate,
    clear_login_failures,
    login_rate_key,
    note_login_failure,
    record_audit,
    record_audit_detached,
)
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import User, UserSession
from app.security import hash_password, needs_rehash, password_policy_error, session_token_hash, verify_password
from app.serializers import dump, login_out

router = APIRouter(prefix="/api/auth", tags=["공통"])


class PasswordChangeBody(S.PasswordChangeRequest):
    """명세와 같은 필드. 길이 규칙은 Front와 같은 코드(PASSWORD_POLICY_VIOLATION)로 알리려고 직접 검사한다."""

    new_password: Annotated[str, Field(max_length=1024, min_length=1)]
NO_STORE = {"Cache-Control": "no-store"}


@router.post("/login", response_model=S.LoginResponse, summary="로그인")
def login(body: S.LoginRequest, request: Request, db: Session = Depends(get_db)):
    """최초·초기화 로그인도 제한 세션을 준다. 실패 사유로 계정 존재 여부를 드러내지 않는다."""
    check_origin(request)
    rate_key = login_rate_key(request, body.username)
    check_login_rate(rate_key)

    user = db.scalar(select(User).where(User.username == body.username))
    if not verify_password(user.password_hash if user else None, body.password):
        note_login_failure(rate_key)
        record_audit_detached(request, user, "LOGIN", "session", result="failure")
        raise ApiError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 맞지 않아요.")
    if not user.active:
        record_audit_detached(request, user, "LOGIN", "session", result="failure")
        raise ApiError(403, "ACCOUNT_INACTIVE", "비활성화된 계정이에요. 관리자에게 문의하세요.")
    clear_login_failures(rate_key)
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    # 이 브라우저의 이전 세션은 끝낸다(세션 고정 방지)
    old = request.cookies.get(get_settings().session_cookie_name)
    if old and (prev := db.get(UserSession, session_token_hash(old))) and prev.revoked_at is None:
        prev.revoked_at, prev.revoked_reason = utcnow(), "replaced"

    token, session = create_session(db, user)
    record_audit(db, request, user, "LOGIN", "session")
    db.commit()
    response = JSONResponse(dump(S.LoginResponse, login_out(user, session)), headers=NO_STORE)
    set_session_cookie(response, token)
    return response


@router.post("/logout", response_model=S.MessageResponse, summary="로그아웃")
def logout(request: Request, auth: AuthContext = Depends(require_session), db: Session = Depends(get_db)):
    auth.session.revoked_at, auth.session.revoked_reason = utcnow(), "logout"
    record_audit(db, request, auth.user, "LOGOUT", "session")
    db.commit()
    response = JSONResponse({"message": "로그아웃했어요."}, headers=NO_STORE)
    clear_session_cookie(response)
    return response


@router.get("/me", response_model=S.LoginResponse, summary="내 정보·역할 조회")
def me(auth: AuthContext = Depends(load_session)):
    """R4: 세션으로 사용자와 CSRF 토큰을 복원한다. 조회만으로 토큰을 바꾸지 않는다(다른 탭 유지)."""
    return JSONResponse(dump(S.LoginResponse, login_out(auth.user, auth.session)), headers=NO_STORE)


@router.post("/password", response_model=S.PasswordChangeResponse, summary="비밀번호 변경·최초 로그인 변경")
def change_password(
    body: PasswordChangeBody,
    request: Request,
    auth: AuthContext = Depends(require_session),
    db: Session = Depends(get_db),
):
    """현재 세션을 새 세션으로 바꾸고(새 CSRF 토큰) 다른 세션은 모두 끝낸다."""
    user = db.scalar(select(User).where(User.id == auth.user.id).with_for_update())
    if not verify_password(user.password_hash, body.current_password):
        raise ApiError(401, "CURRENT_PASSWORD_INVALID", "현재 비밀번호가 맞지 않아요.")
    if body.new_password == body.current_password:
        raise ApiError(422, "PASSWORD_UNCHANGED", "지금 비밀번호와 다른 비밀번호를 정해 주세요.",
                       fields=[{"field": "new_password", "code": "unchanged", "message": "현재와 같음"}])
    if problem := password_policy_error(body.new_password):
        raise ApiError(422, "PASSWORD_POLICY_VIOLATION", problem,
                       fields=[{"field": "new_password", "code": "policy", "message": problem}])
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    user.version += 1
    user.updated_at = utcnow()
    revoke_sessions(db, user.id, "password_changed")
    token, session = create_session(db, user)
    record_audit(db, request, user, "PASSWORD_CHANGE", "user", user.id, changed_fields=["password"])
    db.commit()
    db.refresh(user)
    response = JSONResponse(dump(S.PasswordChangeResponse, login_out(user, session)), headers=NO_STORE)
    set_session_cookie(response, token)
    return response
