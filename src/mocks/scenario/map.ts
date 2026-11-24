// 가짜 지도 데이터: 국립목포대학교 도림캠퍼스(무안군 청계면) 실제 건물 앞에 카메라를 둔다.
// 건물 좌표는 카카오 장소 검색 결과(2026-11-16). 카메라 방향·화각·도보 구간은 임시값이다.
import type { Camera, LatLng, WalkEdge } from '@/mocks/db/legacyTypes';
import type { DbDangerZone } from '@/mocks/db/schema';
import { offset } from '@/map/geo';
import { crossArea, distanceM, toPolygon } from '@/mocks/scenario/geometry';

/** 지도 중심: 국립목포대학교 도림캠퍼스 */
export const MAP_CENTER = { lat: 34.9103, lng: 126.4378 };

/** 도림제(저수지) 북쪽 둘레길 입구(우선 수색 구역) */
export const RESERVOIR_ENTRANCE: LatLng = { lat: 34.9061, lng: 126.4349 };

interface CameraSeed {
  code: string;
  name: string;
  pos: LatLng;
  /** 촬영 방향(북=0, 시계 방향) */
  dir: number;
  fov: number;
}

/** 실제 동선 C1 → C2 → C3 → C4 → C6 (정문 쪽에서 북쪽 공대로) */
const FIXED: CameraSeed[] = [
  { code: 'C1', name: '대학본부 앞', pos: { lat: 34.90853, lng: 126.43424 }, dir: 70, fov: 90 },
  { code: 'C2', name: '도서관 앞', pos: { lat: 34.90894, lng: 126.43549 }, dir: 20, fov: 80 },
  { code: 'C3', name: '학생회관 앞', pos: { lat: 34.90987, lng: 126.43574 }, dir: 75, fov: 100 },
  { code: 'C4', name: '자연과학대학 앞', pos: { lat: 34.91019, lng: 126.43718 }, dir: 15, fov: 70 },
  { code: 'C5', name: '체육관 앞', pos: { lat: 34.90697, lng: 126.43381 }, dir: 0, fov: 90 },
  { code: 'C6', name: '공과대학 앞', pos: { lat: 34.91276, lng: 126.43798 }, dir: 180, fov: 80 },
  {
    code: 'C7',
    name: '사회과학대학 앞',
    pos: { lat: 34.90818, lng: 126.43612 },
    dir: 300,
    fov: 60,
  },
  { code: 'C8', name: '대외협력관 앞', pos: { lat: 34.9142, lng: 126.43827 }, dir: 190, fov: 110 },
  { code: 'C9', name: '고시생활관 앞', pos: { lat: 34.90746, lng: 126.43585 }, dir: 340, fov: 75 },
  { code: 'C10', name: '인문대학 앞', pos: { lat: 34.91097, lng: 126.43531 }, dir: 120, fov: 90 },
  {
    code: 'C11',
    name: '창업보육센터 앞',
    pos: { lat: 34.91358, lng: 126.44082 },
    dir: 230,
    fov: 100,
  },
  { code: 'C12', name: '한울관 앞', pos: { lat: 34.9103, lng: 126.44087 }, dir: 270, fov: 65 },
];

// 백엔드 node_id·camera_id는 정수. 가짜 DB는 숫자 문자열로 둔다(C3 → '3', 사건 영상 카메라 P1 → '101').
export const cameraId = (code: string) => String(Number(code.replace(/^[A-Z]+/, '')));
export const CASE_CAMERA_ID = '101';

export function createCameras(mainCaseId: string): Camera[] {
  const fixed: Camera[] = FIXED.map((c) => ({
    id: cameraId(c.code),
    code: c.code,
    name: c.name,
    location: c.pos,
    direction_deg: c.dir,
    fov_deg: c.fov,
    source: 'FIXED',
    case_id: null,
    // 영상 수·분석 여부는 영상 표에서 계산한다(C12는 영상 없음 → 분석 전 회색)
    video_count: 0,
    analyzed: false,
  }));
  return [
    ...fixed,
    {
      id: CASE_CAMERA_ID,
      code: 'P1',
      name: 'MNU라운지 앞(편의점 블랙박스)',
      location: { lat: 34.91003, lng: 126.43936 },
      direction_deg: 270,
      fov_deg: 90,
      source: 'CASE',
      case_id: mainCaseId,
      video_count: 1,
      analyzed: true,
    },
  ];
}

export const cameraPos = (code: string) => {
  const c = FIXED.find((f) => f.code === code);
  if (!c) throw new Error(`unknown camera ${code}`);
  return c.pos;
};

/** 위험 지역: 캠퍼스 남쪽 도림제(저수지) 둘레 */
export function createDangerZones(): DbDangerZone[] {
  const center = { lat: 34.90453, lng: 126.43489 };
  return [
    {
      id: '1',
      name: '도림제(저수지)',
      kind: 'water',
      severity: 'high',
      description: '캠퍼스 남쪽 저수지. 둘레 산책로와 바로 붙어 있다.',
      version: 1,
      area: toPolygon(
        Array.from({ length: 10 }, (_, i) => offset(center, i * 36, i % 2 === 0 ? 190 : 150)),
      ),
    },
  ];
}

/** 이웃한 카메라끼리 도보 구간 (20개) */
const EDGE_PAIRS: [string, string][] = [
  ['C1', 'C2'],
  ['C1', 'C5'],
  ['C1', 'C10'],
  ['C2', 'C3'],
  ['C2', 'C4'],
  ['C2', 'C7'],
  ['C2', 'C9'],
  ['C3', 'C4'],
  ['C3', 'C7'],
  ['C3', 'C10'],
  ['C4', 'C6'],
  ['C4', 'C7'],
  ['C4', 'C12'],
  ['C5', 'C9'],
  ['C6', 'C8'],
  ['C6', 'C10'],
  ['C6', 'C11'],
  ['C7', 'C9'],
  ['C8', 'C11'],
  ['C11', 'C12'],
];

const WALK_MPS = 1.2;
/** 직선거리 → 걸어서 가는 거리(건물을 돌아가는 몫) */
const DETOUR_FACTOR = 1.3;

export function createWalkEdges(): WalkEdge[] {
  return EDGE_PAIRS.map(([a, b], i) => {
    const from = cameraPos(a);
    const to = cameraPos(b);
    let path: LatLng[] = [from, to];
    let distance = distanceM(from, to) * DETOUR_FACTOR;
    let minutes = Math.max(1, Math.round(distance / WALK_MPS / 60));
    let corrected: { m: number; min: number } | null = null;
    let detour = false;

    if (a === 'C1' && b === 'C5') {
      // 지도에 없는 샛길 가능성: 도보 API는 70주년기념관 쪽으로 크게 돌아감
      path = [from, { lat: 34.9081, lng: 126.4325 }, { lat: 34.9069, lng: 126.4322 }, to];
      distance = 820;
      minutes = 11;
      corrected = { m: 300, min: 4 };
      detour = true;
    } else if (a === 'C2' && b === 'C4') {
      // 도보 API가 고시생활관 쪽으로 돌아감(보정 없음)
      path = [from, { lat: 34.9078, lng: 126.4367 }, { lat: 34.9088, lng: 126.4385 }, to];
      distance = 1200;
      minutes = 16;
    }

    return {
      id: String(i + 1),
      from_camera_id: cameraId(a),
      to_camera_id: cameraId(b),
      api_distance_m: Math.round(distance),
      api_minutes: minutes,
      corrected_distance_m: corrected?.m ?? null,
      corrected_minutes: corrected?.min ?? null,
      detour_suspected: detour,
      path,
    };
  });
}

/** 확정 장면 카메라를 이은 경로 */
export const routePathFor = (codes: string[]) => codes.map(cameraPos);

/** 마지막 목격 카메라 기준 현재 위치 범위 3단계(길을 따라 퍼진 십자 모양, 동심원 아님) */
export function searchAreaLevels(baseCode: string) {
  return searchAreaLevelsAt(cameraPos(baseCode));
}

/** 기준 위치(마지막 목격) 둘레 현재 위치 범위 3단계 */
export function searchAreaLevelsAt(c: LatLng) {
  const hw = 0.00014;
  return {
    HIGH: crossArea(c, { n: 0.0007, e: 0.0009, s: 0.0007, w: 0.0009 }, hw * 1.6),
    MID: crossArea(c, { n: 0.0015, e: 0.0019, s: 0.0015, w: 0.0018 }, hw * 1.3),
    // 남쪽 팔이 도림제(저수지) 위험 지역에 닿는다(danger_overlaps 확인용)
    LOW: crossArea(c, { n: 0.003, e: 0.0042, s: 0.0055, w: 0.0035 }, hw),
  };
}
