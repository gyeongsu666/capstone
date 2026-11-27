"""세션 쿠키 인증, CSRF·Origin 검사, 첫 로그인 제한, 역할·사건 접근 검사.

openapi x-security-rules:
- 세션: HttpOnly 쿠키 refind_session(서버 저장 불투명 토큰). 오래 안 쓰면 401 SESSION_EXPIRED
- 변경 요청(GET·HEAD 외): X-CSRF-Token + 허용 Origin. 틀리면 403 CSRF_INVALID
- must_change_password면 /auth/me·/auth/password·/auth/logout만 허용, 나머지 403 PASSWORD_CHANGE_REQUIRED
- admin은 전체 사건, user는 주 담당·공동 담당 사건만. 맡지 않은 사건은 404
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Case, CaseAssignee, User, UserSession
from app.security import new_csrf_token, new_session_token, session_token_hash, tokens_equal

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
SLIDE_EVERY = timedelta(seconds=60)  # 마지막 사용 시각 갱신 간격(요청마다 쓰지 않는다)
CASE_NOT_FOUND = "사건을 찾을 수 없거나 접근 권한이 없습니다."


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class AuthContext:
    user: User
    session: UserSession

    @property
    def is_admin(self) -> bool:
        return self.user.role == "admin"


# ---------------------------------------------------------------- 쿠키
def set_session_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        s.session_cookie_name,
        token,
        max_age=s.session_absolute_hours * 3600,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.session_cookie_name, path="/", httponly=True, secure=s.cookie_secure, samesite="lax")


# ---------------------------------------------------------------- 세션
def create_session(db: Session, user: User) -> tuple[str, UserSession]:
    """새 세션을 만든다. 원문 토큰은 쿠키로만 내보낸다."""
    s = get_settings()
    now = utcnow()
    token = new_session_token()
    row = UserSession(
        token_hash=session_token_hash(token),
        user_id=user.id,
        csrf_token=new_csrf_token(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(minutes=s.session_idle_minutes),
        absolute_expires_at=now + timedelta(hours=s.session_absolute_hours),
    )
    db.add(row)
    return token, row


def revoke_sessions(db: Session, user_id: int, reason: str, *, except_hash: str | None = None) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_hash:
        stmt = stmt.where(UserSession.token_hash != except_hash)
    db.execute(stmt.values(revoked_at=utcnow(), revoked_reason=reason))


def session_expires_at(row: UserSession) -> datetime:
    return min(row.expires_at, row.absolute_expires_at)


def _unauthenticated(code: str = "UNAUTHENTICATED") -> ApiError:
    message = "오래 사용하지 않아 로그아웃됐어요. 다시 로그인해 주세요." if code == "SESSION_EXPIRED" else "로그인이 필요해요."
    return ApiError(401, code, message, clear_session_cookie=True)


def check_origin(request: Request) -> None:
    """Origin이 있으면 허용 목록과 같아야 한다(브라우저 밖 도구는 Origin이 없을 수 있다)."""
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in {o.rstrip("/") for o in get_settings().allowed_origins}:
        raise ApiError(403, "CSRF_INVALID", "허용되지 않은 출처의 요청이에요.")


def load_session(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    """쿠키 → 유효한 세션과 사용자. CSRF와 첫 로그인 제한은 검사하지 않는다."""
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        raise _unauthenticated()
    row = db.get(UserSession, session_token_hash(token))
    if row is None or row.revoked_at is not None:
        raise _unauthenticated()
    now = utcnow()
    if now >= session_expires_at(row):
        row.revoked_at, row.revoked_reason = now, "expired"
        db.commit()
        raise _unauthenticated("SESSION_EXPIRED")
    user = db.get(User, row.user_id)
    if user is None or not user.active:
        row.revoked_at, row.revoked_reason = now, "inactive"
        db.commit()
        raise _unauthenticated()
    if now - row.last_seen_at >= SLIDE_EVERY:
        s = get_settings()
        row.last_seen_at = now
        row.expires_at = min(now + timedelta(minutes=s.session_idle_minutes), row.absolute_expires_at)
        db.commit()
    return AuthContext(user=user, session=row)


def require_session(request: Request, auth: AuthContext = Depends(load_session)) -> AuthContext:
    """로그인 세션 + 변경 요청이면 CSRF·Origin. 첫 로그인 제한 세션도 통과(me·password·logout용)."""
    if request.method not in SAFE_METHODS:
        check_origin(request)
        if not tokens_equal(request.headers.get("x-csrf-token"), auth.session.csrf_token):
            raise ApiError(403, "CSRF_INVALID", "요청을 확인하지 못했어요. 새로고침 후 다시 시도하세요.")
    return auth


def require_user(auth: AuthContext = Depends(require_session)) -> AuthContext:
    """일반 API용: 첫 로그인 비밀번호 변경 전이면 막는다."""
    if auth.user.must_change_password:
        raise ApiError(403, "PASSWORD_CHANGE_REQUIRED", "비밀번호를 먼저 바꿔 주세요.")
    return auth


def require_admin(auth: AuthContext = Depends(require_user)) -> AuthContext:
    if not auth.is_admin:
        raise ApiError(403, "FORBIDDEN", "관리자만 할 수 있어요.")
    return auth


# ---------------------------------------------------------------- 사건 접근
def can_access_case(db: Session, auth: AuthContext, case_id: int) -> bool:
    if auth.is_admin:
        return True
    return db.scalar(
        select(CaseAssignee.user_id).where(CaseAssignee.case_id == case_id, CaseAssignee.user_id == auth.user.id)
    ) is not None


def load_case(db: Session, auth: AuthContext, case_id: int, *, for_update: bool = False) -> Case:
    """맡은 사건(관리자는 전체)만. 없거나 권한이 없으면 같은 404로 존재 여부를 숨긴다."""
    if not can_access_case(db, auth, case_id):
        raise ApiError(404, "RESOURCE_NOT_FOUND", CASE_NOT_FOUND)
    stmt = select(Case).where(Case.id == case_id)
    if for_update:
        stmt = stmt.with_for_update()
    case = db.scalar(stmt)
    if case is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", CASE_NOT_FOUND)
    return case


def ensure_case_open(case: Case) -> None:
    """종료 사건은 관리자도 바꿀 수 없다(읽기 전용)."""
    if case.status != "open":
        raise ApiError(409, "CASE_CLOSED", "종료된 사건이에요.", context={"case_id": case.id, "current_status": case.status})
