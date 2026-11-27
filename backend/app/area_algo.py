"""알고리즘 G: 현재 위치 3단계 범위, 위험 지역 겹침, 우선 수색 구역.

1. 도달 거리 R = 경과 시간 × 유형별 평소 보행 속도. 단계 k의 거리 = R × area_level_ratios[k](누적: r1 < r2 < r3 = 1)
2. 기준 노드에서 도보 그래프 최단 유효 거리 → 간선마다 양 끝에서 남은 거리만큼 경로선을 잘라 모은다(길을 따라 퍼짐, 동심원 아님)
3. 이탈 방향이 아닌 쪽, 찍혔어야 할 카메라에 나타나지 않은 쪽 너머는 거리를 늘려(벌점) 단계를 낮춘다
4. 모은 선을 area_buffer_m만큼 버퍼·합집합 → 단계별 면. 위험 지역과 겹침 판정, 우선 구역 순위
좌표는 기준점 주변 평면(m)으로 바꿔 계산하고 다시 경위도로 돌린다(캠퍼스 규모라 오차가 작다).
"""
import math
from collections.abc import Callable
from dataclasses import dataclass, field

from shapely.geometry import LineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import substring, transform, unary_union

from app.walkgraph import Graph, path_nodes

DIRECTION_PENALTY = 1.5  # 이탈 방향이 아닌 쪽 거리 배수
ABSENCE_PENALTY = 1.5  # 나타나지 않은 카메라 너머 거리 배수
LEVEL_LABELS = {1: "높음", 2: "중간", 3: "낮음"}
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def projector(lon0: float, lat0: float) -> tuple[Callable, Callable]:
    kx, ky = 111_320.0 * math.cos(math.radians(lat0)), 110_540.0

    def fwd(x, y, z=None):
        return (x - lon0) * kx, (y - lat0) * ky

    def inv(x, y, z=None):
        return x / kx + lon0, y / ky + lat0

    return fwd, inv


def penalized_distances(
    dist: dict[int, float], prev: dict[int, int | None], source: int, *,
    exit_node: int | None = None, silent_cameras: set[int] = frozenset(),
) -> dict[int, float]:
    """이탈 방향이 아닌 쪽, 나타나지 않은 카메라를 지나야 닿는 노드는 거리를 늘린다."""
    out = {}
    for node, d in dist.items():
        path = path_nodes(prev, node) or [node]
        factor = 1.0
        if exit_node is not None and len(path) >= 2 and path[1] != exit_node:
            factor *= DIRECTION_PENALTY
        if any(c in silent_cameras for c in path[1:-1]) or (node in silent_cameras and node != source):
            factor *= ABSENCE_PENALTY
        out[node] = d * factor
    return out


def reachable_lines(g: Graph, dist: dict[int, float], budget: float, fwd: Callable) -> list:
    """간선 양 끝에서 남은 거리만큼 경로선을 자른 조각들(평면 좌표)."""
    from app.walkgraph import oriented_coords

    pieces = []
    for e in g.edges:
        du, dv = dist.get(e.a, math.inf), dist.get(e.b, math.inf)
        if min(du, dv) >= budget or e.effective_m <= 0:
            continue
        line = transform(fwd, LineString(oriented_coords(g, e, e.a)))
        fu = max(0.0, min(1.0, (budget - du) / e.effective_m)) if du < budget else 0.0
        fv = max(0.0, min(1.0, (budget - dv) / e.effective_m)) if dv < budget else 0.0
        if fu + fv >= 1.0:
            pieces.append(line)
            continue
        if fu > 0:
            pieces.append(substring(line, 0.0, fu, normalized=True))
        if fv > 0:
            pieces.append(substring(line, 1.0 - fv, 1.0, normalized=True))
    return pieces


def to_geojson(geom, inv: Callable) -> dict | None:
    if geom is None or geom.is_empty:
        return None
    geom = transform(inv, geom)
    if isinstance(geom, Polygon | MultiPolygon):
        data = mapping(geom)
    else:  # 면이 아닌 조각만 남으면 면만 추린다
        polys = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]
        if not polys:
            return None
        data = mapping(MultiPolygon(polys))

    def r(c):
        return [round(c[0], 7), round(c[1], 7)]

    def walk(obj):
        if isinstance(obj, tuple | list) and obj and isinstance(obj[0], int | float):
            return r(obj)
        return [walk(o) for o in obj]

    return {"type": data["type"], "coordinates": walk(data["coordinates"])}


@dataclass
class Hazard:
    zone_id: int
    name: str
    severity: str
    geometry: dict


@dataclass
class AreaResult:
    levels: list[dict] = field(default_factory=list)
    hazard_overlaps: list[dict] = field(default_factory=list)
    priority_areas: list[dict] = field(default_factory=list)


def compute_area(
    g: Graph, basis_node: int, basis_point: tuple[float, float], *,
    dist: dict[int, float], reach_m: float, extra_m: float, ratios: list[float], buffer_m: float,
    elapsed_s: float, hazards: list[Hazard], exit_known: bool = False,
) -> AreaResult:
    fwd, inv = projector(*basis_point)
    start = Point(fwd(*basis_point))
    result = AreaResult()
    level_shapes = []
    for k, ratio in enumerate(ratios, 1):
        budget = max(0.0, reach_m * ratio - extra_m)
        pieces = reachable_lines(g, dist, budget, fwd) if budget > 0 else []
        geom = unary_union([p.buffer(buffer_m) for p in pieces] + [start.buffer(buffer_m)])
        level_shapes.append(geom)
        result.levels.append({"level": k, "label": LEVEL_LABELS[k], "geometry": to_geojson(geom, inv),
                              "max_travel_time_s": round(elapsed_s * ratio, 1)})

    overlaps = []
    for h in hazards:
        zone = transform(fwd, shape(h.geometry))
        for k, geom in enumerate(level_shapes, 1):
            hit = geom.intersection(zone)
            if not hit.is_empty and hit.area > 0:
                gj = to_geojson(hit, inv)
                if gj:
                    overlaps.append((k, h, hit, gj))
                break
    overlaps.sort(key=lambda o: (o[0], SEVERITY_ORDER.get(o[1].severity, 3), o[1].zone_id))
    result.hazard_overlaps = [{"zone_id": h.zone_id, "name": h.name, "severity": h.severity, "overlap_geometry": gj, "level": k}
                              for k, h, _, gj in overlaps]

    reasons = ["마지막 목격 지점에서 가장 가까운 범위"] + (["이탈 방향 반영"] if exit_known else [])
    near = to_geojson(level_shapes[0], inv)
    priorities = [{"geometry": near, "reasons": reasons, "hazard_zone_ids": []}] if near else []
    for k, h, hit, _ in sorted(overlaps, key=lambda o: (SEVERITY_ORDER.get(o[1].severity, 3), o[0])):
        around = to_geojson(hit.buffer(20).intersection(level_shapes[-1]), inv)
        if around:
            priorities.append({"geometry": around, "reasons": [f"위험 지역 '{h.name}' 겹침(위험도 {h.severity}, {LEVEL_LABELS[k]} 범위)"],
                               "hazard_zone_ids": [h.zone_id]})
    result.priority_areas = [{"rank": i, **p} for i, p in enumerate(priorities[:5], 1)]
    return result
