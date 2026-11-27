"""현재 위치 범위(SYS02-006): GET할 때마다 지금(as_of) 기준으로 다시 계산한다(recalculate API 없음)."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app import tracking_common as tc
from app.area_algo import Hazard, compute_area, penalized_distances
from app.auth import AuthContext, load_case, require_user, utcnow
from app.db import get_db
from app.errors import ApiError
from app.geo import as_geojson, haversine_m, lon_lat, parse_geojson
from app.models import Case, Decision, HazardZone, Node, SystemSettings, Tracklet, TrackletEmbedding, Video
from app.serializers import dump
from app.walkgraph import dijkstra, load_graph

router = APIRouter(tags=["동선·범위"])
LONG_ELAPSED_S = 6 * 3600


def _parse_as_of(as_of: str | None) -> datetime:
    if as_of is None:
        return utcnow()
    try:
        value = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, "INVALID_AS_OF", "기준 시각 형식이 올바르지 않아요(RFC3339).") from None
    if value.tzinfo is None:
        raise ApiError(422, "INVALID_AS_OF", "기준 시각에는 시간대가 있어야 해요.")
    return value


def silent_cameras(db: Session, case: Case, graph, dist: dict[int, float], basis_time: datetime, as_of: datetime,
                   max_speed: float, basis_node: int) -> set[int]:
    """기준 이후 지나갔다면 찍혔어야 할 카메라(그 시간대 분석된 영상이 있는데 확정 장면이 없음)."""
    out = set()
    for cam_id in [n for n, k in graph.kinds.items() if k == "camera" and n != basis_node and n in dist]:
        arrive = basis_time + timedelta(seconds=dist[cam_id] / max_speed)
        if arrive >= as_of:
            continue
        covered = db.scalar(select(func.count()).select_from(Video).where(
            Video.camera_id == cam_id, Video.status == "done", Video.lifecycle == "active",
            Video.recorded_start_at <= as_of,
            Video.recorded_start_at + func.make_interval(0, 0, 0, 0, 0, 0, Video.duration_s) >= arrive,
            (Video.case_id.is_(None)) | (Video.case_id == case.id)))
        if not covered:
            continue
        # 확정만 보면 '아직 확인 안 한 비슷한 사람'이 있는 카메라까지 부재로 친다 →
        # 도착 가능 시각 이후 기준 유사도 이상인 트랙렛이 하나도 없을 때만 부재로 본다('아니오'로 뺀 것은 제외)
        rejected = exists().where(Decision.case_id == case.id, Decision.tracklet_id == Tracklet.id,
                                  Decision.status == "active", Decision.verdict == "rejected")
        similar = db.scalar(select(exists().where(and_(
            Tracklet.camera_id == cam_id, Tracklet.start_at >= arrive, Tracklet.start_at <= as_of, ~rejected,
            exists().where(TrackletEmbedding.tracklet_id == Tracklet.id, TrackletEmbedding.model_name == case.query_model_name,
                           (1 - TrackletEmbedding.embedding.cosine_distance(case.query_embedding)) >= case.similarity_threshold),
        )))) if case.query_embedding is not None else True
        if not similar:
            out.add(cam_id)
    return out


@router.get("/api/cases/{case_id}/search-area", response_model=S.SearchArea, summary="현재 위치 3단계 범위·위험 중첩·우선 구역")
def get_search_area(case_id: int, as_of: str | None = Query(None), auth: AuthContext = Depends(require_user),
                    db: Session = Depends(get_db)):
    case = load_case(db, auth, case_id)
    now = _parse_as_of(as_of)
    settings = db.get(SystemSettings, 1)
    speed, max_speed = tc.walking_preset(settings, case.person_type)
    ratios = settings.area_level_ratios or []
    if settings.area_buffer_m is None or len(ratios) != 3:
        raise ApiError(409, "SETTINGS_NOT_CONFIGURED", "관리자가 범위 설정(버퍼·단계 비율)을 먼저 정해야 해요.")

    # 기준점: 마지막 유효 확정 장면, 없으면 사건의 최초 목격
    route = tc.active_route_decisions(db, case.id)
    basis = route[-1] if route else None
    extra_m, exit_node = 0.0, None
    if basis:
        node_id, basis_time = basis.camera_id, basis.observed_end_at
        location = parse_geojson(db.scalar(select(as_geojson(Node.location)).where(Node.id == node_id)))
        if basis.tracklet_id:
            exit_node = db.scalar(select(Tracklet.exit_node_id).where(Tracklet.id == basis.tracklet_id))
    else:
        if case.origin_node_id is None:
            raise ApiError(409, "ORIGIN_MISSING", "기준 위치가 없어 범위를 계산할 수 없어요.")
        node_id, basis_time = case.origin_node_id, case.last_seen_at
        location = parse_geojson(db.scalar(select(as_geojson(Case.last_seen_location)).where(Case.id == case.id)))
        node_point = lon_lat(parse_geojson(db.scalar(select(as_geojson(Node.location)).where(Node.id == node_id))))
        extra_m = haversine_m(lon_lat(location), node_point)

    graph = load_graph(db, case.id)
    if node_id not in graph.nodes or not graph.adj.get(node_id):
        raise ApiError(409, "ROUTE_UNAVAILABLE", "기준 지점에서 이어지는 도보 경로가 없어 범위를 계산할 수 없어요.")
    dist, prev = dijkstra(graph, node_id)
    silent = silent_cameras(db, case, graph, dist, basis_time, now, max_speed, node_id)
    pdist = penalized_distances(dist, prev, node_id, exit_node=exit_node, silent_cameras=silent)

    elapsed = max(0.0, (now - basis_time).total_seconds())
    hazards = [Hazard(z.id, z.name, z.severity, parse_geojson(gj))
               for z, gj in db.execute(select(HazardZone, as_geojson(HazardZone.area)).order_by(HazardZone.id)).all()]
    result = compute_area(graph, node_id, lon_lat(location), dist=pdist, reach_m=elapsed * speed, extra_m=extra_m,
                          ratios=ratios, buffer_m=settings.area_buffer_m, elapsed_s=elapsed, hazards=hazards,
                          exit_known=exit_node is not None)

    warnings = []
    if graph.needs_manual:
        warnings.append({"code": "ROUTE_PARTIAL", "message": f"보정이 필요한 도보 구간 {graph.needs_manual}개는 계산에서 빠졌어요.",
                         "related_video_ids": []})
    if silent:
        names = dict(db.execute(select(Node.id, Node.name).where(Node.id.in_(silent))).all())
        warnings.append({"code": "ABSENCE_APPLIED", "message": f"{', '.join(sorted(names.values()))}에 나타나지 않아 그 너머 범위를 낮췄어요.",
                         "related_video_ids": []})
    if elapsed > LONG_ELAPSED_S:
        warnings.append({"code": "ELAPSED_LONG", "message": "마지막 목격 뒤 오래 지나 범위가 넓어요.", "related_video_ids": []})
    return dump(S.SearchArea, {
        "case_id": case.id, "case_version": case.version, "calculated_at": utcnow(), "as_of": now,
        "basis_decision_id": str(basis.id) if basis else None, "basis_location": location, "basis_observed_at": basis_time,
        "walking_speed_mps": speed, "levels": result.levels, "hazard_overlaps": result.hazard_overlaps,
        "priority_areas": result.priority_areas, "warnings": warnings,
    })

