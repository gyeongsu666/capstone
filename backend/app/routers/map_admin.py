"""관리자·카메라(SYS01-001), 도보 경로(SYS01-002), 위험 지역(SYS01-003), 수색 지도 조회."""
import re
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app import schemas_gen as S
from app.auth import AuthContext, can_access_case, require_admin, require_user, utcnow
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
from app.geo import as_geojson, endpoints_match, linestring_ewkt, lon_lat, parse_geojson, point_ewkt, polygon_ewkt
from app.models import Camera, Case, Decision, HazardZone, Node, RouteEdge, Task, Tracklet, Video, WatchAlert
from app.queue import new_task, publish, task_accepted
from app.serializers import dump

router = APIRouter()
EDGES = ("top", "right", "bottom", "left")
STREAM_RE = re.compile(r"^(rtsps?|https?|file)://\S+$", re.IGNORECASE)


# ---------------------------------------------------------------- 직렬화
def camera_row_out(node: Node, cam: Camera | None, location_json: str) -> dict[str, Any]:
    is_cam = node.kind == "camera" and cam is not None
    edge_map = None
    if is_cam:
        edge_map = {k: cam.edge_node_map.get(k) for k in EDGES}
    return {
        "node_id": node.id,
        "camera_id": node.id if is_cam else None,
        "kind": node.kind,
        "name": node.name,
        "location": parse_geojson(location_json),
        "direction_deg": cam.heading_deg if is_cam else None,
        "field_of_view_deg": cam.fov_deg if is_cam else None,
        "edge_node_map": edge_map,
        "has_stream": bool(is_cam and cam.stream_url),
        "version": node.version,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
    }


def camera_select():
    return select(Node, Camera, as_geojson(Node.location)).outerjoin(Camera, Camera.node_id == Node.id)


def load_camera_out(db: Session, node_id: int) -> dict[str, Any]:
    row = db.execute(camera_select().where(Node.id == node_id)).one()
    return camera_row_out(*row)


def edge_out(e: RouteEdge, path_json: str | None) -> dict[str, Any]:
    ratio = None
    if e.distance_m is not None and e.straight_distance_m:
        ratio = round(e.distance_m / e.straight_distance_m, 3)
    return {
        "edge_id": e.id, "from_node_id": e.from_node_id, "to_node_id": e.to_node_id,
        "distance_m": e.distance_m if e.distance_m is not None else 0.0,
        "duration_s": e.duration_s if e.duration_s is not None else 0.0,
        "geometry": parse_geojson(path_json), "source": e.source, "status": e.status,
        "suspected_detour": e.suspected_detour, "detour_ratio": ratio, "correction_factor": e.correction_factor,
        "version": e.version, "updated_at": e.updated_at,
    }


def zone_out(z: HazardZone, area_json: str) -> dict[str, Any]:
    return {
        "zone_id": z.id, "name": z.name, "kind": z.kind, "severity": z.severity, "geometry": parse_geojson(area_json),
        "description": z.description, "version": z.version, "created_at": z.created_at, "updated_at": z.updated_at,
    }


def _page(model, items, page) -> dict:
    return dump(model, {"items": items, "next_cursor": page.next_cursor, "has_more": page.has_more})


# ---------------------------------------------------------------- 카메라·보조지점
def _check_edge_map(db: Session, edge_map: dict | None, self_id: int | None = None) -> dict:
    """가장자리 → 인접 노드. 존재하는 전역 노드만 허용한다."""
    edge_map = {k: (edge_map or {}).get(k) for k in EDGES}
    ids = {v for v in edge_map.values() if v is not None}
    if self_id is not None and self_id in ids:
        raise ApiError(422, "INVALID_NODE_REFERENCE", "자기 자신을 인접 노드로 지정할 수 없어요.")
    if ids:
        found = set(db.scalars(select(Node.id).where(Node.id.in_(ids), Node.scope == "global")).all())
        if missing := sorted(ids - found):
            raise ApiError(422, "INVALID_NODE_REFERENCE", f"없는 노드를 지정했어요: {missing}",
                           fields=[{"field": "edge_node_map", "code": "unknown_node", "message": str(missing)}])
    return edge_map


def _check_stream(url: str | None) -> str | None:
    if url is None:
        return None
    url = url.strip()
    if not STREAM_RE.match(url):
        raise ApiError(422, "INVALID_STREAM_URL", "스트림 주소는 rtsp://, http(s)://, file:// 형식이어야 해요.")
    return url


def _camera_fields(kind: str, data: dict, partial: bool) -> None:
    if kind == "camera":
        if not partial:
            for f in ("direction_deg", "field_of_view_deg"):
                if data.get(f) is None:
                    raise ApiError(422, "VALIDATION_ERROR", "카메라는 방향과 화각이 필요해요.", fields=[{"field": f, "code": "required", "message": "필수"}])
        if data.get("direction_deg") is not None and not (0 <= data["direction_deg"] < 360):
            raise ApiError(422, "VALIDATION_ERROR", "방향은 0 이상 360 미만이에요.", fields=[{"field": "direction_deg", "code": "range", "message": "0~360"}])
        if data.get("field_of_view_deg") is not None and not (0 < data["field_of_view_deg"] <= 360):
            raise ApiError(422, "VALIDATION_ERROR", "화각은 0 초과 360 이하예요.", fields=[{"field": "field_of_view_deg", "code": "range", "message": "0~360"}])
    else:
        for f in ("direction_deg", "field_of_view_deg", "edge_node_map", "stream_url"):
            if data.get(f) is not None:
                raise ApiError(422, "VALIDATION_ERROR", "보조지점에는 방향·화각·스트림을 넣을 수 없어요.", fields=[{"field": f, "code": "forbidden", "message": "보조지점 금지"}])


def _queue_route_task(db: Session, auth: AuthContext) -> Task:
    """새·이동한 노드와 다른 노드 사이 도보 경로 계산 작업(계산 자체는 5단계 알고리즘 A)."""
    return new_task(db, "walk_graph_recalculation", created_by=auth.user.id)


@router.get("/api/cameras", response_model=S.CameraPage, tags=["관리자·카메라"], summary="카메라·보조지점 목록")
def list_cameras(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    kind: str | None = Query(None, pattern="^(camera|waypoint)$"),
    case_id: int | None = Query(None, ge=1),
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """case_id 없으면 전역 노드만, 있으면 그 사건 전용 카메라도 포함(사건 접근 권한 검사)."""
    stmt = camera_select()
    if case_id is not None:
        if not can_access_case(db, auth, case_id):
            raise ApiError(404, "RESOURCE_NOT_FOUND", "사건을 찾을 수 없거나 접근 권한이 없습니다.")
        stmt = stmt.where(or_(Node.scope == "global", Node.case_id == case_id))
    else:
        stmt = stmt.where(Node.scope == "global")
    if kind:
        stmt = stmt.where(Node.kind == kind)
    page = keyset_page(db, stmt, [SortKey(Node.id, False)], limit=limit, cursor=cursor, scalars=False,
                       scope=scope_of("cameras", kind=kind, case_id=case_id), key_of=lambda r: (r[0].id,))
    return _page(S.CameraPage, [camera_row_out(*r) for r in page.rows], page)


@router.post("/api/cameras", status_code=201, response_model=S.CameraCreated, tags=["관리자·카메라"], summary="카메라·보조지점 등록")
def create_camera(body: S.CameraCreateRequest, request: Request, auth: AuthContext = Depends(require_admin),
                  db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, "create_camera", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    kind = data["kind"]
    _camera_fields(kind, data, partial=False)
    ewkt = point_ewkt(data["location"])
    node = Node(kind=kind, name=data["name"].strip(), location=ewkt, scope="global")
    db.add(node)
    db.flush()
    if kind == "camera":
        db.add(Camera(node_id=node.id, heading_deg=data["direction_deg"], fov_deg=data["field_of_view_deg"],
                      edge_node_map=_check_edge_map(db, data.get("edge_node_map"), node.id),
                      stream_url=_check_stream(data.get("stream_url"))))
    task = _queue_route_task(db, auth)
    record_audit(db, request, auth.user, "CAMERA_CREATE", "node", node.id, changed_fields=sorted(data))
    db.flush()
    out = dump(S.CameraCreated, {"camera": load_camera_out(db, node.id), "route_task": task_accepted(task)})
    response = idem.complete(201, out)
    db.commit()
    publish(db, task, {"node_ids": [node.id], "include_manual": False})
    return response


def _location_referenced(db: Session, node_id: int) -> int:
    counts = [
        db.scalar(select(func.count()).select_from(Video).where(Video.camera_id == node_id)),
        db.scalar(select(func.count()).select_from(Decision).where(Decision.camera_id == node_id)),
    ]
    return sum(c or 0 for c in counts)


@router.patch("/api/cameras/{node_id}", response_model=S.Camera, tags=["관리자·카메라"], summary="카메라·보조지점 수정")
def patch_camera(node_id: int, body: S.CameraPatch, request: Request, auth: AuthContext = Depends(require_admin),
                 db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude_unset=True)
    node = db.scalar(select(Node).where(Node.id == node_id, Node.scope == "global").with_for_update())
    if node is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "노드를 찾을 수 없어요.")
    check_version(node.version, data["expected_version"])
    if "kind" in data and data["kind"] != node.kind:
        raise ApiError(409, "NODE_KIND_IMMUTABLE", "카메라·보조지점 종류는 바꿀 수 없어요.")
    _camera_fields(node.kind, data, partial=True)
    changed = sorted(k for k in data if k not in ("expected_version", "kind"))
    relocate = False
    if "name" in data:
        node.name = data["name"].strip()
    if "location" in data:
        if (refs := _location_referenced(db, node.id)) > 0:
            raise ApiError(409, "NODE_LOCATION_REFERENCED", "영상이나 판단 기록이 있는 카메라는 위치를 바꿀 수 없어요.",
                           context={"reference_count": refs})
        node.location = point_ewkt(data["location"])
        relocate = True
    if node.kind == "camera":
        cam = db.get(Camera, node.id)
        if "direction_deg" in data:
            cam.heading_deg = data["direction_deg"]
        if "field_of_view_deg" in data:
            cam.fov_deg = data["field_of_view_deg"]
        if "edge_node_map" in data:
            cam.edge_node_map = _check_edge_map(db, data["edge_node_map"], node.id)
        if "stream_url" in data:
            cam.stream_url = _check_stream(data["stream_url"])
    node.version, node.updated_at = node.version + 1, utcnow()
    task = None
    if relocate:
        # 위치가 바뀐 노드의 도보 구간은 다시 계산할 때까지 쓰지 않는다
        db.execute(update(RouteEdge).where(or_(RouteEdge.from_node_id == node.id, RouteEdge.to_node_id == node.id))
                   .values(status="needs_manual", source="api", updated_at=utcnow(), version=RouteEdge.version + 1))
        task = _queue_route_task(db, auth)
    record_audit(db, request, auth.user, "CAMERA_UPDATE", "node", node.id, changed_fields=changed)
    db.commit()
    if task is not None:
        publish(db, task, {"node_ids": [node.id], "include_manual": True})
    return dump(S.Camera, load_camera_out(db, node.id))


@router.delete("/api/cameras/{node_id}", response_model=S.DeletedResponse, tags=["관리자·카메라"], summary="카메라·보조지점 삭제")
def delete_camera(node_id: int, request: Request, auth: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    node = db.scalar(select(Node).where(Node.id == node_id, Node.scope == "global").with_for_update())
    if node is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "노드를 찾을 수 없어요.")
    cam = db.get(Camera, node.id)
    if cam and cam.stream_url and db.scalar(select(func.count()).select_from(Case).where(Case.status == "open", Case.watch_enabled)):
        raise ApiError(409, "WATCH_ACTIVE", "실시간 감시 중인 카메라는 삭제할 수 없어요.")
    neighbours = db.scalar(select(func.count()).select_from(Camera).where(
        Camera.node_id != node.id,
        or_(*[Camera.edge_node_map[k].astext == str(node.id) for k in EDGES]),
    ))
    refs = sum(c or 0 for c in [
        db.scalar(select(func.count()).select_from(Video).where(Video.camera_id == node.id)),
        db.scalar(select(func.count()).select_from(Tracklet).where(or_(Tracklet.entry_node_id == node.id, Tracklet.exit_node_id == node.id))),
        db.scalar(select(func.count()).select_from(Case).where(Case.origin_node_id == node.id)),
        db.scalar(select(func.count()).select_from(Decision).where(Decision.camera_id == node.id)),
        db.scalar(select(func.count()).select_from(WatchAlert).where(WatchAlert.camera_id == node.id)),
        neighbours,
    ])
    if refs:
        raise ApiError(409, "RESOURCE_REFERENCED", "다른 자료가 이 노드를 쓰고 있어 삭제할 수 없어요.", context={"reference_count": refs})
    db.delete(node)  # cameras·route_edges는 함께 지워진다(ON DELETE CASCADE)
    record_audit(db, request, auth.user, "CAMERA_DELETE", "node", node_id)
    db.commit()
    return {"id": str(node_id), "deleted": True}


# ---------------------------------------------------------------- 도보 경로
def _walk_task_running(db: Session) -> bool:
    return db.scalar(select(func.count()).select_from(Task).where(
        Task.kind == "walk_graph_recalculation", Task.status.in_(("queued", "running")))) > 0


@router.get("/api/walk-graph", response_model=S.WalkEdgePage, tags=["관리자·도보 경로"], summary="도보 경로 구간·우회 의심 조회")
def list_walk_edges(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    status: str | None = Query(None, pattern="^(ok|needs_manual)$"),
    suspected_detour: bool | None = None,
    node_id: int | None = Query(None, ge=1),
    _: AuthContext = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = select(RouteEdge, as_geojson(RouteEdge.path))
    if status:
        stmt = stmt.where(RouteEdge.status == status)
    if suspected_detour is not None:
        stmt = stmt.where(RouteEdge.suspected_detour.is_(suspected_detour))
    if node_id:
        stmt = stmt.where(or_(RouteEdge.from_node_id == node_id, RouteEdge.to_node_id == node_id))
    page = keyset_page(db, stmt, [SortKey(RouteEdge.id, False)], limit=limit, cursor=cursor, scalars=False,
                       scope=scope_of("walk", s=status, d=suspected_detour, n=node_id), key_of=lambda r: (r[0].id,))
    return _page(S.WalkEdgePage, [edge_out(*r) for r in page.rows], page)


@router.post("/api/walk-graph/recalculations", status_code=202, response_model=S.TaskAccepted, tags=["관리자·도보 경로"], summary="도보 경로 다시 계산")
def recalculate_walk_edges(body: S.WalkRecalculateRequest, request: Request, auth: AuthContext = Depends(require_admin),
                           db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, "recalculate_walk_edges", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    if _walk_task_running(db):
        raise ApiError(409, "RECALCULATION_IN_PROGRESS", "도보 경로를 계산하고 있어요. 끝난 뒤 다시 시도해 주세요.")
    edge_ids = data.get("edge_ids")
    if edge_ids:
        found = set(db.scalars(select(RouteEdge.id).where(RouteEdge.id.in_(edge_ids))).all())
        if missing := sorted(set(edge_ids) - found):
            raise ApiError(422, "VALIDATION_ERROR", f"없는 구간이에요: {missing}", fields=[{"field": "edge_ids", "code": "unknown", "message": str(missing)}])
    task = new_task(db, "walk_graph_recalculation", created_by=auth.user.id)
    record_audit(db, request, auth.user, "WALK_RECALCULATE", "walk_graph", task.id)
    response = idem.complete(202, dump(S.TaskAccepted, task_accepted(task)))
    db.commit()
    publish(db, task, {"edge_ids": edge_ids, "include_manual": bool(data.get("include_manual", False))})
    return response


@router.patch("/api/walk-graph/{edge_id}", response_model=S.WalkEdge, tags=["관리자·도보 경로"], summary="도보 구간 보정값 수정")
def patch_walk_edge(edge_id: int, body: S.WalkEdgePatch, request: Request, auth: AuthContext = Depends(require_admin),
                    db: Session = Depends(get_db)):
    """거리·시간·경로선 보정은 source=manual, status=ok로 저장. correction_factor는 검색 유효 거리에 곱한다."""
    data = body.model_dump(mode="json", exclude_unset=True)
    edge = db.scalar(select(RouteEdge).where(RouteEdge.id == edge_id).with_for_update())
    if edge is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "도보 구간을 찾을 수 없어요.")
    check_version(edge.version, data["expected_version"])
    if _walk_task_running(db):
        raise ApiError(409, "RECALCULATION_IN_PROGRESS", "도보 경로를 계산하고 있어요. 끝난 뒤 다시 시도해 주세요.")
    manual = False
    for f in ("distance_m", "duration_s"):
        if f in data:
            if data[f] is None or data[f] < 0:
                raise ApiError(422, "VALIDATION_ERROR", "0 이상이어야 해요.", fields=[{"field": f, "code": "range", "message": "≥ 0"}])
            setattr(edge, f, data[f])
            manual = True
    if "geometry" in data:
        ends = db.execute(select(as_geojson(Node.location)).where(Node.id.in_((edge.from_node_id, edge.to_node_id)))
                          .order_by(Node.id)).scalars().all()
        a, b = (lon_lat(parse_geojson(x)) for x in ends)
        ewkt = linestring_ewkt(data["geometry"])
        if not endpoints_match(data["geometry"], a, b):
            raise ApiError(422, "EDGE_ENDPOINT_MISMATCH", "경로선의 양끝이 두 노드 위치와 맞지 않아요.")
        edge.path = ewkt
        manual = True
    if "correction_factor" in data:
        if not data["correction_factor"] or data["correction_factor"] <= 0:
            raise ApiError(422, "VALIDATION_ERROR", "보정 계수는 0보다 커야 해요.", fields=[{"field": "correction_factor", "code": "range", "message": "> 0"}])
        edge.correction_factor = data["correction_factor"]
    if manual:
        if edge.distance_m is None or edge.duration_s is None or edge.path is None:
            raise ApiError(422, "VALIDATION_ERROR", "수동 보정에는 거리·시간·경로선이 모두 있어야 해요.")
        edge.source, edge.status, edge.error_code = "manual", "ok", None
        if edge.straight_distance_m:
            edge.suspected_detour = edge.distance_m / edge.straight_distance_m > 1.8
    edge.version, edge.updated_at = edge.version + 1, utcnow()
    record_audit(db, request, auth.user, "WALK_EDGE_UPDATE", "route_edge", edge.id,
                 changed_fields=sorted(k for k in data if k != "expected_version"))
    db.commit()
    row = db.execute(select(RouteEdge, as_geojson(RouteEdge.path)).where(RouteEdge.id == edge.id)).one()
    return dump(S.WalkEdge, edge_out(*row))


# ---------------------------------------------------------------- 위험 지역
def _zone_by_id(db: Session, zone_id: int, *, for_update: bool = False) -> HazardZone:
    stmt = select(HazardZone).where(HazardZone.id == zone_id)
    zone = db.scalar(stmt.with_for_update() if for_update else stmt)
    if zone is None:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "위험 지역을 찾을 수 없어요.")
    return zone


def _zone_out(db: Session, zone_id: int) -> dict:
    return dump(S.DangerZone, zone_out(*db.execute(select(HazardZone, as_geojson(HazardZone.area)).where(HazardZone.id == zone_id)).one()))


@router.get("/api/danger-zones", response_model=S.DangerZonePage, tags=["관리자·위험 지역"], summary="위험 지역 목록")
def list_danger_zones(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    kind: str | None = Query(None, pattern="^(water|steep_slope|road|construction|other)$"),
    _: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    stmt = select(HazardZone, as_geojson(HazardZone.area))
    if kind:
        stmt = stmt.where(HazardZone.kind == kind)
    page = keyset_page(db, stmt, [SortKey(HazardZone.id, False)], limit=limit, cursor=cursor, scalars=False,
                       scope=scope_of("zones", kind=kind), key_of=lambda r: (r[0].id,))
    return _page(S.DangerZonePage, [zone_out(*r) for r in page.rows], page)


@router.post("/api/danger-zones", status_code=201, response_model=S.DangerZone, tags=["관리자·위험 지역"], summary="위험 지역 등록")
def create_danger_zone(body: S.DangerZoneCreateRequest, request: Request, auth: AuthContext = Depends(require_admin),
                       db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude_unset=True)
    idem = Idempotency.begin(db, request, auth.user, "create_danger_zone", request_fingerprint(data))
    if idem.replay:
        return idem.replay
    zone = HazardZone(name=data["name"].strip(), kind=data["kind"], severity=data["severity"],
                      description=data.get("description") or "", area=polygon_ewkt(data["geometry"]))
    db.add(zone)
    db.flush()
    record_audit(db, request, auth.user, "DANGER_ZONE_CREATE", "hazard_zone", zone.id)
    response = idem.complete(201, _zone_out(db, zone.id))
    db.commit()
    return response


@router.patch("/api/danger-zones/{zone_id}", response_model=S.DangerZone, tags=["관리자·위험 지역"], summary="위험 지역 수정")
def patch_danger_zone(zone_id: int, body: S.DangerZonePatch, request: Request, auth: AuthContext = Depends(require_admin),
                      db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude_unset=True)
    zone = _zone_by_id(db, zone_id, for_update=True)
    check_version(zone.version, data["expected_version"])
    for f in ("name", "kind", "severity", "description"):
        if f in data:
            setattr(zone, f, data[f].strip() if f == "name" else data[f])
    if "geometry" in data:
        zone.area = polygon_ewkt(data["geometry"])
    zone.version, zone.updated_at = zone.version + 1, utcnow()
    record_audit(db, request, auth.user, "DANGER_ZONE_UPDATE", "hazard_zone", zone.id,
                 changed_fields=sorted(k for k in data if k != "expected_version"))
    db.commit()
    return _zone_out(db, zone.id)


@router.delete("/api/danger-zones/{zone_id}", response_model=S.DeletedResponse, tags=["관리자·위험 지역"], summary="위험 지역 삭제")
def delete_danger_zone(zone_id: int, request: Request, auth: AuthContext = Depends(require_admin), db: Session = Depends(get_db)):
    zone = _zone_by_id(db, zone_id, for_update=True)
    db.delete(zone)
    record_audit(db, request, auth.user, "DANGER_ZONE_DELETE", "hazard_zone", zone_id)
    db.commit()
    return {"id": str(zone_id), "deleted": True}


# ---------------------------------------------------------------- 수색 지도(한 번에)
@router.get("/api/map", response_model=S.MapData, tags=["보조 조회"], summary="수색 화면 지도 조회")
def get_map(
    cursor: str | None = CursorParam,
    limit: int = LimitParam,
    case_id: int | None = Query(None, ge=1),
    west: float | None = None, south: float | None = None, east: float | None = None, north: float | None = None,
    auth: AuthContext = Depends(require_user),
    db: Session = Depends(get_db),
):
    """카메라·도보 구간·위험 지역을 한 번에 준다(규모가 작아 한 페이지). 스트림 주소는 넣지 않는다."""
    bbox = (west, south, east, north)
    if any(v is not None for v in bbox) and (None in bbox or not (west < east and south < north)):
        raise ApiError(422, "VALIDATION_ERROR", "bbox는 네 값을 함께, west<east·south<north로 지정해요.")
    cams_stmt = camera_select()
    if case_id is not None:
        if not can_access_case(db, auth, case_id):
            raise ApiError(404, "RESOURCE_NOT_FOUND", "사건을 찾을 수 없거나 접근 권한이 없습니다.")
        cams_stmt = cams_stmt.where(or_(Node.scope == "global", Node.case_id == case_id))
    else:
        cams_stmt = cams_stmt.where(Node.scope == "global")
    cameras = [camera_row_out(*r) for r in db.execute(cams_stmt.order_by(Node.id)).all()]
    if None not in bbox:
        cameras = [c for c in cameras if west <= c["location"]["coordinates"][0] <= east and south <= c["location"]["coordinates"][1] <= north]
    node_ids = {c["node_id"] for c in cameras}
    edges = [edge_out(*r) for r in db.execute(select(RouteEdge, as_geojson(RouteEdge.path)).order_by(RouteEdge.id)).all()
             if r[0].from_node_id in node_ids or r[0].to_node_id in node_ids]
    zones = [zone_out(*r) for r in db.execute(select(HazardZone, as_geojson(HazardZone.area)).order_by(HazardZone.id)).all()]
    return dump(S.MapData, {"cameras": cameras, "walk_edges": edges, "danger_zones": zones, "next_cursor": None, "has_more": False})
