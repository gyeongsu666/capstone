"""도보 경로 다시 계산(CPU 워커, default 대기열). 노드 쌍마다 경로 제공자를 불러 route_edges를 채운다."""
import time
from uuid import UUID

import httpx
from sqlalchemy import or_, select, update

from app.auth import utcnow
from app.config import get_settings
from app.db import session_scope
from app.geo import as_geojson, haversine_m, lon_lat, parse_geojson
from app.models import Case, Node, RouteEdge, Task
from app.walk_route import find_route


def pairs_to_compute(nodes: dict[int, tuple[str, int | None]], *, node_ids: list[int] | None,
                     edge_pairs: list[tuple[int, int]] | None) -> list[tuple[int, int]]:
    """계산할 (작은 id, 큰 id) 쌍. 사건 전용 노드는 전역 노드하고만 잇는다(다른 사건과는 잇지 않음).

    nodes: id → (scope, case_id)
    """
    def linkable(a: int, b: int) -> bool:
        # 사건 전용 노드끼리는 잇지 않는다(전역 노드를 거쳐 통한다)
        return not (nodes[a][0] == "case" and nodes[b][0] == "case")

    if edge_pairs:
        return sorted({(min(a, b), max(a, b)) for a, b in edge_pairs if a in nodes and b in nodes})
    ids = sorted(nodes)
    targets = set(node_ids) & set(ids) if node_ids else set(ids)
    out = set()
    for a in targets:
        for b in ids:
            if a != b and linkable(a, b):
                out.add((min(a, b), max(a, b)))
    return sorted(out)


def _progress(task_id: UUID, done: int, total: int, **extra) -> None:
    with session_scope() as db:
        db.execute(update(Task).where(Task.id == task_id).values(
            progress=min(99, int(99 * done / total)) if total else 0, heartbeat_at=utcnow(), updated_at=utcnow(), **extra))


def run_walk_recalculation(task_id: str, node_ids: list[int] | None = None, edge_ids: list[int] | None = None,
                           include_manual: bool = False) -> dict:
    tid = UUID(task_id)
    s = get_settings()
    with session_scope() as db:
        task = db.get(Task, tid)
        if task is None or task.status != "queued":
            return {"skipped": True}
        task.status, task.stage, task.updated_at = "running", "analyzing", utcnow()
        open_cases = set(db.scalars(select(Case.id).where(Case.status == "open")).all())
        rows = db.execute(select(Node.id, Node.scope, Node.case_id, as_geojson(Node.location))
                          .where(or_(Node.scope == "global", Node.case_id.in_(open_cases or {0})))).all()
        nodes = {r[0]: (r[1], r[2]) for r in rows}
        points = {r[0]: lon_lat(parse_geojson(r[3])) for r in rows}
        edge_pairs = None
        if edge_ids:
            edge_pairs = [(a, b) for a, b in db.execute(select(RouteEdge.from_node_id, RouteEdge.to_node_id)
                                                        .where(RouteEdge.id.in_(edge_ids))).all()]
        existing = {(e.from_node_id, e.to_node_id): (e.source, e.id) for e in db.scalars(select(RouteEdge)).all()}
    pairs = pairs_to_compute(nodes, node_ids=node_ids, edge_pairs=edge_pairs)
    computed = failed = 0
    with httpx.Client() as client:
        for i, (a, b) in enumerate(pairs, 1):
            source, _ = existing.get((a, b), (None, None))
            if source == "manual" and not include_manual:
                continue  # 관리자 보정값은 덮어쓰지 않는다
            result = find_route(points[a], points[b], client)
            straight = haversine_m(points[a], points[b])
            with session_scope() as db:
                edge = db.scalar(select(RouteEdge).where(RouteEdge.from_node_id == a, RouteEdge.to_node_id == b).with_for_update())
                if edge is None:
                    edge = RouteEdge(from_node_id=a, to_node_id=b, source="api", status="needs_manual")
                    db.add(edge)
                edge.straight_distance_m = round(straight, 1)
                edge.source, edge.updated_at = "api", utcnow()
                edge.version = (edge.version or 1) + (1 if edge.id else 0)
                if result.ok:
                    edge.distance_m, edge.duration_s = result.distance_m, result.duration_s
                    edge.path = "SRID=4326;LINESTRING(" + ", ".join(f"{x!r} {y!r}" for x, y in result.coords) + ")"
                    edge.status, edge.error_code = "ok", result.error_code
                    edge.suspected_detour = bool(straight) and result.distance_m / straight > s.detour_suspect_ratio
                    computed += 1
                else:
                    edge.status, edge.error_code = "needs_manual", result.error_code
                    failed += 1
            if i % 5 == 0 or i == len(pairs):
                _progress(tid, i, len(pairs))
            if s.walk_route_provider == "tmap":
                time.sleep(0.2)  # 외부 API 요청 간격
    with session_scope() as db:
        db.execute(update(Task).where(Task.id == tid).values(
            status="done", stage="done", progress=100, updated_at=utcnow(),
            result={"route_edge_count": computed}, **({"error": None} if not failed else {})))
    return {"computed": computed, "failed": failed}
