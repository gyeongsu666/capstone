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

// 백엔드 user_id는 정수. 가짜 DB는 문자열로 두고 응답할 때 숫자로 바꾼다.
export const USER_IDS = { admin: '1', user1: '2', user2: '3' } as const;
// 백엔드 case_id는 정수. 가짜 DB는 숫자 문자열로 둔다.
export const CASE_IDS = { main: '31', second: '32', closed: '29' } as const;

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
    // 숫자는 팀 논의 전 임시값(docs/mock-scenario.md)
    settings: {
      walking_speed_presets: [
        { person_type: 'adult', speed_mps: 1.2, max_speed_mps: 1.8 },
        { person_type: 'child', speed_mps: 1.0, max_speed_mps: 1.6 },
        { person_type: 'elderly', speed_mps: 0.8, max_speed_mps: 1.2 },
        { person_type: 'other', speed_mps: 1.0, max_speed_mps: 1.6 },
      ],
      default_similarity_threshold: 0.6,
      alert_high_threshold: 0.8,
      out_of_filter_threshold: 0.85,
      area_level_ratios: [0.5, 0.8, 1],
      area_buffer_m: 30,
      max_upload_bytes: 2_000_000_000,
      version: 1,
      updated_at: t(-7 * DAY),
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
    // 메인 사건: C3 확정 기준으로 이미 끝난 검색 하나(새로고침하면 latest_search로 복원)
    searches: [
      {
        id: '3a1f6c2e-0000-4000-8000-000000000031',
        case_id: CASE_IDS.main,
        anchor: 'cand-c3',
        anchor_decision_id: 'dec-4',
        direction: 'forward',
        task_id: 'scenario-done',
        created_at: t(-29),
        epoch: 0,
        query_version: 1,
        conditions_version: 1,
        case_version: 1,
        threshold: 0.6,
      },
    ],
    public_ids: { next: 1001, map: {} },
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
