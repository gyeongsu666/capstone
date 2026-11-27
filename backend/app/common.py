"""여러 API가 함께 쓰는 규칙: 버전 검사, cursor 목록, 멱등 키, 이용 기록, 로그인 시도 제한.

openapi x-data-rules:
- concurrency: expected_version 낙관적 잠금, 틀리면 409 VERSION_CONFLICT(context.current_version)
- pagination: cursor/limit(기본 30, 최대 100), next_cursor/has_more. cursor는 불투명 문자열
- idempotency: 생성·업로드·검색·판정/번복·재처리 POST에 필수. 같은 사용자·작업·키·본문(파일 SHA-256 포함)일 때만 재사용
"""
import base64
import hashlib
import hmac
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import Select, and_, delete, or_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiError, request_id_of
from app.models import AuditLog, IdempotencyKey, User

# ---------------------------------------------------------------- 버전
VERSION_CONFLICT_MESSAGE = "다른 사람이 먼저 수정했어요. 다시 불러온 뒤 시도하세요."


def check_version(current: int, expected: int, *, code: str = "VERSION_CONFLICT", context: dict | None = None) -> None:
    if current != expected:
        raise ApiError(409, code, VERSION_CONFLICT_MESSAGE, context={"current_version": current, **(context or {})})


# ---------------------------------------------------------------- cursor 목록
DEFAULT_LIMIT, MAX_LIMIT = 30, 100
LimitParam = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
CursorParam = Query(None, max_length=512)


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"$dt": value.isoformat()}
    if isinstance(value, UUID):
        return {"$uuid": str(value)}
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(type(value).__name__)


def _json_hook(obj: dict) -> Any:
    if "$dt" in obj:
        return datetime.fromisoformat(obj["$dt"])
    if "$uuid" in obj:
        return UUID(obj["$uuid"])
    return obj


def _sign(payload: bytes) -> bytes:
    return hmac.new(get_settings().session_secret.encode(), b"cursor:" + payload, hashlib.sha256).digest()[:12]


def encode_cursor(values: Sequence[Any], scope: str) -> str:
    payload = json.dumps({"s": scope, "v": list(values)}, default=_json_default, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(_sign(payload) + payload).decode().rstrip("=")


def decode_cursor(cursor: str, scope: str) -> list[Any]:
    """서명이 맞고 같은 목록(scope)에서 만든 cursor만 받는다. 필터가 바뀌면 scope가 달라 거절된다."""
    bad = ApiError(422, "VALIDATION_ERROR", "목록 위치(cursor)가 올바르지 않아요. 처음부터 다시 불러 주세요.",
                   fields=[{"field": "cursor", "code": "invalid", "message": "알 수 없는 cursor"}])
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        sig, payload = raw[:12], raw[12:]
        if not hmac.compare_digest(sig, _sign(payload)):
            raise bad
        data = json.loads(payload, object_hook=_json_hook)
    except ApiError:
        raise
    except Exception:
        raise bad from None
    if data.get("s") != scope:
        raise bad
    return data["v"]


@dataclass
class SortKey:
    column: Any  # SQLAlchemy 컬럼 식
    descending: bool = True


@dataclass
class Page:
    rows: list[Any]
    next_cursor: str | None

    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None


def keyset_page(
    db: Session,
    stmt: Select,
    keys: Sequence[SortKey],
    *,
    limit: int,
    cursor: str | None,
    scope: str,
    key_of: Callable[[Any], Sequence[Any]],
    scalars: bool = True,
) -> Page:
    """정렬 키(마지막은 고유한 ID)로 안정 정렬한 keyset 페이지. 페이지 사이에 행이 늘거나 줄어도 중복·누락이 없다."""
    if cursor:
        values = decode_cursor(cursor, scope)
        if len(values) != len(keys):
            raise ApiError(422, "VALIDATION_ERROR", "목록 위치(cursor)가 올바르지 않아요.")
        clauses = []
        for i, key in enumerate(keys):
            equal_prefix = [keys[j].column == values[j] for j in range(i)]
            after = key.column < values[i] if key.descending else key.column > values[i]
            clauses.append(and_(*equal_prefix, after))
        stmt = stmt.where(or_(*clauses))
    stmt = stmt.order_by(*[k.column.desc() if k.descending else k.column.asc() for k in keys]).limit(limit + 1)
    # scalars=True: select(모델) 한 개, False: 여러 열을 Row로 받는다
    rows = list(db.scalars(stmt).all() if scalars else db.execute(stmt).all())
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = encode_cursor(key_of(rows[-1]), scope)
    return Page(rows=rows, next_cursor=next_cursor)


def scope_of(name: str, **filters: Any) -> str:
    """목록 이름 + 필터로 cursor 범위를 만든다(필터가 바뀌면 이전 cursor는 거절)."""
    blob = json.dumps(filters, sort_keys=True, default=str, separators=(",", ":"))
    return f"{name}:{hashlib.sha256(blob.encode()).hexdigest()[:16]}"


# ---------------------------------------------------------------- 멱등 키
IDEMPOTENCY_HEADER = "Idempotency-Key"


def request_fingerprint(body: Any = None, *, files: Sequence[str] = (), extra: dict | None = None) -> str:
    """정규화한 본문 + 파일 SHA-256 + 경로 값으로 만든 해시."""
    doc = {"body": body, "files": list(files), "extra": extra or {}}
    blob = json.dumps(doc, sort_keys=True, default=str, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


class Idempotency:
    """사용법(같은 트랜잭션 안에서):
        idem = Idempotency.begin(db, request, user, "create_case", fingerprint)
        if idem.replay: return idem.replay
        ...작업...
        return idem.complete(201, body)   # 커밋은 호출한 쪽이 한다
    같은 키로 동시에 들어오면 두 번째 요청은 첫 요청의 커밋을 기다렸다가 저장된 응답을 받는다.
    """

    def __init__(self, db: Session, row: IdempotencyKey | None, replay: JSONResponse | None):
        self.db, self.row, self.replay = db, row, replay

    @classmethod
    def begin(cls, db: Session, request: Request, user: User, operation: str, fingerprint: str) -> "Idempotency":
        key = (request.headers.get(IDEMPOTENCY_HEADER) or "").strip()
        if not key:
            raise ApiError(422, "VALIDATION_ERROR", "Idempotency-Key 헤더가 필요해요.",
                           fields=[{"field": IDEMPOTENCY_HEADER, "code": "required", "message": "필수 헤더"}])
        if len(key) > 128:
            raise ApiError(422, "VALIDATION_ERROR", "Idempotency-Key가 너무 길어요(128자 이하).",
                           fields=[{"field": IDEMPOTENCY_HEADER, "code": "too_long", "message": "128자 이하"}])
        now = datetime.now(timezone.utc)
        db.execute(delete(IdempotencyKey).where(
            IdempotencyKey.user_id == user.id, IdempotencyKey.operation == operation,
            IdempotencyKey.key == key, IdempotencyKey.expires_at <= now,
        ))
        inserted = db.execute(
            insert(IdempotencyKey)
            .values(user_id=user.id, operation=operation, key=key, request_hash=fingerprint,
                    state="in_progress", created_at=now,
                    expires_at=now + timedelta(hours=get_settings().idempotency_ttl_hours))
            .on_conflict_do_nothing()
            .returning(IdempotencyKey.key)
        ).first()
        row = db.get(IdempotencyKey, (user.id, operation, key))
        if inserted:
            return cls(db, row, None)
        if row.request_hash != fingerprint:
            raise ApiError(409, "IDEMPOTENCY_KEY_REUSED", "같은 요청 키를 다른 내용에 다시 쓸 수 없어요. 새로 시도해 주세요.")
        if row.state != "completed":
            raise ApiError(409, "IDEMPOTENCY_KEY_REUSED", "같은 요청을 처리하고 있어요. 잠시 후 상태를 다시 확인해 주세요.", retryable=True)
        return cls(db, row, JSONResponse(status_code=row.response_status, content=row.response_body,
                                         headers={"Idempotent-Replayed": "true", "Cache-Control": "no-store"}))

    def complete(self, status: int, body: Any, headers: dict[str, str] | None = None) -> JSONResponse:
        self.row.state = "completed"
        self.row.response_status = status
        self.row.response_body = body
        return JSONResponse(status_code=status, content=body, headers={"Cache-Control": "no-store", **(headers or {})})


# ---------------------------------------------------------------- 이용 기록
def record_audit(
    db: Session,
    request: Request,
    actor: User | None,
    action: str,
    resource_type: str,
    resource_id: Any = None,
    *,
    case_id: int | None = None,
    result: str = "success",
    changed_fields: Sequence[str] = (),
) -> None:
    """같은 트랜잭션에 이용 기록을 더한다. 비밀번호·토큰·파일 경로는 넣지 않는다."""
    db.add(AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_name=actor.display_name if actor else None,
        case_id=case_id,
        action=action,
        resource_type=resource_type,
        resource_id=None if resource_id is None else str(resource_id),
        request_id=request_id_of(request),
        result=result,
        changed_fields=list(changed_fields),
    ))


def record_audit_detached(request: Request, actor: User | None, action: str, resource_type: str,
                          resource_id: Any = None, *, result: str = "failure") -> None:
    """요청 트랜잭션이 롤백돼도 남겨야 하는 기록(로그인 실패 등)."""
    from app.db import session_scope

    with session_scope() as db:
        record_audit(db, request, db.merge(actor) if actor else None, action, resource_type, resource_id, result=result)


# ---------------------------------------------------------------- 로그인 시도 제한
LOGIN_MAX_FAILURES, LOGIN_WINDOW_S = 10, 15 * 60


def _redis():
    import redis

    return redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)


def login_rate_key(request: Request, username: str) -> str:
    ip = request.client.host if request.client else "-"
    return "login-fail:" + hashlib.sha256(f"{ip}|{username.lower()}".encode()).hexdigest()[:24]


def check_login_rate(key: str) -> None:
    """같은 IP·아이디로 15분에 10번 틀리면 429. Redis가 없으면 제한 없이 통과한다."""
    try:
        r = _redis()
        failures = int(r.get(key) or 0)
        if failures >= LOGIN_MAX_FAILURES:
            ttl = max(int(r.ttl(key)), 1)
            raise ApiError(429, "RATE_LIMITED", "로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
                           headers={"Retry-After": str(ttl)}, retryable=True)
    except ApiError:
        raise
    except Exception:
        return


def note_login_failure(key: str) -> None:
    try:
        r = _redis()
        pipe = r.pipeline()
        pipe.incr(key)
        pipe.expire(key, LOGIN_WINDOW_S, nx=True)
        pipe.execute()
    except Exception:
        return


def clear_login_failures(key: str) -> None:
    try:
        _redis().delete(key)
    except Exception:
        return


