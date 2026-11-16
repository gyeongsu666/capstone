import type { LatLngView } from '@/api/view';

const M_PER_DEG_LAT = 111_320;

/** 기준점에서 방위각(북=0, 시계 방향)으로 meters만큼 떨어진 점 */
export function offset(p: LatLngView, bearingDeg: number, meters: number): LatLngView {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    lat: p.lat + (Math.cos(b) * meters) / M_PER_DEG_LAT,
    lng: p.lng + (Math.sin(b) * meters) / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
  };
}

/** 촬영 방향 부채꼴 */
export function sector(p: LatLngView, directionDeg: number, fovDeg: number, radiusM = 55) {
  const steps = 12;
  const start = directionDeg - fovDeg / 2;
  const pts: LatLngView[] = [p];
  for (let i = 0; i <= steps; i++) pts.push(offset(p, start + (fovDeg * i) / steps, radiusM));
  pts.push(p);
  return pts;
}

/** 선의 가운데 점(길이 기준이 아니라 꼭짓점 기준 근사) */
export function midpoint(path: LatLngView[]): LatLngView {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length % 2 === 1) return path[(path.length - 1) / 2];
  const a = path[path.length / 2 - 1];
  const b = path[path.length / 2];
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
