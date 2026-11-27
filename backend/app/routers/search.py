"""후보 검색(SYS02-003), 판단·번복(SYS02-004·010), 동선·장면(SYS02-005)."""
from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app import tracking_common as tc
from app.auth import AuthContext, ensure_case_open, load_case, require_user, utcnow
from app.case_view import search_is_stale, search_run_out
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
from app.geo import as_geojson, haversine_m, lon_lat, parse_geojson
from app.models import (
    Case,
    Decision,
    Node,
    SearchCandidate,
    SearchRun,
    SystemSettings,
    Tracklet,
    TrackletEmbedding,
    User,
    Video,
    WatchAlert,
)
from app.routers.cases import invalidate_searches
from app.search_algo import Anchor, CandidateRow, evaluate
from app.serializers import dump
from app.tracking_common import (
    active_route_decisions,
    decision_out,
    parse_big_id,
    require_query_ready,
    scene_thumbnail_url,
)
from app.video_view import clip_window, media_out, tracklet_out, tracklet_select, trajectory_out
from app.walkgraph import dijkstra, load_graph, path_line, path_nodes, raw_distance

router = APIRouter()
SEARCH_ROW_LIMIT = 2000


# ---------------------------------------------------------------- 후보 검색
def _anchor(db: Session, case: Case, direction: str, anchor_decision_id: str | None) -> Anchor:
    if anchor_decision_id:
        did = parse_big_id(str(anchor_decision_id), "기준 판단을 찾을 수 없어요.")
        d = db.get(Decision, did)
        if d is None or d.case_id != case.id or d.status != "active" or d.verdict != "confirmed" or d.needs_reconfirmation:
            raise ApiError(409, "ANCHOR_INVALID", "기준 장면은 유효한 '예' 판단이어야 해요.")
        time = d.observed_end_at if direction == "forward" else d.observed_at
        anchor = Anchor(node_id=d.camera_id, time=time, direction=direction, tracklet_id=d.tracklet_id)
        if d.tracklet_id:
            t = db.get(Tracklet, d.tracklet_id)
            anchor.exit_node_id, anchor.entry_node_id = t.exit_node_id, t.entry_node_id
        return anchor
    if case.origin_node_id is None:
        raise ApiError(409, "ROUTE_UNAVAILABLE", "최초 목격 위치 근처에 지도 노드가 없어요.")
    seen = lon_lat(parse_geojson(db.scalar(select(as_geojson(Case.last_seen_location)).where(Case.id == case.id))))
    node = lon_lat(parse_geojson(db.scalar(select(as_geojson(Node.location)).where(Node.id == case.origin_node_id))))
    return Anchor(node_id=case.origin_node_id, time=case.last_seen_at, direction=direction, extra_m=haversine_m(seen, node))


def _candidate_rows(db: Session, case: Case, anchor: Anchor, body: dict) -> list[CandidateRow]:
    """같은 모델 벡터, 분석 완료·보관 중 영상, 전역 또는 이 사건 영상. 유사도 기준 이상만 DB에서 거른다."""
    query = case.query_embedding
    distance = TrackletEmbedding.embedding.cosine_distance(query)
    decided = exists().where(Decision.case_id == case.id, Decision.tracklet_id == Tracklet.id, Decision.status == "active",
                             Decision.verdict.in_(("confirmed", "rejected")))
    stmt = (select(Tracklet.id, Tracklet.camera_id, Tracklet.start_at, Tracklet.end_at, Tracklet.entry_node_id,
                   Tracklet.exit_node_id, (1 - distance).label("similarity"))
            .join(Video, and_(Video.id == Tracklet.video_id))
            .join(TrackletEmbedding, and_(TrackletEmbedding.tracklet_id == Tracklet.id,
                                          TrackletEmbedding.model_name == case.query_model_name))
            .where(Video.status == "done", Video.lifecycle == "active",
                   or_(Video.case_id.is_(None), Video.case_id == case.id),
                   ~decided, (1 - distance) >= case.similarity_threshold))
    if anchor.direction == "forward":
        stmt = stmt.where(Tracklet.start_at >= anchor.time)
    else:
        stmt = stmt.where(Tracklet.end_at <= anchor.time)
    if body.get("recorded_from"):
        stmt = stmt.where(Tracklet.end_at >= body["recorded_from"])
    if body.get("recorded_to"):
        stmt = stmt.where(Tracklet.start_at <= body["recorded_to"])
    if body.get("camera_ids"):
        stmt = stmt.where(Tracklet.camera_id.in_(body["camera_ids"]))
    rows = db.execute(stmt.order_by(distance, Tracklet.id).limit(SEARCH_ROW_LIMIT)).all()
    return [CandidateRow(r[0], r[1], r[2], r[3], r[4], r[5], float(r[6])) for r in rows]


@router.post("/api/cases/{case_id}/searches", status_code=201, response_model=S.SearchRun, tags=["후보 검색"], summary="후보 검색 실행")
def create_search(case_id: int, body: S.SearchRequest, request: Request, auth: AuthContext = Depends(require_user),
                  db: Session = Depends(get_db)):
    """동기 실행(201). 결과 스냅샷과 질의·조건·사건 버전을 함께 저장한다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, f"create_search:{case_id}", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    check_version(case.query_version, data["expected_query_version"], context={"case_id": case.id})
    check_version(case.conditions_version, data["expected_conditions_version"], context={"case_id": case.id})
    require_query_ready(case)
    settings = db.get(SystemSettings, 1)
    _, max_speed = tc.walking_preset(settings, case.person_type)
    if body.recorded_from and body.recorded_to and body.recorded_from >= body.recorded_to:
        raise ApiError(422, "VALIDATION_ERROR", "기간의 시작이 끝보다 앞서야 해요.", fields=[{"field": "recorded_from", "code": "range", "message": "from < to"}])
    direction = data["direction"]
    anchor = _anchor(db, case, direction, data.get("anchor_decision_id"))
    graph = load_graph(db, case.id)
    if anchor.node_id not in graph.nodes:
        raise ApiError(409, "ROUTE_UNAVAILABLE", "기준 노드가 도보 그래프에 없어요.")
    dist, prev = dijkstra(graph, anchor.node_id)
    filters = {"recorded_from": body.recorded_from, "recorded_to": body.recorded_to, "camera_ids": data.get("camera_ids")}
    rows = _candidate_rows(db, case, anchor, filters)
    paths = {c: path_nodes(prev, c) for c in {r.camera_id for r in rows}}
    scored = evaluate(rows, anchor, dist, paths, max_speed_mps=max_speed, threshold=case.similarity_threshold,
                      out_of_filter_threshold=settings.out_of_filter_threshold)[: data.get("max_candidates", 100)]

    now = utcnow()
    run = SearchRun(case_id=case.id, status="done", direction=direction,
                    anchor_decision_id=int(data["anchor_decision_id"]) if data.get("anchor_decision_id") else None,
                    recorded_from=body.recorded_from, recorded_to=body.recorded_to, camera_ids=data.get("camera_ids"),
                    max_candidates=data.get("max_candidates", 100), query_version=case.query_version,
                    conditions_version=case.conditions_version, case_version=case.version,
                    similarity_threshold=case.similarity_threshold, out_of_filter_threshold=settings.out_of_filter_threshold,
                    candidate_count=len(scored), created_by=auth.user.id, completed_at=now)
    db.add(run)
    db.flush()
    videos = {v.id: v for v in db.scalars(select(Video).join(Tracklet, Tracklet.video_id == Video.id)
                                          .where(Tracklet.id.in_([s.row.tracklet_id for s in scored]))).all()}
    video_of = dict(db.execute(select(Tracklet.id, Tracklet.video_id).where(Tracklet.id.in_([s.row.tracklet_id for s in scored]))).all())
    for rank, s in enumerate(scored, 1):
        clip_start, clip_end = clip_window(videos[video_of[s.row.tracklet_id]], s.row.start_at, s.row.end_at)
        db.add(SearchCandidate(search_id=run.id, tracklet_id=s.row.tracklet_id, rank=rank, similarity=s.row.similarity,
                               time_feasible=s.time_feasible, minimum_travel_time_s=s.minimum_travel_time_s,
                               available_time_s=s.available_time_s, route_consistent=s.route_consistent,
                               reason_codes=s.reason_codes, summary=s.summary, clip_start_s=clip_start, clip_end_s=clip_end))
    record_audit(db, request, auth.user, "SEARCH", "search", run.id, case_id=case.id)
    db.flush()
    db.refresh(run)
    response = idem.complete(201, dump(S.SearchRun, search_run_out(run, case)))
    db.commit()
    return response


def _search_of(db: Session, case: Case, search_id: str) -> SearchRun:
    try:
        sid = UUID(search_id)
    except ValueError:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "검색을 찾을 수 없어요.") from None
    run = db.get(SearchRun, sid)
    if run is None or run.case_id != case.id:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "검색을 찾을 수 없어요.")
    return run


@router.get("/api/cases/{case_id}/searches/{search_id}", response_model=S.SearchRun, tags=["후보 검색"], summary="검색 실행 상태·스냅샷 조회")
def get_search(case_id: int, search_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    case = load_case(db, auth, case_id)
    return dump(S.SearchRun, search_run_out(_search_of(db, case, search_id), case))


@router.get("/api/cases/{case_id}/candidates", response_model=S.CandidatePage, tags=["후보 검색"], summary="검색 후보 목록·판단 근거")
def list_candidates(case_id: int, search_id: str = Query(...), cursor: str | None = CursorParam, limit: int = LimitParam,
                    auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """낡은(stale) 검색도 조회는 되지만 새 판단은 막는다. 정렬은 검색 순위."""
    case = load_case(db, auth, case_id)
    run = _search_of(db, case, search_id)
    if run.status == "failed":
        raise ApiError(409, "SEARCH_FAILED", "검색이 실패했어요. 다시 검색해 주세요.")
    if run.status != "done":
        raise ApiError(409, "SEARCH_NOT_READY", "검색 중이에요.")
    stmt = select(SearchCandidate).where(SearchCandidate.search_id == run.id)
    page = keyset_page(db, stmt, [SortKey(SearchCandidate.rank, False)], limit=limit, cursor=cursor,
                       scope=scope_of("candidates", s=str(run.id)), key_of=lambda c: (c.rank,))
    ids = [c.tracklet_id for c in page.rows]
    tracks = {r[0].id: r for r in db.execute(tracklet_select().where(Tracklet.id.in_(ids))).all()} if ids else {}
    active = {d.tracklet_id: d for d in db.scalars(select(Decision).where(
        Decision.case_id == case.id, Decision.tracklet_id.in_(ids), Decision.status == "active")).all()} if ids else {}
    items = []
    for c in page.rows:
        d = active.get(c.tracklet_id)
        items.append({
            "tracklet": tracklet_out(*tracks[c.tracklet_id]), "similarity": c.similarity,
            "reason": {"similarity": c.similarity, "threshold": run.similarity_threshold, "model_name": case.query_model_name or "",
                       "time_feasible": c.time_feasible, "minimum_travel_time_s": c.minimum_travel_time_s,
                       "available_time_s": c.available_time_s, "reason_codes": list(c.reason_codes), "summary": c.summary},
            "decision": d.verdict if d else None, "decision_id": str(d.id) if d else None,
            "clip_start_s": c.clip_start_s, "clip_end_s": c.clip_end_s,
        })
    return dump(S.CandidatePage, {"search": search_run_out(run, case), "items": items,
                                  "next_cursor": page.next_cursor, "has_more": page.has_more})


# ---------------------------------------------------------------- 판단·번복
@router.post("/api/cases/{case_id}/decisions", status_code=201, response_model=S.Decision, tags=["판단"], summary="후보 예·아니오·보류 판정 저장")
def create_decision(case_id: int, body: S.DecisionCreateRequest, request: Request, auth: AuthContext = Depends(require_user),
                    db: Session = Depends(get_db)):
    """한 사건·한 트랙렛에 유효 판단은 하나. 사건을 잠근 채 검색·영상 상태를 다시 검사한다(공동 담당 동시 판단 방지)."""
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, f"create_decision:{case_id}", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    check_version(case.version, data["expected_case_version"], context={"case_id": case.id})
    run = _search_of(db, case, str(data["search_id"]))
    if run.status != "done":
        raise ApiError(409, "SEARCH_NOT_READY", "검색이 끝나지 않았어요.")
    if search_is_stale(run, case):
        raise ApiError(409, "SEARCH_STALE", "기준이 바뀐 이전 검색이에요. 다시 검색해 주세요.")
    tid = parse_big_id(str(data["tracklet_id"]), "후보를 찾을 수 없어요.")
    if db.get(SearchCandidate, (run.id, tid)) is None:
        raise ApiError(409, "CANDIDATE_NOT_IN_SEARCH", "이 검색의 후보가 아니에요.")
    tracklet = db.get(Tracklet, tid)
    video = db.get(Video, tracklet.video_id)
    if video.lifecycle != "active":
        raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
    if video.status != "done":
        raise ApiError(409, "VIDEO_NOT_READY", "영상 분석이 끝나지 않았어요.")
    existing = db.scalar(select(Decision).where(Decision.case_id == case.id, Decision.tracklet_id == tid, Decision.status == "active"))
    if existing:
        by = db.get(User, existing.decided_by)
        raise ApiError(409, "ALREADY_DECIDED", f"{by.display_name}님이 먼저 판단했어요.",
                       context={"decision_id": str(existing.id), "case_id": case.id})
    d = Decision(case_id=case.id, source_type="tracklet", tracklet_id=tid, search_id=run.id, verdict=data["verdict"],
                 note=data.get("note") or "", camera_id=tracklet.camera_id, observed_at=tracklet.start_at,
                 observed_end_at=tracklet.end_at, decided_by=auth.user.id, depends_on_decision_id=run.anchor_decision_id)
    db.add(d)
    case.version, case.updated_at = case.version + 1, utcnow()
    db.flush()
    record_audit(db, request, auth.user, "DECISION", "decision", d.id, case_id=case.id, changed_fields=[data["verdict"]])
    db.refresh(d)
    response = idem.complete(201, dump(S.Decision, decision_out(db, d)))
    db.commit()
    if d.verdict == "confirmed":
        tc.notify_watch(case.id)
    return response


@router.get("/api/cases/{case_id}/decisions", response_model=S.DecisionPage, tags=["판단"], summary="판정 기록 조회")
def list_decisions(
    case_id: int,
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    verdict: str | None = Query(None, pattern="^(confirmed|rejected|deferred)$"),
    status: str | None = Query(None, pattern="^(active|reversed)$"),
    needs_reconfirmation: bool | None = None,
    source_type: str | None = Query(None, pattern="^(tracklet|alert)$"),
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    load_case(db, auth, case_id)
    stmt = select(Decision).where(Decision.case_id == case_id)
    for col, value in ((Decision.verdict, verdict), (Decision.status, status), (Decision.source_type, source_type)):
        if value:
            stmt = stmt.where(col == value)
    if needs_reconfirmation is not None:
        stmt = stmt.where(Decision.needs_reconfirmation.is_(needs_reconfirmation))
    page = keyset_page(db, stmt, [SortKey(Decision.decided_at), SortKey(Decision.id)], limit=limit, cursor=cursor,
                       scope=scope_of("decisions", c=case_id, v=verdict, s=status, n=needs_reconfirmation, t=source_type),
                       key_of=lambda d: (d.decided_at, d.id))
    uids = {d.decided_by for d in page.rows} | {d.reversed_by for d in page.rows if d.reversed_by}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(uids))).all()} if uids else {}
    return dump(S.DecisionPage, {"items": [decision_out(db, d, users) for d in page.rows],
                                 "next_cursor": page.next_cursor, "has_more": page.has_more})


def _dependents(db: Session, case_id: int, root_id: int) -> list[Decision]:
    """root 판단을 기준으로 검색해 확정한 후속 장면들(전이적)."""
    out, frontier = [], [root_id]
    while frontier:
        children = db.scalars(select(Decision).where(
            Decision.case_id == case_id, Decision.depends_on_decision_id.in_(frontier), Decision.status == "active",
            Decision.verdict == "confirmed")).all()
        children = [c for c in children if c.id not in {o.id for o in out}]
        out.extend(children)
        frontier = [c.id for c in children]
    return out


@router.post("/api/cases/{case_id}/decisions/{decision_id}/reverse", response_model=S.DecisionReverseResponse, tags=["판단"], summary="판정 번복·영향받은 장면 목록")
def reverse_decision(case_id: int, decision_id: str, body: S.DecisionReverseRequest, request: Request,
                     auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """R3: 예·아니오 번복은 사건의 유효한 검색을 모두 무효화, 보류 번복은 무효화하지 않는다.
    '예' 번복이면 그 장면을 기준으로 확정한 후속 장면을 재확인 필요로 표시한다(동선·감시에서 제외)."""
    data = body.model_dump(mode="json", exclude_unset=True)
    if "reason" in data:
        data["reason"] = data["reason"].strip()
        if not data["reason"]:
            raise ApiError(422, "VALIDATION_ERROR", "번복 사유가 비었어요.", fields=[{"field": "reason", "code": "blank", "message": "공백만"}])
    idem = Idempotency.begin(db, request, auth.user, f"reverse_decision:{case_id}:{decision_id}", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    case = load_case(db, auth, case_id, for_update=True)
    ensure_case_open(case)
    did = parse_big_id(decision_id, "판단 기록을 찾을 수 없어요.")
    d = db.scalar(select(Decision).where(Decision.id == did, Decision.case_id == case.id).with_for_update())
    if d is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "판단 기록을 찾을 수 없어요.")
    if d.status == "reversed":
        raise ApiError(409, "DECISION_ALREADY_REVERSED", "이미 번복한 판단이에요.")
    check_version(d.version, data["expected_version"], context={"decision_id": str(d.id)})
    now = utcnow()
    d.status, d.reversed_at, d.reversed_by, d.reversal_reason = "reversed", now, auth.user.id, data.get("reason")
    d.version += 1
    affected = []
    if d.verdict == "confirmed":
        for c in _dependents(db, case.id, d.id):
            c.needs_reconfirmation, c.version = True, c.version + 1
            affected.append({"source_type": c.source_type, "tracklet_id": str(c.tracklet_id) if c.tracklet_id else None,
                             "alert_id": str(c.alert_id) if c.alert_id else None, "decision_id": str(c.id),
                             "camera_id": c.camera_id, "observed_at": c.observed_at, "thumbnail_url": scene_thumbnail_url(c),
                             "reason": "기준 장면이 번복돼 다시 확인이 필요해요.", "needs_reconfirmation": True})
    if d.source_type == "alert":
        alert = db.get(WatchAlert, d.alert_id)
        alert.status, alert.reviewed_by, alert.reviewed_at, alert.version = "pending", None, None, alert.version + 1
    invalidated = invalidate_searches(db, case.id) if d.verdict in ("confirmed", "rejected") else []
    case.version, case.updated_at = case.version + 1, now
    record_audit(db, request, auth.user, "REVERT", "decision", d.id, case_id=case.id)
    db.flush()
    out = dump(S.DecisionReverseResponse, {"decision": decision_out(db, d), "affected_scenes": affected,
                                           "invalidated_search_ids": invalidated, "case_version": case.version})
    response = idem.complete(200, out)
    db.commit()
    if d.verdict == "confirmed":
        tc.notify_watch(case.id)
    return response


# ---------------------------------------------------------------- 동선·장면
def _route_scene(db: Session, d: Decision, nodes: dict[int, tuple[str, dict]]) -> dict:
    name, location = nodes[d.camera_id]
    key = f"tracklet:{d.tracklet_id}" if d.source_type == "tracklet" else f"alert:{d.alert_id}"
    return {"scene_id": key, "decision_id": str(d.id), "source_type": d.source_type,
            "tracklet_id": str(d.tracklet_id) if d.tracklet_id else None, "alert_id": str(d.alert_id) if d.alert_id else None,
            "camera_id": d.camera_id, "camera_name": name, "location": location,
            "observed_start_at": d.observed_at, "observed_end_at": d.observed_end_at, "thumbnail_url": scene_thumbnail_url(d)}


def _camera_nodes(db: Session, ids: set[int]) -> dict[int, tuple[str, dict]]:
    if not ids:
        return {}
    return {nid: (name, parse_geojson(loc)) for nid, name, loc in
            db.execute(select(Node.id, Node.name, as_geojson(Node.location)).where(Node.id.in_(ids))).all()}


@router.get("/api/cases/{case_id}/route", response_model=S.ConfirmedRoute, tags=["동선·범위"], summary="확정 목격 동선 조회")
def get_route(case_id: int, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """알고리즘 F: 유효한 확정 장면을 관찰 시각 순으로 잇고, 사이는 도보 최단 경로(추정)로 그린다."""
    case = load_case(db, auth, case_id)
    decisions = active_route_decisions(db, case.id)
    nodes = _camera_nodes(db, {d.camera_id for d in decisions})
    scenes = [_route_scene(db, d, nodes) for d in decisions]
    speed, _ = tc.walking_preset(db.get(SystemSettings, 1), case.person_type)
    graph = load_graph(db, case.id)
    segments = []
    for a, b in zip(decisions, decisions[1:]):
        seg = {"from_decision_id": str(a.id), "to_decision_id": str(b.id), "geometry": None, "distance_m": None,
               "estimated_duration_s": None, "status": "unavailable", "reason_code": None}
        if a.camera_id == b.camera_id:
            seg.update(distance_m=0.0, estimated_duration_s=0.0, status="estimated", reason_code="SAME_CAMERA")
        elif a.camera_id in graph.nodes and b.camera_id in graph.nodes:
            _, prev = dijkstra(graph, a.camera_id)
            nodes_path = path_nodes(prev, b.camera_id)
            if nodes_path:
                coords = path_line(graph, nodes_path)
                d_m = raw_distance(graph, nodes_path)
                seg.update(geometry={"type": "LineString", "coordinates": [list(p) for p in coords]} if len(set(coords)) >= 2 else None,
                           distance_m=round(d_m, 1), estimated_duration_s=round(d_m / speed, 1), status="estimated")
            else:
                seg["reason_code"] = "ROUTE_UNKNOWN"
        else:
            seg["reason_code"] = "ROUTE_UNKNOWN"
        segments.append(seg)
    return dump(S.ConfirmedRoute, {"case_id": case.id, "case_version": case.version, "scenes": scenes,
                                   "segments": segments, "calculated_at": utcnow()})


@router.get("/api/cases/{case_id}/scenes/{scene_id}", response_model=S.CaseScene, tags=["동선·범위"], summary="장면 상세·강조/원본 대응 구간")
def get_scene(case_id: int, scene_id: str, auth: AuthContext = Depends(require_user), db: Session = Depends(get_db)):
    """scene_id = tracklet:{id} 또는 alert:{id}. 이 사건에서 판단한 장면만(유효 판단 우선)."""
    case = load_case(db, auth, case_id)
    kind, _, raw = scene_id.partition(":")
    if kind not in ("tracklet", "alert"):
        raise ApiError(404, "RESOURCE_NOT_FOUND", "장면을 찾을 수 없어요.")
    sid = parse_big_id(raw, "장면을 찾을 수 없어요.")
    col = Decision.tracklet_id if kind == "tracklet" else Decision.alert_id
    d = db.scalar(select(Decision).where(Decision.case_id == case.id, col == sid)
                  .order_by((Decision.status == "active").desc(), Decision.decided_at.desc()).limit(1))
    if d is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "장면을 찾을 수 없어요.")
    scene = _route_scene(db, d, _camera_nodes(db, {d.camera_id}))
    if kind == "tracklet":
        t = db.get(Tracklet, sid)
        video = db.get(Video, t.video_id)
        if video.lifecycle != "active":
            raise ApiError(409, "MEDIA_DELETE_PENDING", "삭제 예정인 영상이에요.")
        return dump(S.CaseScene, {"scene": scene, "media": media_out(video, t.start_at, t.end_at),
                                  "trajectory": trajectory_out(t.trajectory), "media_unavailable_reason": None})
    alert = db.get(WatchAlert, sid)
    media, reason = None, "LIVE_ALERT_SNAPSHOT_ONLY"
    if alert.source_video_id and alert.source_offset_s is not None:
        video = db.get(Video, alert.source_video_id)
        if video and video.playback_path and video.lifecycle == "active":
            at = video.recorded_start_at + timedelta(seconds=alert.source_offset_s)
            media, reason = media_out(video, at, at + timedelta(seconds=2)), None
    return dump(S.CaseScene, {"scene": scene, "media": media, "trajectory": [], "media_unavailable_reason": reason})
