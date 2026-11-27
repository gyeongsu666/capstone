"""알고리즘 A: 도보 그래프와 최단 경로.

노드 = 카메라·보조지점, 간선 = route_edges 중 status='ok'(무방향).
검색·범위 계산의 거리는 유효 거리 = distance_m × correction_factor(관리자 보정, 1회 적용).
노드가 수십 개 수준이라 매 요청 DB에서 읽어 메모리에서 Dijkstra를 돈다.
"""
import heapq
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.geo import as_geojson, haversine_m, lon_lat, parse_geojson
from app.models import Camera, Node, RouteEdge

INF = float("inf")


@dataclass
class EdgeInfo:
    edge_id: int
    a: int
    b: int
    distance_m: float
    effective_m: float
    duration_s: float
    coords: list[tuple[float, float]] | None  # a→b 방향이 아닐 수 있다(oriented_coords로 맞춘다)


@dataclass
class Graph:
    nodes: dict[int, tuple[float, float]] = field(default_factory=dict)  # id → (경도, 위도)
    kinds: dict[int, str] = field(default_factory=dict)
    edge_maps: dict[int, dict] = field(default_factory=dict)  # 카메라 id → 가장자리→인접 노드
    adj: dict[int, list[tuple[int, EdgeInfo]]] = field(default_factory=dict)
    needs_manual: int = 0

    def add_edge(self, e: EdgeInfo) -> None:
        self.adj.setdefault(e.a, []).append((e.b, e))
        self.adj.setdefault(e.b, []).append((e.a, e))

    def edge(self, u: int, v: int) -> EdgeInfo | None:
        return next((e for w, e in self.adj.get(u, []) if w == v), None)

    @property
    def edges(self) -> list[EdgeInfo]:
        seen, out = set(), []
        for lst in self.adj.values():
            for _, e in lst:
                if e.edge_id not in seen:
                    seen.add(e.edge_id)
                    out.append(e)
        return out


def load_graph(db: Session, case_id: int | None = None) -> Graph:
    """전역 노드 + (있으면) 그 사건 전용 노드. 다른 사건의 전용 노드는 넣지 않는다."""
    g = Graph()
    scope = or_(Node.scope == "global", Node.case_id == case_id) if case_id else Node.scope == "global"
    for nid, kind, loc, edge_map in db.execute(
        select(Node.id, Node.kind, as_geojson(Node.location), Camera.edge_node_map)
        .outerjoin(Camera, Camera.node_id == Node.id).where(scope)
    ).all():
        g.nodes[nid] = lon_lat(parse_geojson(loc))
        g.kinds[nid] = kind
        if edge_map:
            g.edge_maps[nid] = edge_map
    for e, path in db.execute(select(RouteEdge, as_geojson(RouteEdge.path))).all():
        if e.from_node_id not in g.nodes or e.to_node_id not in g.nodes:
            continue
        if e.status != "ok":
            g.needs_manual += 1
            continue
        coords = [tuple(p) for p in parse_geojson(path)["coordinates"]] if path else None
        g.add_edge(EdgeInfo(e.id, e.from_node_id, e.to_node_id, float(e.distance_m), float(e.distance_m) * float(e.correction_factor),
                            float(e.duration_s), coords))
    return g


def dijkstra(g: Graph, source: int, *, extra: dict[int, float] | None = None) -> tuple[dict[int, float], dict[int, int | None]]:
    """source에서 각 노드까지 유효 거리(m)와 직전 노드. extra는 노드에 들어갈 때 더할 벌점(m)."""
    dist: dict[int, float] = {source: 0.0}
    prev: dict[int, int | None] = {source: None}
    heap = [(0.0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, INF):
            continue
        for v, e in g.adj.get(u, []):
            nd = d + e.effective_m + (extra or {}).get(v, 0.0)
            if nd < dist.get(v, INF):
                dist[v], prev[v] = nd, u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def path_nodes(prev: dict[int, int | None], target: int) -> list[int] | None:
    if target not in prev:
        return None
    out, cur = [], target
    while cur is not None:
        out.append(cur)
        cur = prev[cur]
    return out[::-1]


def oriented_coords(g: Graph, e: EdgeInfo, start: int) -> list[tuple[float, float]]:
    """간선 경로선을 start 노드 쪽에서 시작하도록 뒤집는다. 경로선이 없으면 두 노드 직선."""
    a, b = g.nodes[e.a], g.nodes[e.b]
    coords = e.coords or [a, b]
    near_start = g.nodes[start]
    if haversine_m(coords[0], near_start) > haversine_m(coords[-1], near_start):
        coords = coords[::-1]
    return list(coords)


def path_line(g: Graph, nodes: list[int]) -> list[tuple[float, float]]:
    """노드 순서대로 간선 경로선을 이은 좌표(중복 점 제거)."""
    out: list[tuple[float, float]] = []
    for u, v in zip(nodes, nodes[1:]):
        e = g.edge(u, v)
        part = oriented_coords(g, e, u) if e else [g.nodes[u], g.nodes[v]]
        out.extend(part if not out else part[1:] if part[0] == out[-1] else part)
    return out


def raw_distance(g: Graph, nodes: list[int]) -> float:
    return sum(g.edge(u, v).distance_m for u, v in zip(nodes, nodes[1:]))
