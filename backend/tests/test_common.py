"""3단계 공통 부품: 멱등 키, cursor 목록, 버전 검사, 사건 접근 (실제 PostgreSQL)."""
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.errors import ApiError

pytestmark = pytest.mark.db


def fake_request(key: str | None):
    headers = [] if key is None else [(b"idempotency-key", key.encode())]
    return Request({"type": "http", "method": "POST", "path": "/x", "headers": headers, "query_string": b""})


def test_idempotency_replays_same_body_and_rejects_different(make_user):
    from app.common import Idempotency, request_fingerprint
    from app.db import session_scope

    user, _ = make_user()
    fp = request_fingerprint({"title": "A"})
    with session_scope() as db:
        idem = Idempotency.begin(db, fake_request("k1"), user, "create_case", fp)
        assert idem.replay is None
        idem.complete(201, {"case_id": 7})
    with session_scope() as db:
        again = Idempotency.begin(db, fake_request("k1"), user, "create_case", fp)
        assert again.replay is not None and again.replay.status_code == 201
        assert again.replay.body == b'{"case_id":7}'
        with pytest.raises(ApiError) as e:
            Idempotency.begin(db, fake_request("k1"), user, "create_case", request_fingerprint({"title": "B"}))
        assert e.value.status == 409 and e.value.code == "IDEMPOTENCY_KEY_REUSED"
        # 다른 작업 이름이면 같은 키도 별개
        assert Idempotency.begin(db, fake_request("k1"), user, "upload_video", fp).replay is None


def test_idempotency_key_released_when_operation_fails(make_user):
    from app.common import Idempotency, request_fingerprint
    from app.db import session_scope

    user, _ = make_user()
    fp = request_fingerprint({"x": 1})
    with pytest.raises(RuntimeError):
        with session_scope() as db:
            Idempotency.begin(db, fake_request("k2"), user, "op", fp)
            raise RuntimeError("작업 실패 → 롤백")
    with session_scope() as db:  # 같은 키로 다시 시도할 수 있다
        assert Idempotency.begin(db, fake_request("k2"), user, "op", fp).replay is None


def test_idempotency_header_required(make_user):
    from app.common import Idempotency
    from app.db import session_scope

    user, _ = make_user()
    with session_scope() as db, pytest.raises(ApiError) as e:
        Idempotency.begin(db, fake_request(None), user, "op", "h")
    assert e.value.status == 422 and e.value.fields[0]["field"] == "Idempotency-Key"


def test_keyset_pages_have_no_duplicates_or_gaps_even_when_rows_inserted(make_user):
    from sqlalchemy import select

    from app.common import SortKey, keyset_page, scope_of
    from app.db import session_scope
    from app.models import AuditLog

    make_user()
    with session_scope() as db:
        for i in range(7):
            db.add(AuditLog(action=f"A{i}", resource_type="t", request_id="r", result="success"))
    keys = [SortKey(AuditLog.occurred_at), SortKey(AuditLog.id)]  # 같은 시각이 많아 ID로 끝까지 정렬
    scope = scope_of("audit", user=None)
    seen, cursor = [], None
    with session_scope() as db:
        first = keyset_page(db, select(AuditLog), keys, limit=3, cursor=None, scope=scope,
                            key_of=lambda r: (r.occurred_at, r.id))
        seen += [r.id for r in first.rows]
        cursor = first.next_cursor
        db.add(AuditLog(action="NEW", resource_type="t", request_id="r", result="success"))  # 페이지 사이 새 행
        db.flush()
        while cursor:
            page = keyset_page(db, select(AuditLog), keys, limit=3, cursor=cursor, scope=scope,
                               key_of=lambda r: (r.occurred_at, r.id))
            seen += [r.id for r in page.rows]
            cursor = page.next_cursor
    assert seen == [7, 6, 5, 4, 3, 2, 1]
    assert first.has_more


def test_cursor_is_tamper_proof_and_scoped():
    from app.common import decode_cursor, encode_cursor

    c = encode_cursor([5, "x"], "cases:abc")
    assert decode_cursor(c, "cases:abc") == [5, "x"]
    for bad, scope in [(c, "cases:other"), (c[:-2] + "AA", "cases:abc"), ("garbage", "cases:abc")]:
        with pytest.raises(ApiError) as e:
            decode_cursor(bad, scope)
        assert e.value.code == "VALIDATION_ERROR"


def test_version_conflict_has_current_version():
    from app.common import check_version

    check_version(3, 3)
    with pytest.raises(ApiError) as e:
        check_version(4, 3)
    assert e.value.status == 409 and e.value.code == "VERSION_CONFLICT" and e.value.context["current_version"] == 4


def test_case_access_hides_unassigned_cases_as_404(make_user):
    from app.auth import AuthContext, ensure_case_open, load_case
    from app.db import session_scope
    from app.models import Case, CaseAssignee

    member, _ = make_user("member")
    stranger, _ = make_user("stranger")
    admin, _ = make_user("boss", role="admin")
    with session_scope() as db:
        case = Case(title="t", person_type="child", person_name="김민준", last_seen_at=member.created_at,
                    last_seen_location="SRID=4326;POINT(126.43 34.91)", owner_id=member.id, similarity_threshold=0.6)
        db.add(case)
        db.flush()
        db.add(CaseAssignee(case_id=case.id, user_id=member.id, is_owner=True, assigned_by=member.id))
        cid = case.id
    with session_scope() as db:
        ctx = lambda u: AuthContext(user=u, session=SimpleNamespace())  # noqa: E731
        assert load_case(db, ctx(member), cid).id == cid
        assert load_case(db, ctx(admin), cid).id == cid
        with pytest.raises(ApiError) as e:
            load_case(db, ctx(stranger), cid)
        assert e.value.status == 404 and e.value.message == "사건을 찾을 수 없거나 접근 권한이 없습니다."
        with pytest.raises(ApiError):
            load_case(db, ctx(member), 999)
        c = load_case(db, ctx(member), cid)
        c.status, c.close_outcome, c.closed_at = "closed", "unresolved", member.created_at
        with pytest.raises(ApiError) as e:
            ensure_case_open(c)
        assert e.value.code == "CASE_CLOSED"
