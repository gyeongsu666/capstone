// 백엔드 서버 타입. src/api/generated/schema.d.ts는 openapi/openapi.json에서 생성한다(npm run gen:api).
// 백엔드에 추가를 요청한 값(docs/backend-api-final-requests.md R1~R7)은 생성 타입에 없으므로 여기서 덧붙인다.
// 요청이 반영된 openapi.json이 오면 다시 생성하고 아래 "요청" 덧붙임을 지운다.
import type { components } from '@/api/generated/schema';

export type S = components['schemas'];

export type ServerUser = S['User'];
export type ServerUserSummary = S['UserSummary'];
export type ServerRole = ServerUser['role'];
export type ErrorResponse = S['ErrorResponse'];
export type ErrorBody = S['ErrorBody'];
export type ServerLoginRequest = S['LoginRequest'];
export type ServerLoginResponse = S['LoginResponse'];
export type ServerPasswordChangeRequest = S['PasswordChangeRequest'];
export type ServerPasswordChangeResponse = S['PasswordChangeResponse'];
export type MessageResponse = S['MessageResponse'];

// ---------- 요청(R1~R7): 백엔드가 openapi.json에 반영하면 지운다 ----------

/** R4: GET /auth/me 응답. openapi.json은 User만 준다. */
export type ServerMeResponse = ServerLoginResponse;

/**
 * R1: 사건에 실종자 이름·나이, 장소 이름, 확정·대기 수
 * pending_count는 최신 검색이 done이고 stale이 아닐 때만 숫자, 그 밖에는 null(0과 구분)
 * R6: latest_search = 그 사건에서 가장 최근에 만든 검색(없으면 null)
 */
export interface CaseRequestedFields {
  person_name: string;
  person_age: number | null;
  last_seen_place_name: string | null;
  summary: { confirmed_count: number; pending_count: number | null };
  latest_search: S['SearchRun'] | null;
}
export type ServerCase = S['Case'] & CaseRequestedFields;
export interface ServerCasePage {
  items: ServerCase[];
  next_cursor: string | null;
  has_more: boolean;
}
export type ServerCaseCreateRequest = S['CaseCreateRequest'] & {
  person_name: string;
  person_age?: number | null;
  last_seen_place_name?: string | null;
};
export type ServerCasePatch = S['CasePatch'] & {
  person_name?: string;
  person_age?: number | null;
  last_seen_place_name?: string | null;
};

/** R2: GET /alerts/pending-count (진행 중 사건의 pending 알림, 1개 이상인 사건만) */
export interface ServerPendingCount {
  count: number;
  by_case: { case_id: number; count: number }[];
}

/** R7: GET /videos/stats (관리자, 전역 녹화 영상 전체 집계) */
export interface VideoStatusCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
}
export interface ServerVideoStats {
  total: number;
  by_status: VideoStatusCounts;
  by_camera: { camera_id: number; total: number; by_status: VideoStatusCounts }[];
  as_of: string;
}

/** R3: 번복 사유 선택 */
export type ServerDecisionReverseRequest = Omit<S['DecisionReverseRequest'], 'reason'> & {
  reason?: string;
};

/** R5: 범위 밖 후보 기준(초기값 null, PATCH에 null을 보내면 해제) */
export type ServerSystemSettings = S['SystemSettings'] & { out_of_filter_threshold: number | null };
export type ServerSystemSettingsPatch = S['SystemSettingsPatch'] & {
  out_of_filter_threshold?: number | null;
};
