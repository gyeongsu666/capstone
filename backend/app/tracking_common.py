"""검색·판단·동선·범위·감시가 함께 쓰는 도우미."""
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiError
from app.models import Case, Decision, SystemSettings, User
from app.serializers import user_summary_out


def walking_preset(settings: SystemSettings, person_type: str) -> tuple[float, float]:
    """(평소 속도, 최대 속도) m/s. 없으면 409 SETTINGS_NOT_CONFIGURED."""
    for p in settings.walking_speed_presets or []:
        if p.get("person_type") == person_type:
            return float(p["speed_mps"]), float(p["max_speed_mps"])
    raise ApiError(409, "SETTINGS_NOT_CONFIGURED", "관리자가 보행 속도를 먼저 정해야 해요.")


def require_query_ready(case: Case) -> None:
    if case.query_status != "ready" or case.query_embedding is None:
        raise ApiError(409, "NO_QUERY_VECTOR", "기준 대상(사진·장면)의 특징이 아직 준비되지 않았어요.")
    if case.query_model_name != get_settings().reid_model_name:
        raise ApiError(409, "MODEL_MISMATCH", "기준 대상의 특징 모델이 검색 모델과 달라요.")


def decision_out(db: Session, d: Decision, users: dict[int, User] | None = None) -> dict[str, Any]:
    def summary(uid: int | None):
        if uid is None:
            return None
        u = (users or {}).get(uid) or db.get(User, uid)
        return user_summary_out(u)

    return {
        "decision_id": str(d.id), "case_id": d.case_id, "source_type": d.source_type,
        "tracklet_id": str(d.tracklet_id) if d.tracklet_id else None,
        "alert_id": str(d.alert_id) if d.alert_id else None,
        "search_id": d.search_id, "verdict": d.verdict, "status": d.status, "note": d.note,
        "observed_at": d.observed_at, "decided_at": d.decided_at, "decided_by": summary(d.decided_by),
        "reversed_at": d.reversed_at, "reversed_by": summary(d.reversed_by), "reversal_reason": d.reversal_reason,
        "needs_reconfirmation": d.needs_reconfirmation,
        "depends_on_decision_id": str(d.depends_on_decision_id) if d.depends_on_decision_id else None,
        "version": d.version,
    }


def active_route_decisions(db: Session, case_id: int) -> list[Decision]:
    """동선·범위·감시 기준: 유효한 확정 판단 중 재확인 필요가 아닌 것, 관찰 시각 순."""
    return list(db.scalars(select(Decision).where(
        Decision.case_id == case_id, Decision.status == "active", Decision.verdict == "confirmed",
        Decision.needs_reconfirmation.is_(False),
    ).order_by(Decision.observed_at, Decision.id)).all())


def scene_thumbnail_url(d: Decision) -> str:
    if d.source_type == "tracklet":
        return f"/api/tracklets/{d.tracklet_id}/thumbnail"
    return f"/api/cases/{d.case_id}/alerts/{d.alert_id}/snapshot"


def parse_big_id(value: str, message: str = "대상을 찾을 수 없어요.") -> int:
    if not value.isdigit() or len(value) > 19 or int(value) > 9223372036854775807 or int(value) < 1:
        raise ApiError(404, "RESOURCE_NOT_FOUND", message)
    return int(value)


def notify_watch(case_id: int) -> None:
    """감시 워커에 기준이 바뀌었다고 알린다(워커는 DB를 다시 읽는다). 실패해도 요청은 성공."""
    try:
        import redis

        redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1) \
            .publish("watch.config_changed", str(case_id))
    except Exception:
        pass

