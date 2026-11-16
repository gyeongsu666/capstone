import type { LatLngView } from '@/api/view';
import { offset } from '@/map/geo';

export type ZoneShape = 'polygon' | 'circle';

export interface ZoneDraft {
  shape: ZoneShape;
  /** 다각형 꼭짓점 */
  points: LatLngView[];
  /** 원 중심과 반지름(m) */
  center: LatLngView | null;
  radiusM: number;
}

export const emptyDraft = (): ZoneDraft => ({
  shape: 'polygon',
  points: [],
  center: null,
  radiusM: 80,
});

/** 그리는 중인 위험 지역 → 다각형 꼭짓점(원은 24각형으로 바꾼다) */
export function draftToPolygon(d: ZoneDraft | null): LatLngView[] {
  if (!d) return [];
  if (d.shape === 'polygon') return d.points;
  if (!d.center) return [];
  return Array.from({ length: 24 }, (_, i) => offset(d.center!, (360 / 24) * i, d.radiusM));
}
