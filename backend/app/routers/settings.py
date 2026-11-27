"""관리자·설정(SYS01-006), 데이터 보관(SYS01-009). 자동 삭제는 하지 않는다."""
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, require_admin, require_user, utcnow
from app.common import CursorParam, LimitParam, check_version, decode_cursor, encode_cursor, record_audit, scope_of
from app.db import get_db
from app.errors import ApiError
from app.models import AuditLog, Case, RetentionPolicy, SystemSettings, Task, Video, WatchAlert
from app.serializers import dump

router = APIRouter()
PERSON_TYPES = ("adult", "child", "elderly", "other")


def settings_out(s: SystemSettings) -> dict[str, Any]:
    return {
        "walking_speed_presets": s.walking_speed_presets,
        "default_similarity_threshold": s.default_similarity_threshold,
        "alert_high_threshold": s.alert_high_threshold,
        "out_of_filter_threshold": s.out_of_filter_threshold,
        "area_level_ratios": s.area_level_ratios,
        "area_buffer_m": s.area_buffer_m,
        "max_upload_bytes": s.max_upload_bytes,
        "version": s.version,
        "updated_at": s.updated_at,
    }


def retention_out(r: RetentionPolicy) -> dict[str, Any]:
    return {
        "video_retention_days": r.video_retention_days,
        "closed_case_retention_days": r.closed_case_retention_days,
        "alert_retention_days": r.alert_retention_days,
        "audit_retention_days": r.audit_retention_days,
        "deletion_mode": "manual_approval_required",
        "automatic_deletion_enabled": False,
        "version": r.version,
        "updated_at": r.updated_at,
    }


def _invalid(field: str, message: str) -> ApiError:
    return ApiError(422, "INVALID_SETTINGS", message, fields=[{"field": field, "code": "invalid", "message": message}])


@router.get("/api/settings", response_model=S.SystemSettings, tags=["관리자·설정"], summary="시스템 설정 조회")
def get_settings_api(_: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    return dump(S.SystemSettings, settings_out(db.get(SystemSettings, 1)))


@router.patch("/api/settings", response_model=S.SystemSettings, tags=["관리자·설정"], summary="시스템 설정 수정")
def patch_settings(body: S.SystemSettingsPatch, request: Request, auth: AuthContext = Depends(require_admin),
                   db: Session = Depends(get_db)):
    """기본 유사도는 새 사건에만, 속도·범위 비율은 다음 계산부터. 기존 사건의 유사도 기준은 바꾸지 않는다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    s = db.scalar(select(SystemSettings).where(SystemSettings.id == 1).with_for_update())
    check_version(s.version, data["expected_version"])

    if "walking_speed_presets" in data:
        presets = data["walking_speed_presets"]
        types = [p["person_type"] for p in presets]
        if sorted(types) != sorted(PERSON_TYPES):
            raise _invalid("walking_speed_presets", "성인·어린이·노인·기타 4개 유형을 한 번씩 정해 주세요.")
        for p in presets:
            if not (0 < p["speed_mps"] <= p["max_speed_mps"]):
                raise _invalid("walking_speed_presets", "평소 속도는 0보다 크고 최대 속도 이하여야 해요.")
        s.walking_speed_presets = sorted(presets, key=lambda p: PERSON_TYPES.index(p["person_type"]))
    if "area_level_ratios" in data:
        r = data["area_level_ratios"]
        if not (0 < r[0] < r[1] < r[2] == 1):
            raise _invalid("area_level_ratios", "범위 비율은 0 < r1 < r2 < r3 = 1 이어야 해요.")
        s.area_level_ratios = r
    for f in ("default_similarity_threshold", "alert_high_threshold", "area_buffer_m", "max_upload_bytes", "out_of_filter_threshold"):
        if f in data:
            setattr(s, f, data[f])

    if s.default_similarity_threshold is not None and s.alert_high_threshold is not None \
            and not s.default_similarity_threshold < s.alert_high_threshold:
        raise _invalid("alert_high_threshold", "기본 유사도 기준은 높음 기준보다 낮아야 해요.")
    if "alert_high_threshold" in data and s.alert_high_threshold is not None:
        # 감시 중인 사건의 기준(mid)이 새 high 이상이면 막는다
        blocking = db.scalars(select(Case.id).where(
            Case.status == "open", Case.watch_enabled, Case.similarity_threshold >= s.alert_high_threshold)).all()
        if blocking:
            raise ApiError(409, "THRESHOLD_CONFLICT_WITH_ACTIVE_CASES", "감시 중인 사건의 유사도 기준보다 높음 기준이 낮아져요.",
                           context={"blocking_case_ids": list(blocking)})
    s.version, s.updated_at, s.updated_by = s.version + 1, utcnow(), auth.user.id
    record_audit(db, request, auth.user, "SETTINGS_CHANGE", "system_settings", 1,
                 changed_fields=sorted(k for k in data if k != "expected_version"))
    db.commit()
    db.refresh(s)
    return dump(S.SystemSettings, settings_out(s))


@router.get("/api/retention-policy", response_model=S.RetentionPolicy, tags=["관리자·데이터 보관"], summary="보관 기간 조회")
def get_retention(_: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    return dump(S.RetentionPolicy, retention_out(db.get(RetentionPolicy, 1)))


@router.patch("/api/retention-policy", response_model=S.RetentionPolicy, tags=["관리자·데이터 보관"], summary="보관 기간 수정")
def patch_retention(body: S.RetentionPatch, request: Request, auth: AuthContext = Depends(require_admin),
                    db: Session = Depends(get_db)):
    """apply_to_existing=true면 보호 조건을 지킨 채 기존 자료의 만료일을 다시 계산한다. 삭제는 하지 않는다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    r = db.scalar(select(RetentionPolicy).where(RetentionPolicy.id == 1).with_for_update())
    check_version(r.version, data["expected_version"])
    for f in ("video_retention_days", "closed_case_retention_days", "alert_retention_days", "audit_retention_days"):
        if f in data:
            if data[f] is not None and data[f] < 1:
                raise ApiError(422, "VALIDATION_ERROR", "보관 기간은 1일 이상이에요.", fields=[{"field": f, "code": "range", "message": "≥ 1"}])
            setattr(r, f, data[f])
    if data.get("apply_to_existing"):
        if r.video_retention_days is None:
            db.execute(update(Video).where(Video.case_id.is_(None)).values(retain_until=None))
        else:
            db.execute(update(Video).where(Video.case_id.is_(None))
                       .values(retain_until=Video.created_at + timedelta(days=r.video_retention_days)))
        if r.closed_case_retention_days is None:
            db.execute(update(Case).values(retain_until=None))
        else:
            db.execute(update(Case).where(Case.status == "closed")
                       .values(retain_until=Case.closed_at + timedelta(days=r.closed_case_retention_days)))
    r.version, r.updated_at, r.updated_by = r.version + 1, utcnow(), auth.user.id
    record_audit(db, request, auth.user, "RETENTION_CHANGE", "retention_policy", 1,
                 changed_fields=sorted(k for k in data if k != "expected_version"))
    db.commit()
    db.refresh(r)
    return dump(S.RetentionPolicy, retention_out(r))


def _deletion_candidates(db: Session, r: RetentionPolicy, now: datetime) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    open_case_ids = set(db.scalars(select(Case.id).where(Case.status == "open")).all())
    busy_videos = set(db.scalars(select(Task.video_id).where(Task.video_id.is_not(None), Task.status.in_(("queued", "running")))).all())
    if r.video_retention_days:
        for v in db.scalars(select(Video).where(Video.case_id.is_(None))).all():
            until = v.retain_until or v.created_at + timedelta(days=r.video_retention_days)
            reasons = (["hold"] if v.hold else []) + (["active_task"] if v.id in busy_videos else [])
            out.append(dict(resource_type="video", resource_id=str(v.id), retain_until=until, blocked_reasons=reasons,
                            referenced_case_ids=[], estimated_bytes=v.size_bytes or 0))
    if r.closed_case_retention_days:
        for c in db.scalars(select(Case).where(Case.status == "closed")).all():
            until = c.retain_until or c.closed_at + timedelta(days=r.closed_case_retention_days)
            out.append(dict(resource_type="closed_case", resource_id=str(c.id), retain_until=until, blocked_reasons=[],
                            referenced_case_ids=[c.id], estimated_bytes=0))
    if r.alert_retention_days:
        rows = db.execute(select(WatchAlert.id, WatchAlert.case_id, WatchAlert.created_at)).all()
        for aid, cid, created in rows:
            reasons = ["referenced_by_open_case"] if cid in open_case_ids else []
            out.append(dict(resource_type="alert", resource_id=str(aid), retain_until=created + timedelta(days=r.alert_retention_days),
                            blocked_reasons=reasons, referenced_case_ids=[cid], estimated_bytes=0))
    if r.audit_retention_days:
        oldest = db.execute(select(func.min(AuditLog.occurred_at), func.count())).one()
        if oldest[1]:
            # 이용 기록은 한 건씩이 아니라 '기간 지난 기록 묶음' 하나로 보여 준다
            out.append(dict(resource_type="audit_log", resource_id="before:" + (now - timedelta(days=r.audit_retention_days)).date().isoformat(),
                            retain_until=oldest[0] + timedelta(days=r.audit_retention_days), blocked_reasons=[],
                            referenced_case_ids=[], estimated_bytes=0))
    for item in out:
        item["eligible"] = item["retain_until"] <= now and not item["blocked_reasons"]
        item["approval_required"] = True
    out.sort(key=lambda i: (i["retain_until"], i["resource_type"], i["resource_id"]))
    return out


@router.get("/api/deletion-candidates", response_model=S.DeletionCandidatePage, tags=["관리자·데이터 보관"], summary="삭제 예정 목록")
def list_deletion_candidates(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    resource_type: str | None = Query(None, pattern="^(video|closed_case|alert|audit_log)$"),
    eligible: bool | None = None,
    expires_before: datetime | None = None,
    _: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """이름은 '삭제 예정'이지만 예약·실행하지 않는다. 승인 필요·차단 사유·영향 사건·예상 용량만 보여 준다."""
    if expires_before is not None and expires_before.tzinfo is None:
        raise ApiError(422, "VALIDATION_ERROR", "시각에는 시간대가 있어야 해요.", fields=[{"field": "expires_before", "code": "timezone", "message": "시간대 필요"}])
    now = datetime.now(timezone.utc)
    items = _deletion_candidates(db, db.get(RetentionPolicy, 1), now)
    if resource_type:
        items = [i for i in items if i["resource_type"] == resource_type]
    if eligible is not None:
        items = [i for i in items if i["eligible"] is eligible]
    if expires_before:
        items = [i for i in items if i["retain_until"] < expires_before]
    scope = scope_of("deletion", t=resource_type, e=eligible, b=expires_before)
    start = int(decode_cursor(cursor, scope)[0]) if cursor else 0
    page = items[start:start + limit]
    nxt = encode_cursor([start + limit], scope) if start + limit < len(items) else None
    return dump(S.DeletionCandidatePage, {"items": page, "next_cursor": nxt, "has_more": nxt is not None})
