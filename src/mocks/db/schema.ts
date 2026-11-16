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
  Settings,
  WalkSpeedPreset,
  Retention,
} from '@/api/types';

/** 가짜 DB 구조. 바꾸면 DB_VERSION을 올려 저장된 데이터를 다시 만든다. */
export const DB_VERSION = 10;

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

export interface DbSession {
  token: string;
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

export interface DbState {
  version: number;
  /** 데이터를 초기화한 시각(epoch ms). 시나리오의 모든 시각은 이 값 기준 */
  r: number;
  users: DbUser[];
  sessions: DbSession[];
  cases: DbCase[];
  settings: Omit<Settings, 'updated_by'> & { updated_by: string };
  retention: Retention;
  audit_logs: DbAuditLog[];
  cameras: Camera[];
  danger_zones: DangerZone[];
  walk_edges: WalkEdge[];
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
}
