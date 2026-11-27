"""도보 경로 제공자. 외부 경로 API는 팀 미정(openapi D07)이라 바꿔 끼울 수 있게 둔다.

- tmap: SK open API 보행자 경로(TMAP_APP_KEY 필요). 카카오는 공개 도보 길찾기 REST API가 없다.
- straight: 직선 거리 × 우회 계수로 추정(시연·키 없을 때). error_code에 추정임을 남긴다.
설정: WALK_ROUTE_PROVIDER=tmap|straight
"""
from dataclasses import dataclass

import httpx

from app.config import get_settings
from app.geo import haversine_m

TMAP_URL = "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1"


@dataclass
class RouteResult:
    ok: bool
    distance_m: float | None = None
    duration_s: float | None = None
    coords: list[tuple[float, float]] | None = None
    error_code: str | None = None


def straight_route(a: tuple[float, float], b: tuple[float, float]) -> RouteResult:
    s = get_settings()
    d = haversine_m(a, b) * s.straight_detour_factor
    return RouteResult(ok=True, distance_m=round(d, 1), duration_s=round(d / s.straight_walk_speed_mps, 1),
                       coords=[a, b], error_code="STRAIGHT_LINE_ESTIMATE")


def parse_tmap(data: dict) -> RouteResult:
    """GeoJSON FeatureCollection: 첫 Point의 totalDistance·totalTime, LineString 좌표를 이어 붙인다."""
    features = data.get("features") or []
    total_d = total_t = None
    coords: list[tuple[float, float]] = []
    for f in features:
        props, geom = f.get("properties") or {}, f.get("geometry") or {}
        if total_d is None and "totalDistance" in props:
            total_d, total_t = float(props["totalDistance"]), float(props.get("totalTime", 0))
        if geom.get("type") == "LineString":
            for p in geom.get("coordinates") or []:
                pt = (float(p[0]), float(p[1]))
                if not coords or coords[-1] != pt:
                    coords.append(pt)
    if total_d is None or len(coords) < 2:
        return RouteResult(ok=False, error_code="ROUTE_NOT_FOUND")
    return RouteResult(ok=True, distance_m=total_d, duration_s=total_t, coords=coords)


def tmap_route(a: tuple[float, float], b: tuple[float, float], client: httpx.Client) -> RouteResult:
    key = get_settings().tmap_app_key
    if not key:
        return RouteResult(ok=False, error_code="ROUTE_API_KEY_MISSING")
    body = {"startX": a[0], "startY": a[1], "endX": b[0], "endY": b[1], "startName": "A", "endName": "B",
            "reqCoordType": "WGS84GEO", "resCoordType": "WGS84GEO"}
    try:
        res = client.post(TMAP_URL, json=body, headers={"appKey": key, "Accept": "application/json"}, timeout=15)
    except httpx.HTTPError:
        return RouteResult(ok=False, error_code="ROUTE_API_UNAVAILABLE")
    if res.status_code == 429:
        return RouteResult(ok=False, error_code="ROUTE_API_RATE_LIMITED")
    if res.status_code != 200:
        return RouteResult(ok=False, error_code=f"ROUTE_API_HTTP_{res.status_code}")
    return parse_tmap(res.json())


def find_route(a: tuple[float, float], b: tuple[float, float], client: httpx.Client | None = None) -> RouteResult:
    provider = get_settings().walk_route_provider
    if provider == "straight":
        return straight_route(a, b)
    if provider == "tmap":
        with (client or httpx.Client()) as c:
            return tmap_route(a, b, c)
    return RouteResult(ok=False, error_code="ROUTE_PROVIDER_UNKNOWN")
