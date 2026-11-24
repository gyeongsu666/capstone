import type {
  Camera,
  DangerZone,
  WalkEdge,
  Video,
  TaskType,
  Scene,
  CandidateStatus,
  DecisionKind,
  QueryImage,
  AlertStatus,
  WatchStatus,
  Reason,
  AuditAction,
  CaseStatus,
  CaseSummary,
  CloseReason,
  DateTime,
  MissingPerson,
  Place,
  Role,
  WalkSpeedPreset,
  Retention,
} from '@/api/types';
import type { ServerSystemSettings } from '@/api/server';

/** 가짜 DB 구조. 바꾸면 DB_VERSION을 올려 저장된 데이터를 다시 만든다. */
export const DB_VERSION = 14;

export interface DbUser {
  id: string;
  username: string;
  /** 가짜 서버라 평문. 실제 서버는 해시로 저장(SYS00-001). */
  password: string;
  name: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: DateTime;
}

/** 세션 쿠키 refind_session의 값(id)과 그 세션의 CSRF 토큰 */
export interface DbSession {
  id: string;
  csrf_token: string;
  user_id: string;
  /** epoch ms. 일정 시간 미사용 시 만료 */
  last_used_at: number;
}

export interface DbCase {
  id: string;
  case_no: string;
  status: CaseStatus;
  missing_person: MissingPerson;
  missing_at: DateTime;
  last_seen_place: Place;
  walk_speed_preset: WalkSpeedPreset;
  created_by: string;
  member_ids: string[];
  created_at: DateTime;
  closed_at: DateTime | null;
  close_reason: CloseReason | null;
  /** 후보·판단 데이터가 들어오는 7단계에서 계산값으로 바꾼다 */
  summary: CaseSummary;
  // ---- 백엔드 모양에만 있는 값(없으면 기본값) ----
  /** 사건 제목. 없으면 "{이름} 실종" */
  title?: string;
  /** walk_speed_preset 대신 쓰는 사람 유형(기타 포함) */
  person_type?: 'adult' | 'child' | 'elderly' | 'other';
  version?: number;
  close_note?: string | null;
  found_at?: string | null;
  /** 담당자로 추가된 시각(user_id → ISO) */
  assigned_at?: Record<string, string>;
  /** 검색을 낡게(stale) 만드는 변경(확정·번복)마다 1씩 오른다 */
  search_epoch?: number;
}

export interface DbAuditLog {
  id: string;
  at: DateTime;
  user_id: string;
  action: AuditAction;
  case_id: string | null;
  detail: string;
}

/** 작업 완료 때 가짜 DB에 반영할 일(직렬화 가능한 값만) */
export type DbTaskEffect =
  | { kind: 'video_done'; video_id: string; camera_id: string }
  | { kind: 'image_ready'; case_id: string; image_id: string }
  /** fake_count: 끝날 때 만들 가짜 새 후보 수(시연용) */
  | { kind: 'search_done'; case_id: string; fake_count?: number }
  | { kind: 'area_done'; case_id: string }
  | { kind: 'none' };

export interface DbTask {
  task_id: string;
  type: TaskType;
  /** epoch ms */
  started_at: number;
  /** 단계 간격(ms). progress 0 → 40 → 80 → 100 */
  step_ms: number;
  /** 정해 두면 이 진행률에서 실패 */
  fail_at: number | null;
  error: string | null;
  result: Record<string, unknown> | null;
  effect: DbTaskEffect;
  /** effect를 이미 반영했는지 */
  settled: boolean;
}

/** 기준점(직전 확정 후보 id, 처음이면 "start")별 유사도·근거 */
export interface DbCandidateVariant {
  similarity: number;
  reasons: Reason[];
  out_of_filter: boolean;
  travel_minutes: number | null;
  expected_minutes: number | null;
}

export interface DbCandidate {
  id: string;
  case_id: string;
  scene_id: string;
  status: CandidateStatus;
  /** 이 기준점일 때 대기열에 나온다 */
  variants: Record<string, DbCandidateVariant>;
  /** "아니오"·"보류" 번복으로 대기열에 돌아온 후보(기준점과 상관없이 보인다) */
  pinned: boolean;
}

export interface DbDecision {
  id: string;
  case_id: string;
  candidate_id: string;
  kind: DecisionKind;
  target_decision_id: string | null;
  reverted: boolean;
  decided_by: string;
  decided_at: DateTime;
  /** 번복 기록(REVERT)의 사유 */
  reason?: string | null;
  /** 판단 버전(번복할 때 expected_version) */
  version?: number;
  /** 이 판단을 만든 검색 */
  search_id?: string | null;
}

/** 후보 검색 실행(search_id 단위). 결과는 기준점(anchor)으로 계산한다 */
export interface DbSearch {
  id: string;
  case_id: string;
  /** 기준 후보 id, 처음이면 "start" */
  anchor: string;
  anchor_decision_id: string | null;
  direction: 'forward' | 'backward';
  task_id: string;
  created_at: string;
  /** 만들 때의 값. 지금 값과 다르면 stale */
  epoch: number;
  query_version: number;
  conditions_version: number;
  case_version: number;
  threshold: number;
}

export interface DbQuery {
  images: QueryImage[];
  time_from: DateTime;
  time_to: DateTime | null;
  threshold: number;
  /** 후보 검색을 한 번이라도 했는지 */
  searched: boolean;
  /** 진행 중인 후보 검색 작업 */
  search_task_id: string | null;
  query_version?: number;
  conditions_version?: number;
  /** 트랙렛을 기준 대상으로 골랐으면 그 장면 id */
  tracklet_scene_id?: string | null;
}

/** 실시간 감시 */
export interface DbWatch {
  status: WatchStatus;
  started_at: DateTime | null;
  started_by: string | null;
  /** 이 시각(epoch ms)이 지나면 출현 알림을 만든다(시나리오: 감시 시작 60초 뒤) */
  alert_due_at: number | null;
}

export interface DbAlert {
  id: string;
  case_id: string;
  scene_id: string;
  similarity: number;
  status: AlertStatus;
  created_at: DateTime;
  responded_by: string | null;
}

/** 위험 지역(백엔드 kind·severity). area는 GeoJSON Polygon */
export interface DbDangerZone {
  id: string;
  name: string;
  kind: 'water' | 'steep_slope' | 'road' | 'construction' | 'other';
  severity: 'low' | 'medium' | 'high';
  description: string;
  area: DangerZone['area'];
  version: number;
}

export interface DbState {
  version: number;
  /** 데이터를 초기화한 시각(epoch ms). 시나리오의 모든 시각은 이 값 기준 */
  r: number;
  users: DbUser[];
  sessions: DbSession[];
  cases: DbCase[];
  /** 백엔드 SystemSettings 모양 그대로(+ R5 out_of_filter_threshold) */
  settings: ServerSystemSettings;
  retention: Retention;
  audit_logs: DbAuditLog[];
  cameras: (Camera & { version?: number })[];
  danger_zones: DbDangerZone[];
  walk_edges: (WalkEdge & { version?: number })[];
  videos: Video[];
  tasks: DbTask[];
  scenes: Scene[];
  candidates: DbCandidate[];
  decisions: DbDecision[];
  queries: Record<string, DbQuery>;
  /** 사건별 현재 위치 범위 계산 시각(epoch ms) */
  search_area_at: Record<string, number>;
  watches: Record<string, DbWatch>;
  alerts: DbAlert[];
  searches: DbSearch[];
  /** 문자열 내부 id → 서버 모양의 숫자 id(트랙렛·판단·영상 등). 한 번 정하면 바뀌지 않는다 */
  public_ids: { next: number; map: Record<string, string> };
}
