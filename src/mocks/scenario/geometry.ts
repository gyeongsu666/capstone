// 가짜 지도 데이터용 좌표 계산. 실제 서버는 도로망으로 계산한다.
import type { GeoJSONPolygon, LatLng } from '@/api/types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** 두 점 사이 거리(m) */
export function distanceM(a: LatLng, b: LatLng) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const pathLengthM = (path: LatLng[]) =>
  path.slice(1).reduce((sum, p, i) => sum + distanceM(path[i], p), 0);

/** 격자 도로를 따라 a → b (가로 먼저, 그다음 세로) */
export function streetPath(a: LatLng, b: LatLng, verticalFirst = false): LatLng[] {
  if (a.lat === b.lat || a.lng === b.lng) return [a, b];
  const corner = verticalFirst ? { lat: b.lat, lng: a.lng } : { lat: a.lat, lng: b.lng };
  return [a, corner, b];
}

/** 여러 지점을 격자 도로로 이은 경로 */
export function streetRoute(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  points.forEach((p, i) => {
    if (i === 0) {
      out.push(p);
      return;
    }
    out.push(...streetPath(points[i - 1], p).slice(1));
  });
  return out;
}

/** LatLng 고리 → GeoJSON Polygon([lng, lat]) */
export function toPolygon(ring: LatLng[]): GeoJSONPolygon {
  const coords = ring.map((p) => [p.lng, p.lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
  return { type: 'Polygon', coordinates: [coords] };
}

/**
 * 기준점에서 길(가로·세로 도로)을 따라 퍼진 십자 모양 영역. 동심원 대신 쓴다.
 * arms: 각 방향으로 뻗는 길이(도 단위), halfWidth: 도로 폭의 절반(도 단위)
 */
export function crossArea(
  c: LatLng,
  arms: { n: number; e: number; s: number; w: number },
  halfWidth: number,
): GeoJSONPolygon {
  const hw = halfWidth;
  const ring: LatLng[] = [
    { lat: c.lat + arms.n, lng: c.lng - hw },
    { lat: c.lat + arms.n, lng: c.lng + hw },
    { lat: c.lat + hw, lng: c.lng + hw },
    { lat: c.lat + hw, lng: c.lng + arms.e },
    { lat: c.lat - hw, lng: c.lng + arms.e },
    { lat: c.lat - hw, lng: c.lng + hw },
    { lat: c.lat - arms.s, lng: c.lng + hw },
    { lat: c.lat - arms.s, lng: c.lng - hw },
    { lat: c.lat - hw, lng: c.lng - hw },
    { lat: c.lat - hw, lng: c.lng - arms.w },
    { lat: c.lat + hw, lng: c.lng - arms.w },
    { lat: c.lat + hw, lng: c.lng - hw },
  ];
  return toPolygon(ring);
}
