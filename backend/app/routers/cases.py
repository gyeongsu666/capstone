"""사건(SYS02-001·011), 공동 담당(SYS02-012), 검색 조건(SYS02-003), 미처리 알림 집계(R2)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, ensure_case_open, load_case, require_user, utcnow
from app.case_view import assignees_out, case_out, conditions_out
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
from app.geo import as_geojson, haversine_m, lon_lat, parse_geojson, point_ewkt
from app.models import Case, CaseAssignee, Decision, Node, RetentionPolicy, SearchRun, SystemSettings, User, WatchAlert
from app.serializers import dump

router = APIRouter(tags=["사건"])


# ---------------------------------------------------------------- 도우미
def nearest_node_id(db: Session, location: dict, case_id: int | None = None) -> int:
    """마지막 목격 위치에서 가장 가까운 노드(전역 + 그 사건 전용). 노드 수가 적어 직접 비교한다."""
    stmt = select(Node.id, as_geojson(Node.location))
    stmt = stmt.where(or_(Node.scope == "global", Node.case_id == case_id) if case_id else Node.scope == "global")
    rows = db.execute(stmt).all()
    if not rows:
        raise ApiError(409, "NO_MAP_NODES", "지도에 카메라·보조지점이 없어요. 관리자가 먼저 등록해야 해요.")
    here = lon_lat(location)
    return min(rows, key=lambda r: (haversine_m(here, lon_lat(parse_geojson(r[1]))), r[0]))[0]


def _check_last_seen(value: datetime) -> None:
    if value.tzinfo is None:
        raise ApiError(422, "INVALID_LAST_SEEN_AT", "시각에는 시간대가 있어야 해요.")
    if value > datetime.now(timezone.utc) + timedelta(minutes=1):
        raise ApiError(422, "INVALID_LAST_SEEN_AT", "마지막 목격 시각이 지금보다 늦을 수 없어요.")


def _clean_person(data: dict) -> dict:
    out = {}
    if "person_name" in data:
        name = (data["person_name"] or "").strip()
        if not 1 <= len(name) <= 50:
            raise ApiError(422, "VALIDATION_ERROR", "실종자 이름은 1~50자예요.", fields=[{"field": "person_name", "code": "length", "message": "1~50자"}])
        out["person_name"] = name
    if "person_age" in data:
        out["person_age"] = data["person_age"]
    if "last_seen_place_name" in data:
        place = data["last_seen_place_name"]
        out["last_seen_place_name"] = place.strip() if place and place.strip() else None
    for f in ("title", "description", "appearance"):
        if f in data:
            out[f] = data[f].strip() if f == "title" else (data[f] or "")
    return out


def _has_confirmed_history(db: Session, case_id: int) -> bool:
    return db.scalar(select(func.count()).select_from(Decision).where(
        Decision.case_id == case_id, Decision.verdict == "confirmed", Decision.status == "active")) > 0


def invalidate_searches(db: Session, case_id: int) -> list:
    """사건의 유효한 검색을 모두 무효화하고 그 ID 목록을 돌려준다."""
    ids = db.scalars(select(SearchRun.id).where(SearchRun.case_id == case_id, SearchRun.invalidated_at.is_(None))).all()
    if ids:
        db.execute(update(SearchRun).where(SearchRun.id.in_(ids)).values(invalidated_at=utcnow()))
    return list(ids)


def _require_owner_or_admin(db: Session, auth: AuthContext, case: Case) -> None:
    if not (auth.is_admin or case.owner_id == auth.user.id):
        raise ApiError(403, "FORBIDDEN", "주 담당자나 관리자만 담당자를 바꿀 수 있어요.")


def _case_json(db: Session, case: Case, status: int = 200) -> JSONResponse:
    return JSONResponse(dump(S.Case, case_out(db, case)), status_code=status)


# ---------------------------------------------------------------- 사건
@router.get("/api/cases", response_model=S.CasePage, summary="사건 목록")
def list_cases(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    status: str | None = Query(None, pattern="^(open|closed)$"),
    query: str | None = Query(None, max_length=100),
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    stmt = select(Case)
    if not auth.is_admin:
        stmt = stmt.join(CaseAssignee, (CaseAssignee.case_id == Case.id) & (CaseAssignee.user_id == auth.user.id))
    if status:
        stmt = stmt.where(Case.status == status)
    if query and query.strip():
        like = "%" + query.strip().replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(Case.title.ilike(like), Case.person_name.ilike(like)))
    page = keyset_page(db, stmt, [SortKey(Case.created_at), SortKey(Case.id)], limit=limit, cursor=cursor,
                       scope=scope_of("cases", u=None if auth.is_admin else auth.user.id, s=status, q=query),
                       key_of=lambda c: (c.created_at, c.id))
    settings = db.get(SystemSettings, 1)
    return dump(S.CasePage, {"items": [case_out(db, c, settings) for c in page.rows],
                             "next_cursor": page.next_cursor, "has_more": page.has_more})


@router.post("/api/cases", status_code=201, response_model=S.Case, summary="사건 등록")
def create_case(body: S.CaseCreateRequest, request: Request, auth: AuthContext = Depends(require_user),
                db: Session = Depends(get_db)):
    """등록자가 주 담당자. 유사도 기준을 생략하면 시스템 기본값을 복사한다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, "create_case", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    _check_last_seen(body.last_seen_at)
    ewkt = point_ewkt(data["last_seen_location"], "last_seen_location")
    threshold = data.get("similarity_threshold")
    if threshold is None:
        threshold = db.get(SystemSettings, 1).default_similarity_threshold
        if threshold is None:
            raise ApiError(409, "SETTINGS_NOT_CONFIGURED", "관리자가 기본 유사도 기준을 먼저 정해야 해요.")
    fields = _clean_person(data)
    case = Case(**fields, person_type=data["person_type"], last_seen_at=body.last_seen_at, last_seen_location=ewkt,
                origin_node_id=nearest_node_id(db, data["last_seen_location"]), owner_id=auth.user.id,
                similarity_threshold=threshold)
    db.add(case)
    db.flush()
    db.add(CaseAssignee(case_id=case.id, user_id=auth.user.id, is_owner=True, assigned_by=auth.user.id))
    record_audit(db, request, auth.user, "CASE_CREATE", "case", case.id, case_id=case.id)
    db.flush()
    db.refresh(case)
    response = idem.complete(201, dump(S.Case, case_out(db, case)))
    db.commit()
    return response


@router.get("/api/cases/{case_id}", response_model=S.Case, summary="사건 상세")
def get_case(case_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    return dump(S.Case, case_out(db, load_case(db, auth, case_id)))


@router.patch("/api/cases/{case_id}", response_model=S.Case, summary="사건 수정")
def patch_case(case_id: int, body: S.CasePatch, request: Request, auth: AuthContext = Depends(require_user),
               db: Session = Depends(get_db)):
    """목격 기준(시각·위치) 변경은 확정 이력이 없을 때만. 바꾸면 기존 검색을 무효화한다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    check_version(case.version, data["expected_version"])
    fields = _clean_person(data)
    if "person_type" in data:
        fields["person_type"] = data["person_type"]
    basis_changed = "last_seen_at" in data or "last_seen_location" in data
    if basis_changed:
        if _has_confirmed_history(db, case.id):
            raise ApiError(409, "CONFIRMED_HISTORY_EXISTS", "확정한 장면이 있어 목격 기준을 바꿀 수 없어요. 관련 판단을 먼저 번복해 주세요.")
        if "last_seen_at" in data:
            _check_last_seen(body.last_seen_at)
            fields["last_seen_at"] = body.last_seen_at
        if "last_seen_location" in data:
            fields["last_seen_location"] = point_ewkt(data["last_seen_location"], "last_seen_location")
            fields["origin_node_id"] = nearest_node_id(db, data["last_seen_location"], case.id)
        invalidate_searches(db, case.id)
    for k, v in fields.items():
        setattr(case, k, v)
    case.version, case.updated_at = case.version + 1, utcnow()
    record_audit(db, request, auth.user, "CASE_UPDATE", "case", case.id, case_id=case.id,
                 changed_fields=sorted(k for k in data if k != "expected_version"))
    db.commit()
    db.refresh(case)
    return _case_json(db, case)


@router.post("/api/cases/{case_id}/close", response_model=S.Case, summary="사건 종료·사유 저장")
def close_case(case_id: int, body: S.CaseCloseRequest, request: Request, auth: AuthContext = Depends(require_user),
               db: Session = Depends(get_db)):
    """감시 해제와 새 판단 차단을 함께 커밋한다. 파일은 지우지 않는다(보관 기간이 지나도 자동 삭제 없음)."""
    data = body.model_dump(mode="json", exclude_unset=True)
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    check_version(case.version, data["expected_version"])
    if data["outcome"] == "found" and not body.found_at:
        raise ApiError(422, "VALIDATION_ERROR", "발견했다면 발견 시각이 필요해요.", fields=[{"field": "found_at", "code": "required", "message": "필수"}])
    now = utcnow()
    days = db.get(RetentionPolicy, 1).closed_case_retention_days
    case.status, case.close_outcome, case.close_reason = "closed", data["outcome"], data["reason"]
    case.found_at = body.found_at if data["outcome"] == "found" else None
    case.closed_at, case.closed_by, case.watch_enabled = now, auth.user.id, False
    case.retain_until = now + timedelta(days=days) if days else None
    case.version, case.updated_at = case.version + 1, now
    record_audit(db, request, auth.user, "CASE_CLOSE", "case", case.id, case_id=case.id, changed_fields=["status"])
    db.commit()
    db.refresh(case)
    return _case_json(db, case)


# ---------------------------------------------------------------- 공동 담당
def _assignee_list(db: Session, case_id: int) -> dict:
    return dump(S.AssigneeListResponse, {"case_id": case_id, "items": assignees_out(db, case_id)})


@router.get("/api/cases/{case_id}/assignees", response_model=S.AssigneeListResponse, tags=["공동 담당"], summary="사건 담당자 목록")
def list_assignees(case_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    load_case(db, auth, case_id)
    return _assignee_list(db, case_id)


@router.post("/api/cases/{case_id}/assignees", status_code=201, response_model=S.AssigneeListResponse, tags=["공동 담당"], summary="공동 담당자 추가")
def add_assignee(case_id: int, body: S.AssigneeAddRequest, request: Request, auth: AuthContext = Depends(require_user),
                 db: Session = Depends(get_db)):
    case = load_case(db, auth, case_id, for_update=True)
    _require_owner_or_admin(db, auth, case)
    ensure_case_open(case)
    user = db.get(User, body.user_id)
    if user is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "계정을 찾을 수 없어요.")
    if not user.active:
        raise ApiError(409, "USER_INACTIVE", "비활성화된 계정이에요.")
    if db.get(CaseAssignee, (case.id, user.id)):
        raise ApiError(409, "ASSIGNEE_ALREADY_EXISTS", "이미 담당자예요.")
    db.add(CaseAssignee(case_id=case.id, user_id=user.id, is_owner=False, assigned_by=auth.user.id))
    case.version, case.updated_at = case.version + 1, utcnow()
    record_audit(db, request, auth.user, "CASE_ASSIGNEE_ADD", "user", user.id, case_id=case.id)
    db.commit()
    return JSONResponse(_assignee_list(db, case.id), status_code=201)


@router.delete("/api/cases/{case_id}/assignees/{user_id}", response_model=S.AssigneeListResponse, tags=["공동 담당"], summary="공동 담당자 제거")
def remove_assignee(case_id: int, user_id: int, request: Request, auth: AuthContext = Depends(require_user),
                    db: Session = Depends(get_db)):
    case = load_case(db, auth, case_id, for_update=True)
    _require_owner_or_admin(db, auth, case)
    ensure_case_open(case)
    row = db.get(CaseAssignee, (case.id, user_id))
    if row is None:
        return _assignee_list(db, case.id)  # 이미 없음 → 현재 목록
    if row.is_owner:
        raise ApiError(409, "OWNER_REMOVAL_FORBIDDEN", "주 담당자는 뺄 수 없어요.")
    db.delete(row)
    case.version, case.updated_at = case.version + 1, utcnow()
    record_audit(db, request, auth.user, "CASE_ASSIGNEE_REMOVE", "user", user_id, case_id=case.id)
    db.commit()
    return _assignee_list(db, case.id)


# ---------------------------------------------------------------- 검색 조건
@router.get("/api/cases/{case_id}/search-conditions", response_model=S.SearchConditions, tags=["검색 조건"], summary="사건별 검색 조건 조회")
def get_conditions(case_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    return dump(S.SearchConditions, conditions_out(load_case(db, auth, case_id), db.get(SystemSettings, 1)))


@router.patch("/api/cases/{case_id}/search-conditions", response_model=S.SearchConditions, tags=["검색 조건"], summary="사건별 유사도 기준 수정")
def patch_conditions(case_id: int, body: S.SearchConditionPatch, request: Request, auth: AuthContext = Depends(require_user),
                     db: Session = Depends(get_db)):
    """조건 버전이 올라가면 이전 검색은 낡은(stale) 검색이 된다. 감시 중이면 높음 기준보다 낮아야 한다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    check_version(case.conditions_version, data["expected_version"])
    settings = db.get(SystemSettings, 1)
    new = data["similarity_threshold"]
    if case.watch_enabled and settings.alert_high_threshold is not None and new >= settings.alert_high_threshold:
        raise ApiError(409, "THRESHOLD_INVALID", "감시 중에는 유사도 기준이 높음 기준보다 낮아야 해요.")
    if new != case.similarity_threshold:
        now = utcnow()
        case.similarity_threshold = new
        case.conditions_version, case.conditions_updated_at = case.conditions_version + 1, now
        case.version, case.updated_at = case.version + 1, now
        record_audit(db, request, auth.user, "SEARCH_CONDITIONS_UPDATE", "case", case.id, case_id=case.id,
                     changed_fields=["similarity_threshold"])
        db.commit()
        db.refresh(case)
    return dump(S.SearchConditions, conditions_out(case, settings))


# ---------------------------------------------------------------- 미처리 출현 알림 집계(R2)
@router.get("/api/alerts/pending-count", response_model=S.PendingAlertCount, tags=["실시간 감시"], summary="미처리 출현 알림 집계")
def pending_alert_count(auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    stmt = (select(WatchAlert.case_id, func.count()).join(Case, Case.id == WatchAlert.case_id)
            .where(WatchAlert.status == "pending", Case.status == "open").group_by(WatchAlert.case_id))
    if not auth.is_admin:
        stmt = stmt.join(CaseAssignee, (CaseAssignee.case_id == Case.id) & (CaseAssignee.user_id == auth.user.id))
    rows = sorted(db.execute(stmt).all(), key=lambda r: (-r[1], r[0]))
    return {"count": sum(r[1] for r in rows), "by_case": [{"case_id": cid, "count": n} for cid, n in rows]}
