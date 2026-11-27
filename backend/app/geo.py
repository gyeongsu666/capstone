"""좌표·도형. API는 GeoJSON([경도, 위도]), DB는 geography(4326).

- 쓰기: GeoJSON → 검증(shapely) → EWKT 문자열 → geography 칸(GeoAlchemy가 ST_GeogFromText로 감싼다)
- 읽기: SQL에서 ST_AsGeoJSON(칸)으로 꺼내 json으로 바꾼다(as_geojson)
"""
import json
import math
from typing import Any

from shapely.geometry import LineString, Polygon, shape
from shapely.validation import explain_validity
from sqlalchemy import func

from app.errors import ApiError

EARTH_RADIUS_M = 6_371_008.8


def _invalid(field: str, message: str) -> ApiError:
    return ApiError(422, "INVALID_GEOMETRY", message, fields=[{"field": field, "code": "invalid_geometry", "message": message}])


def _check_lon_lat(coords: list[float], field: str) -> None:
    if len(coords) != 2 or not all(isinstance(c, int | float) and math.isfinite(c) for c in coords):
        raise _invalid(field, "좌표는 [경도, 위도] 숫자 두 개여야 해요.")
    lon, lat = coords
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise _invalid(field, "경도는 -180~180, 위도는 -90~90이어야 해요.")


def point_ewkt(geojson: dict, field: str = "location") -> str:
    if not isinstance(geojson, dict) or geojson.get("type") != "Point":
        raise _invalid(field, "Point 도형이어야 해요.")
    coords = list(geojson.get("coordinates") or [])
    _check_lon_lat(coords, field)
    return f"SRID=4326;POINT({coords[0]!r} {coords[1]!r})"


def polygon_ewkt(geojson: dict, field: str = "geometry") -> str:
    """닫힌 고리, 서로 다른 꼭짓점 3개 이상, 자기 교차 없음. 자동 수정하지 않는다."""
    if not isinstance(geojson, dict) or geojson.get("type") != "Polygon":
        raise _invalid(field, "Polygon 도형이어야 해요.")
    rings = geojson.get("coordinates") or []
    if not rings:
        raise _invalid(field, "꼭짓점이 없어요.")
    for ring in rings:
        for p in ring:
            _check_lon_lat(list(p), field)
        if len(ring) < 4 or list(ring[0]) != list(ring[-1]):
            raise _invalid(field, "고리는 처음과 끝 점이 같고 꼭짓점이 3개 이상이어야 해요.")
        if len({tuple(p) for p in ring}) < 3:
            raise _invalid(field, "서로 다른 꼭짓점이 3개 이상이어야 해요.")
    poly = Polygon(rings[0], rings[1:])
    if not poly.is_valid:
        raise _invalid(field, f"도형이 올바르지 않아요({explain_validity(poly)}).")
    return f"SRID=4326;{poly.wkt}"


def linestring_ewkt(geojson: dict, field: str = "geometry") -> str:
    if not isinstance(geojson, dict) or geojson.get("type") != "LineString":
        raise _invalid(field, "LineString 도형이어야 해요.")
    coords = [list(p) for p in geojson.get("coordinates") or []]
    for p in coords:
        _check_lon_lat(p, field)
    if len({tuple(p) for p in coords}) < 2:
        raise _invalid(field, "서로 다른 점이 2개 이상이어야 해요.")
    return f"SRID=4326;{LineString(coords).wkt}"


def as_geojson(column: Any) -> Any:
    """SELECT용: geography 칸 → GeoJSON 문자열(좌표 소수 7자리 ≈ 1cm)."""
    return func.ST_AsGeoJSON(column, 7)


def parse_geojson(text: str | None) -> dict | None:
    return None if text is None else json.loads(text)


def lon_lat(geojson: dict) -> tuple[float, float]:
    lon, lat = geojson["coordinates"]
    return float(lon), float(lat)


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """두 (경도, 위도) 사이 대권 거리(m)."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def endpoints_match(line: dict, a: tuple[float, float], b: tuple[float, float], tolerance_m: float = 30.0) -> bool:
    """도보 경로 선의 양끝이 두 노드 근처인지(방향 무관)."""
    coords = shape(line).coords
    start, end = tuple(coords[0]), tuple(coords[-1])
    near = lambda p, q: haversine_m(p, q) <= tolerance_m  # noqa: E731
    return (near(start, a) and near(end, b)) or (near(start, b) and near(end, a))
