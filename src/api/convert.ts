// 서버(openapi.json) 값 ↔ 화면 값 공통 변환. 좌표·ID·목록 변환은 여기서만 한다.
import { ApiError, request } from '@/api/client';
import type { S } from '@/api/server';
import type { LatLngView, PolygonView } from '@/api/view/types';

// ---------- ID ----------
// 서버 ID는 정수(일부는 10진수 문자열). 화면은 모두 문자열로 쓰고, 서버로 보낼 때만 숫자로 바꾼다.

export const idView = (id: number | string) => String(id);
export const idServer = (id: string): number => {
  const n = Number(id);
  // 주소창의 옛 ID(예: case-031) 등: 없는 자원으로 본다
  if (!Number.isInteger(n) || n < 1)
    throw new ApiError(404, 'RESOURCE_NOT_FOUND', '사건을 찾을 수 없거나 접근 권한이 없습니다.');
  return n;
};
export const idViewOrNull = (id: number | string | null | undefined) =>
  id === null || id === undefined ? null : String(id);

// ---------- 좌표 (GeoJSON은 [경도, 위도]) ----------

type GeoPoint = S['GeoPoint'];
type GeoLineString = S['GeoLineString'];
type GeoPolygon = S['GeoPolygon'];
type AreaGeometry = S['AreaGeometry'];

const toLatLng = (p: number[]): LatLngView => ({ lat: p[1], lng: p[0] });
const toPosition = (p: LatLngView): [number, number] => [p.lng, p.lat];

export const pointView = (g: GeoPoint): LatLngView => toLatLng(g.coordinates);
export const pointServer = (p: LatLngView): GeoPoint => ({
  type: 'Point',
  coordinates: toPosition(p),
});

export const lineView = (g: GeoLineString | null | undefined): LatLngView[] =>
  g ? g.coordinates.map(toLatLng) : [];
export const lineServer = (path: LatLngView[]): GeoLineString => ({
  type: 'LineString',
  coordinates: path.map(toPosition),
});

/** Polygon/MultiPolygon → 다각형 목록(다각형 = 바깥 고리 + 구멍) */
export function areaView(g: AreaGeometry | GeoPolygon | null | undefined): PolygonView[] {
  if (!g) return [];
  const ring = (r: number[][]) => r.map(toLatLng);
  return g.type === 'Polygon'
    ? [g.coordinates.map(ring)]
    : g.coordinates.map((poly) => poly.map(ring));
}

/** 바깥 고리 하나 → 닫힌 GeoJSON Polygon */
export function polygonServer(ring: LatLngView[]): GeoPolygon {
  const coords = ring.map(toPosition);
  if (coords.length) coords.push([coords[0][0], coords[0][1]]);
  return { type: 'Polygon', coordinates: [coords] };
}

// ---------- 시간 ----------

export const secondsToMinutes = (s: number | null | undefined) =>
  s === null || s === undefined ? null : Math.round(s / 60);

// ---------- cursor 목록 ----------

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

/** 화면용 cursor 목록: 지금까지 받은 항목 + 다음 cursor */
export interface CursorPageView<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const cursorPageView = <A, B>(p: CursorPage<A>, map: (a: A) => B): CursorPageView<B> => ({
  items: p.items.map(map),
  nextCursor: p.next_cursor,
  hasMore: p.has_more,
});

/** 서버 목록 상한(limit 최대 100) */
export const PAGE_LIMIT = 100;

/**
 * 끝까지 받아 한 배열로(지도 카메라·위험 지역처럼 화면이 전부 그려야 하는 목록).
 * maxPages 안에 끝나지 않으면 일부만 그린 채 전체처럼 보이지 않도록 에러를 던진다.
 */
export async function fetchAll<T>(path: string, query: object = {}, maxPages = 50): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: CursorPage<T> = await request<CursorPage<T>>('GET', path, {
      query: { ...query, limit: PAGE_LIMIT, cursor },
    });
    items.push(...page.items);
    if (!page.has_more || !page.next_cursor) return items;
    cursor = page.next_cursor;
  }
  throw new ApiError(
    0,
    'LIST_TOO_LARGE',
    `목록이 너무 많아 다 불러오지 못했어요(${items.length}개 이상). 관리자에게 알려 주세요.`,
  );
}
