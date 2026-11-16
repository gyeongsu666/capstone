// 초기 데이터: docs/mock-scenario.md
// 구체 값(좌표, 비밀번호, 시각 오프셋)은 구현용 임시값이며 팀 결정이 아니다.
import { atR } from '@/mocks/db/time';
import { DB_VERSION, type DbState } from '@/mocks/db/schema';
import { createMainTracking, createQuery } from '@/mocks/scenario/tracking';
import { createAuditLogs, createVideos } from '@/mocks/scenario/admin';
import {
  CASE_CAMERA_ID,
  createCameras,
  createDangerZones,
  createWalkEdges,
} from '@/mocks/scenario/map';

export const USER_IDS = { admin: 'u-admin', user1: 'u-user1', user2: 'u-user2' } as const;
export const CASE_IDS = { main: 'case-031', second: 'case-032', closed: 'case-029' } as const;

/** 지도 중심(국립목포대학교 도림캠퍼스) */
export { MAP_CENTER } from '@/mocks/scenario/map';

export const SCENARIO_PASSWORD = 'test1234';

export function createScenario(r: number = Date.now()): DbState {
  const t = (minutes: number) => atR(r, minutes);
  const DAY = 24 * 60;
  const main = createMainTracking(r, CASE_IDS.main, {
    user1: USER_IDS.user1,
    user2: USER_IDS.user2,
  });

  return {
    version: DB_VERSION,
    r,
    users: [
      {
        id: USER_IDS.admin,
        username: 'admin',
        password: SCENARIO_PASSWORD,
        name: '관리자',
        role: 'ADMIN',
        active: true,
        must_change_password: false,
        created_at: t(-90 * DAY),
      },
      {
        id: USER_IDS.user1,
        username: 'user1',
        password: SCENARIO_PASSWORD,
        name: '김수색',
        role: 'USER',
        active: true,
        must_change_password: false,
        created_at: t(-60 * DAY),
      },
      {
        id: USER_IDS.user2,
        username: 'user2',
        password: SCENARIO_PASSWORD,
        name: '이수색',
        role: 'USER',
        active: true,
        must_change_password: true,
        created_at: t(-2 * DAY),
      },
    ],
    sessions: [],
    cases: [
      {
        id: CASE_IDS.main,
        case_no: '2026-031',
        status: 'OPEN',
        missing_person: { name: '김OO', age: 9, description: '빨간 상의, 남색 바지' },
        missing_at: t(-80),
        last_seen_place: {
          name: '도림캠퍼스 정문',
          location: { lat: 34.90858, lng: 126.4344 },
        },
        walk_speed_preset: 'CHILD',
        created_by: USER_IDS.user1,
        member_ids: [USER_IDS.user1, USER_IDS.user2],
        created_at: t(-75),
        closed_at: null,
        close_reason: null,
        summary: {
          confirmed_count: 3,
          pending_count: 5,
          last_seen_at: t(-38),
          last_seen_camera_code: 'C3',
        },
      },
      {
        id: CASE_IDS.second,
        case_no: '2026-032',
        status: 'OPEN',
        missing_person: { name: '이OO', age: 78, description: '회색 점퍼' },
        missing_at: t(-150),
        last_seen_place: {
          name: '70주년기념관 앞',
          location: { lat: 34.90775, lng: 126.43361 },
        },
        walk_speed_preset: 'ELDERLY',
        created_by: USER_IDS.user1,
        member_ids: [USER_IDS.user1],
        created_at: t(-140),
        closed_at: null,
        close_reason: null,
        summary: {
          confirmed_count: 0,
          pending_count: 0,
          last_seen_at: null,
          last_seen_camera_code: null,
        },
      },
      {
        id: CASE_IDS.closed,
        case_no: '2026-029',
        status: 'CLOSED',
        missing_person: { name: '박OO', age: 15, description: '흰 티셔츠' },
        missing_at: t(-5 * DAY),
        last_seen_place: {
          name: '사범대학 앞',
          location: { lat: 34.91138, lng: 126.43584 },
        },
        // 문서에 값이 없어 임시로 ADULT
        walk_speed_preset: 'ADULT',
        created_by: USER_IDS.user2,
        member_ids: [USER_IDS.user2],
        created_at: t(-5 * DAY + 20),
        closed_at: t(-4 * DAY),
        close_reason: 'FOUND',
        summary: {
          confirmed_count: 4,
          pending_count: 0,
          last_seen_at: t(-5 * DAY + 95),
          last_seen_camera_code: 'C9',
        },
      },
    ],
    settings: {
      walk_speed_mps: { ADULT: 1.4, CHILD: 1.1, ELDERLY: 0.9 },
      similarity_threshold_default: 0.6,
      confirm_request_threshold: 0.75,
      filter_margin_minutes: 3,
      out_of_filter_threshold: 0.85,
      area_level_bounds: { high: 0.5, mid: 0.8 },
      updated_at: t(-7 * DAY),
      updated_by: USER_IDS.admin,
    },
    retention: { closed_case_days: 30, raw_video_days: 90 },
    audit_logs: createAuditLogs(r, USER_IDS, CASE_IDS),
    cameras: createCameras(CASE_IDS.main),
    danger_zones: createDangerZones(),
    walk_edges: createWalkEdges(),
    videos: [
      ...createVideos(r),
      {
        id: 'video-case-031-1',
        camera_id: CASE_CAMERA_ID,
        camera_code: 'P1',
        file_name: '편의점_블랙박스_1019.mp4',
        recorded_at: t(-60),
        duration_sec: 1800,
        status: 'DONE',
        progress: 100,
        error_message: null,
        task_id: null,
        case_id: CASE_IDS.main,
        uploaded_at: t(-50),
      },
    ],
    tasks: [],
    scenes: main.scenes,
    candidates: main.candidates,
    decisions: main.decisions,
    search_area_at: {},
    watches: {},
    alerts: [],
    queries: {
      [CASE_IDS.main]: createQuery(
        t(-80),
        0.6,
        { id: 'qimg-031-1', url: '/mock/thumbnails/query-red.svg' },
        true,
      ),
      // 기준 사진 1장만 등록, 검색 전 → 빈 화면 안내
      [CASE_IDS.second]: createQuery(
        t(-150),
        0.6,
        { id: 'qimg-032-1', url: '/mock/thumbnails/query-gray.svg' },
        false,
      ),
      [CASE_IDS.closed]: createQuery(
        t(-5 * DAY),
        0.6,
        { id: 'qimg-029-1', url: '/mock/thumbnails/person-white.svg' },
        true,
      ),
    },
  };
}
