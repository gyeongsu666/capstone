"""사건 응답(Case) 조립: 담당자, 기준 대상, 검색 조건, 확정·대기 수(R1), 최근 검색(R6)."""
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.geo import as_geojson, parse_geojson
from app.models import Case, CaseAssignee, Decision, SearchCandidate, SearchRun, SystemSettings, User
from app.serializers import user_summary_out


def search_is_stale(run: SearchRun, case: Case) -> bool:
    """질의·조건이 바뀌었거나 번복 등으로 명시적으로 무효화된 검색은 판단할 수 없다."""
    return (
        run.invalidated_at is not None
        or run.query_version != case.query_version
        or run.conditions_version != case.conditions_version
    )


def search_run_out(run: SearchRun, case: Case) -> dict[str, Any]:
    return {
        "search_id": run.id, "case_id": run.case_id, "task_id": run.task_id, "status": run.status,
        "query_version": run.query_version, "conditions_version": run.conditions_version, "case_version": run.case_version,
        "candidate_count": run.candidate_count, "stale": search_is_stale(run, case),
        "created_at": run.created_at, "completed_at": run.completed_at,
    }


def latest_search(db: Session, case_id: int) -> SearchRun | None:
    return db.scalar(select(SearchRun).where(SearchRun.case_id == case_id)
                     .order_by(SearchRun.created_at.desc(), SearchRun.id.desc()).limit(1))


def assignees_out(db: Session, case_id: int) -> list[dict[str, Any]]:
    rows = db.execute(select(CaseAssignee, User).join(User, User.id == CaseAssignee.user_id)
                      .where(CaseAssignee.case_id == case_id)
                      .order_by(CaseAssignee.is_owner.desc(), CaseAssignee.assigned_at, User.id)).all()
    return [{"user": user_summary_out(u), "is_owner": a.is_owner, "assigned_at": a.assigned_at, "assigned_by": a.assigned_by}
            for a, u in rows]


def query_out(case: Case) -> dict[str, Any]:
    return {
        "status": case.query_status,
        "source_type": case.query_source,
        "query_version": case.query_version,
        "tracklet_id": str(case.query_tracklet_id) if case.query_tracklet_id else None,
        "photo_url": f"/api/cases/{case.id}/query/photo" if case.query_photo_path else None,
        "model_name": case.query_model_name,
        "embedding_dimension": 256 if case.query_embedding is not None and case.query_model_name else None,
        "task_id": case.query_task_id,
        "error_code": case.query_error_code,
        "updated_at": case.query_updated_at,
    }


def conditions_out(case: Case, settings: SystemSettings) -> dict[str, Any]:
    return {
        "case_id": case.id,
        "similarity_threshold": case.similarity_threshold,
        "alert_high_threshold": settings.alert_high_threshold,
        "version": case.conditions_version,
        "updated_at": case.conditions_updated_at,
    }


def summary_out(db: Session, case: Case, run: SearchRun | None) -> dict[str, Any]:
    confirmed = db.scalar(select(func.count()).select_from(Decision).where(
        Decision.case_id == case.id, Decision.verdict == "confirmed", Decision.status == "active",
        Decision.needs_reconfirmation.is_(False))) or 0
    pending = None
    if run is not None and run.status == "done" and not search_is_stale(run, case):
        decided = exists().where(Decision.case_id == case.id, Decision.tracklet_id == SearchCandidate.tracklet_id,
                                 Decision.status == "active")
        pending = db.scalar(select(func.count()).select_from(SearchCandidate)
                            .where(SearchCandidate.search_id == run.id, ~decided)) or 0
    return {"confirmed_count": confirmed, "pending_count": pending}


def case_out(db: Session, case: Case, settings: SystemSettings | None = None) -> dict[str, Any]:
    settings = settings or db.get(SystemSettings, 1)
    location = parse_geojson(db.scalar(select(as_geojson(Case.last_seen_location)).where(Case.id == case.id)))
    run = latest_search(db, case.id)
    return {
        "case_id": case.id,
        "title": case.title,
        "person_type": case.person_type,
        "person_name": case.person_name,
        "person_age": case.person_age,
        "description": case.description,
        "appearance": case.appearance,
        "status": case.status,
        "close_outcome": case.close_outcome,
        "close_reason": case.close_reason,
        "closed_at": case.closed_at,
        "found_at": case.found_at,
        "last_seen_at": case.last_seen_at,
        "last_seen_location": location,
        "last_seen_place_name": case.last_seen_place_name,
        # 생성 때 반드시 채우고, 사건이 참조하는 노드는 삭제를 막으므로 비지 않는다
        "origin_node_id": case.origin_node_id,
        "owner_id": case.owner_id,
        "assignees": assignees_out(db, case.id),
        "query": query_out(case),
        "search_conditions": conditions_out(case, settings),
        "watch_enabled": case.watch_enabled,
        "version": case.version,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "summary": summary_out(db, case, run),
        "latest_search": search_run_out(run, case) if run else None,
    }
