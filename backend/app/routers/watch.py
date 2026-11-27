"""실시간 감시(SYS02-007), 출현 알림(SYS02-008). 감시 상태는 감시 워커가 Redis에 남기는 심박으로 판단한다."""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app import tracking_common as tc
from app.auth import AuthContext, ensure_case_open, load_case, require_user, utcnow
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
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.media import file_response
from app.models import Camera, Case, Decision, Node, SystemSettings, User, WatchAlert
from app.serializers import dump, user_summary_out
from app.tracking_common import decision_out, parse_big_id, require_query_ready

router = APIRouter(tags=["실시간 감시"])
STARTING_GRACE = timedelta(seconds=30)
HEARTBEAT_KEY = "watch:camera:{}"


# ---------------------------------------------------------------- 감시 상태
def stream_cameras(db: Session) -> list[int]:
    """감시 범위: 전역 카메라 중 스트림 주소가 있는 것(사건 전용 업로드 카메라 제외)."""
    return list(db.scalars(select(Camera.node_id).join(Node, Node.id == Camera.node_id)
                           .where(Node.scope == "global", Camera.stream_url.is_not(None)).order_by(Camera.node_id)).all())


def read_heartbeats(camera_ids: list[int]) -> dict[int, dict] | None:
    """감시 워커 심박. Redis를 못 읽으면 None(상태 unknown)."""
    if not camera_ids:
        return {}
    try:
        import redis

        r = redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)
        values = r.mget([HEARTBEAT_KEY.format(c) for c in camera_ids])
    except Exception:
        return None
    return {c: json.loads(v) for c, v in zip(camera_ids, values) if v}


def watch_state(db: Session, case: Case) -> dict:
    now = utcnow()
    cams = stream_cameras(db)
    beats = read_heartbeats(cams) if case.watch_enabled else {}
    cameras = []
    for c in cams:
        b = (beats or {}).get(c)
        if not case.watch_enabled:
            status = "stopped"
        elif b:
            status = b.get("status", "unknown")
        else:
            status = "starting" if now - case.updated_at < STARTING_GRACE else "unknown"
        cameras.append({"camera_id": c, "stream_session_id": (b or {}).get("stream_session_id"), "seq": int((b or {}).get("seq", 0)),
                        "status": status, "heartbeat_at": (b or {}).get("heartbeat_at"), "last_frame_at": (b or {}).get("last_frame_at"),
                        "reason_code": (b or {}).get("reason_code"), "blocked_reason": None})
    statuses = {c["status"] for c in cameras}
    if not case.watch_enabled:
        overall = "stopped"
    elif not cams:
        overall = "blocked"
    elif beats is None:
        overall = "unknown"
    elif statuses == {"watching"}:
        overall = "watching"
    elif "watching" in statuses:
        overall = "degraded"
    elif statuses <= {"starting"}:
        overall = "starting"
    else:
        overall = "unknown"
    return {"case_id": case.id, "enabled": case.watch_enabled, "status": overall, "cameras": cameras, "updated_at": case.updated_at}


@router.get("/api/cases/{case_id}/watch", response_model=S.WatchState, summary="실시간 감시 상태")
def get_watch(case_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    return dump(S.WatchState, watch_state(db, load_case(db, auth, case_id)))


@router.put("/api/cases/{case_id}/watch", response_model=S.WatchState, summary="실시간 감시 시작·중지")
def put_watch(case_id: int, body: S.WatchPut, request: Request, auth: AuthContext = Depends(require_user),
              db: Session = Depends(get_db)):
    """true는 접수일 뿐 실제 입력 정상을 보장하지 않는다. 같은 값이면 버전이 맞을 때 현재 상태를 돌려준다."""
    data = body.model_dump(mode="json")
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    check_version(case.version, data["expected_case_version"], context={"case_id": case.id})
    if data["enabled"] == case.watch_enabled:
        return dump(S.WatchState, watch_state(db, case))
    if data["enabled"]:
        require_query_ready(case)
        settings = db.get(SystemSettings, 1)
        if settings.alert_high_threshold is None:
            raise ApiError(409, "SETTINGS_NOT_CONFIGURED", "관리자가 출현 알림 높음 기준을 먼저 정해야 해요.")
        if case.similarity_threshold >= settings.alert_high_threshold:
            raise ApiError(409, "THRESHOLD_INVALID", "유사도 기준이 높음 기준보다 낮아야 감시를 켤 수 있어요.")
        if not stream_cameras(db):
            raise ApiError(409, "NO_STREAM_CAMERA", "실시간 영상이 연결된 카메라가 없어요.")
    case.watch_enabled = data["enabled"]
    case.version, case.updated_at = case.version + 1, utcnow()
    record_audit(db, request, auth.user, "WATCH_START" if data["enabled"] else "WATCH_STOP", "case", case.id, case_id=case.id)
    db.commit()
    db.refresh(case)
    tc.notify_watch(case.id)
    return dump(S.WatchState, watch_state(db, case))


# ---------------------------------------------------------------- 출현 알림
def alert_out(db: Session, a: WatchAlert, camera_name: str | None = None) -> dict:
    d = db.scalar(select(Decision).where(Decision.alert_id == a.id, Decision.case_id == a.case_id, Decision.status == "active"))
    by = db.get(User, d.decided_by) if d else None
    reason = a.reason or {}
    return {
        "alert_id": str(a.id), "case_id": a.case_id, "camera_id": a.camera_id,
        "camera_name": camera_name or db.scalar(select(Node.name).where(Node.id == a.camera_id)),
        "detected_at": a.detected_at, "similarity": a.score, "level": a.level, "status": a.status,
        "snapshot_url": f"/api/cases/{a.case_id}/alerts/{a.id}/snapshot",
        "reason": {"similarity": a.score, "threshold": reason.get("threshold", 0.0), "model_name": reason.get("model_name", ""),
                   "time_feasible": reason.get("time_feasible"), "minimum_travel_time_s": reason.get("minimum_travel_time_s"),
                   "available_time_s": reason.get("available_time_s"),
                   "reason_codes": reason.get("reason_codes", ["APPEARANCE_MATCH"]), "summary": reason.get("summary", "")},
        "decision_id": str(d.id) if d else None, "decided_by": user_summary_out(by) if by else None,
        "decided_at": d.decided_at if d else None, "version": a.version,
    }


def _alert_of(db: Session, case: Case, alert_id: str, *, for_update: bool = False) -> WatchAlert:
    aid = parse_big_id(alert_id, "알림을 찾을 수 없어요.")
    stmt = select(WatchAlert).where(WatchAlert.id == aid, WatchAlert.case_id == case.id)
    a = db.scalar(stmt.with_for_update() if for_update else stmt)
    if a is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "알림을 찾을 수 없어요.")
    return a


@router.get("/api/cases/{case_id}/alerts", response_model=S.AlertPage, summary="출현 알림 목록")
def list_alerts(
    case_id: int,
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    status: str | None = Query(None, pattern="^(pending|confirmed|rejected)$"),
    level: str | None = Query(None, pattern="^(high|mid)$"),
    camera_id: int | None = Query(None, ge=1),
    detected_from: datetime | None = None,
    detected_to: datetime | None = None,
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    load_case(db, auth, case_id)
    stmt = select(WatchAlert).where(WatchAlert.case_id == case_id)
    for col, value in ((WatchAlert.status, status), (WatchAlert.level, level), (WatchAlert.camera_id, camera_id)):
        if value:
            stmt = stmt.where(col == value)
    if detected_from:
        stmt = stmt.where(WatchAlert.detected_at >= detected_from)
    if detected_to:
        stmt = stmt.where(WatchAlert.detected_at <= detected_to)
    page = keyset_page(db, stmt, [SortKey(WatchAlert.detected_at), SortKey(WatchAlert.id)], limit=limit, cursor=cursor,
                       scope=scope_of("alerts", c=case_id, s=status, l=level, cam=camera_id, f=detected_from, t=detected_to),
                       key_of=lambda a: (a.detected_at, a.id))
    names = dict(db.execute(select(Node.id, Node.name).where(Node.id.in_({a.camera_id for a in page.rows}))).all()) if page.rows else {}
    return dump(S.AlertPage, {"items": [alert_out(db, a, names.get(a.camera_id)) for a in page.rows],
                              "next_cursor": page.next_cursor, "has_more": page.has_more})


@router.get("/api/cases/{case_id}/alerts/{alert_id}", response_model=S.Alert, summary="출현 알림 상세·현재 판정")
def get_alert(case_id: int, alert_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    case = load_case(db, auth, case_id)
    return dump(S.Alert, alert_out(db, _alert_of(db, case, alert_id)))


@router.get("/api/cases/{case_id}/alerts/{alert_id}/snapshot", tags=["파일 제공"], summary="출현 알림 스냅샷")
def get_alert_snapshot(case_id: int, alert_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    case = load_case(db, auth, case_id)
    return file_response(_alert_of(db, case, alert_id).snapshot_path, "image/jpeg")


@router.post("/api/cases/{case_id}/alerts/{alert_id}/decision", response_model=S.AlertDecisionResponse, summary="출현 알림 예·아니오 응답")
def decide_alert(case_id: int, alert_id: str, body: S.AlertDecisionRequest, request: Request,
                 auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """예=confirmed(동선에 추가), 아니오=rejected. 알림과 판단을 같은 트랜잭션에 저장한다(사건 → 알림 순서로 잠금)."""
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, f"decide_alert:{case_id}:{alert_id}", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    alert = _alert_of(db, case, alert_id, for_update=True)
    if alert.status != "pending":
        raise ApiError(409, "ALERT_ALREADY_DECIDED", "이미 응답한 알림이에요.", context={"current_status": alert.status})
    check_version(alert.version, data["expected_version"])
    now = utcnow()
    route = tc.active_route_decisions(db, case.id)
    d = Decision(case_id=case.id, source_type="alert", alert_id=alert.id, verdict=data["decision"], note=data.get("note") or "",
                 camera_id=alert.camera_id, observed_at=alert.detected_at, observed_end_at=alert.detected_at,
                 decided_by=auth.user.id, depends_on_decision_id=route[-1].id if route else None)
    db.add(d)
    alert.status, alert.reviewed_by, alert.reviewed_at, alert.version = data["decision"], auth.user.id, now, alert.version + 1
    case.version, case.updated_at = case.version + 1, now
    db.flush()
    record_audit(db, request, auth.user, "ALERT_DECISION", "alert", alert.id, case_id=case.id, changed_fields=[data["decision"]])
    db.refresh(d)
    out = dump(S.AlertDecisionResponse, {"alert": alert_out(db, alert), "decision": decision_out(db, d), "case_version": case.version})
    response = idem.complete(200, out)
    db.commit()
    if d.verdict == "confirmed":
        tc.notify_watch(case.id)
    return response
