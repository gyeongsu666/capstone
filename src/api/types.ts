// 임시 타입: docs/api-spec.md와 같은 이름·같은 snake_case 필드.
// 백엔드 /openapi.json이 나오면 openapi-typescript로 생성한 타입으로 바꾼다.

/** ISO 8601 + 한국 시간. 예: "2026-10-19T15:02:00+09:00" */
export type DateTime = string;

// ---------- 상태값 ----------

export type Role = 'ADMIN' | 'USER';
export type CaseStatus = 'OPEN' | 'CLOSED';
export type CloseReason = 'FOUND' | 'SEARCH_STOPPED' | 'OTHER';
export type WalkSpeedPreset = 'ADULT' | 'CHILD' | 'ELDERLY';
export type TaskStatus = 'PENDING' | 'PROGRESS' | 'SUCCESS' | 'FAILURE';
export type TaskType =
  | 'VIDEO_ANALYSIS'
  | 'WALK_ROUTE_CALC'
  | 'QUERY_EMBEDDING'
  | 'CANDIDATE_SEARCH'
  | 'SEARCH_AREA_CALC';
export type VideoStatus = 'WAITING' | 'PROCESSING' | 'DONE' | 'FAILED';
export type CameraSource = 'FIXED' | 'CASE';
export type TargetType = 'MISSING' | 'CRIMINAL';
export type CandidateStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'HELD' | 'NEEDS_RECHECK';
export type DecisionKind = 'YES' | 'NO' | 'HOLD' | 'REVERT';
export type ReasonKind =
  'ROUTE_OK' | 'TIME_SHORT' | 'DIRECTION_MISMATCH' | 'OUT_OF_FILTER' | 'LOW_QUALITY' | 'OVERLAP';
export type AreaLevel = 'HIGH' | 'MID' | 'LOW';
export type WatchStatus = 'ON' | 'OFF';
export type AlertStatus = 'NEW' | 'CONFIRMED' | 'DISMISSED';
export type QueryImageSource = 'UPLOAD' | 'SCENE';
export type AuditAction =
  | 'LOGIN'
  | 'SEARCH'
  | 'DECISION'
  | 'REVERT'
  | 'VIDEO_VIEW'
  | 'VIDEO_UPLOAD'
  | 'CASE_CREATE'
  | 'CASE_CLOSE'
  | 'ACCOUNT_CHANGE'
  | 'SETTINGS_CHANGE'
  | 'DATA_DELETE';

// ---------- 공통 ----------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  /** [lng, lat] 순서 (GeoJSON 규칙) */
  coordinates: number[][][];
}
export interface GeoJSONMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}
export type GeoJSONArea = GeoJSONPolygon | GeoJSONMultiPolygon;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface PageParams {
  page?: number;
  size?: number;
}

/** 에러 응답 (422 제외) */
export interface ErrorBody {
  detail: string;
  code: string;
}

export interface TaskAccepted {
  task_id: string;
}

// ---------- 공통 데이터 모델 ----------

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: DateTime;
}

export interface UserBrief {
  id: string;
  name: string;
}

export interface MissingPerson {
  name: string;
  age: number;
  description: string;
}

export interface Place {
  name: string;
  location: LatLng;
}

export interface CaseSummary {
  confirmed_count: number;
  pending_count: number;
  last_seen_at: DateTime | null;
  last_seen_camera_code: string | null;
}

export interface Case {
  id: string;
  case_no: string;
  status: CaseStatus;
  missing_person: MissingPerson;
  missing_at: DateTime;
  last_seen_place: Place;
  walk_speed_preset: WalkSpeedPreset;
  created_by: UserBrief;
  members: UserBrief[];
  created_at: DateTime;
  closed_at: DateTime | null;
  close_reason: CloseReason | null;
  summary: CaseSummary;
}

export interface Camera {
  id: string;
  code: string;
  name: string;
  location: LatLng;
  direction_deg: number;
  fov_deg: number;
  source: CameraSource;
  case_id: string | null;
  video_count: number;
  analyzed: boolean;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scene {
  id: string;
  camera_id: string;
  camera_code: string;
  video_id: string;
  start_at: DateTime;
  end_at: DateTime;
  start_sec: number;
  end_sec: number;
  thumbnail_url: string;
  highlight_url: string;
  video_url: string;
  bbox: BBox | null;
}

export interface Reason {
  kind: ReasonKind;
  text: string;
}

export interface Candidate {
  id: string;
  scene: Scene;
  similarity: number;
  status: CandidateStatus;
  below_threshold: boolean;
  out_of_filter: boolean;
  reasons: Reason[];
  travel_minutes: number | null;
  expected_minutes: number | null;
}

export interface Decision {
  id: string;
  candidate_id: string;
  scene: { camera_code: string; start_at: DateTime; thumbnail_url: string };
  kind: DecisionKind;
  target_decision_id: string | null;
  reverted: boolean;
  decided_by: UserBrief;
  decided_at: DateTime;
}

export interface Task {
  task_id: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
}

// ---------- 인증·계정 ----------

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: User;
}

export interface PasswordChangeRequest {
  current_password: string;
  new_password: string;
}

export interface UserListParams extends PageParams {
  role?: Role;
  active?: boolean;
  q?: string;
}

export interface UserCreateRequest {
  username: string;
  name: string;
  role: Role;
}

export interface UserCreateResponse {
  user: User;
  temp_password: string;
}

export interface UserUpdateRequest {
  name?: string;
  role?: Role;
  active?: boolean;
}

export interface ResetPasswordResponse {
  temp_password: string;
}

// ---------- 사건 ----------

export interface CaseListParams extends PageParams {
  status?: CaseStatus;
  q?: string;
}

export interface CaseCreateRequest {
  missing_person: MissingPerson;
  missing_at: DateTime;
  last_seen_place: Place;
  walk_speed_preset: WalkSpeedPreset;
  member_ids?: string[];
}

export interface CaseUpdateRequest {
  missing_person?: MissingPerson;
  missing_at?: DateTime;
  last_seen_place?: Place;
  walk_speed_preset?: WalkSpeedPreset;
}

export interface CaseCloseRequest {
  reason: CloseReason;
  note?: string;
}

export interface CaseMembersRequest {
  member_ids: string[];
}

// ---------- 검색 조건·후보 ----------

export interface QueryImage {
  id: string;
  image_url: string;
  source: QueryImageSource;
  ready: boolean;
}

export interface SearchQuery {
  images: QueryImage[];
  time_from: DateTime;
  time_to: DateTime | null;
  threshold: number;
  threshold_default: number;
}

export interface SearchQueryUpdateRequest {
  threshold?: number;
  time_from?: DateTime;
  time_to?: DateTime | null;
}

export interface QueryImageAccepted {
  task_id: string;
  image: QueryImage;
}

export interface SceneListParams extends PageParams {
  camera_id: string;
  from?: DateTime;
  to?: DateTime;
}

export interface SearchRequest {
  anchor_candidate_id?: string | null;
}

export interface CandidateListParams extends PageParams {
  status?: CandidateStatus;
  include_below_threshold?: boolean;
}

export interface CandidatePage extends Page<Candidate> {
  below_threshold_count: number;
}

// ---------- 판단·동선 ----------

export interface DecisionRequest {
  candidate_id: string;
  kind: 'YES' | 'NO' | 'HOLD';
}

export interface DecisionResponse {
  decision: Decision;
  candidate: Candidate;
  task_id: string | null;
}

export interface RevertResponse {
  revert: Decision;
  affected: { candidate_id: string; status: CandidateStatus }[];
  task_id: string | null;
}

export interface RouteScene {
  order: number;
  candidate_id: string;
  scene: Scene;
  status: 'CONFIRMED' | 'NEEDS_RECHECK';
  confirmed_by: UserBrief;
  confirmed_at: DateTime;
}

export interface RouteResponse {
  scenes: RouteScene[];
  path: LatLng[];
  pending: Candidate | null;
}

export interface TrackPoint extends BBox {
  t: number;
}

export interface SceneDetail {
  scene: Scene;
  track: TrackPoint[];
}

// ---------- 현재 위치·실시간 감시 ----------

export interface SearchArea {
  computed_at: DateTime;
  base_scene: Scene;
  elapsed_minutes: number;
  levels: { level: AreaLevel; area: GeoJSONArea }[];
  danger_overlaps: { zone_id: string; name: string; level: AreaLevel }[];
  priority_zones: { rank: number; name: string; area: GeoJSONArea; reason: string }[];
}

export interface WatchState {
  status: WatchStatus;
  started_at: DateTime | null;
  started_by: UserBrief | null;
  camera_count: number;
}

export interface WatchUpdateRequest {
  status: WatchStatus;
}

export interface Alert {
  id: string;
  scene: Scene;
  similarity: number;
  status: AlertStatus;
  created_at: DateTime;
  responded_by: UserBrief | null;
}

export interface AlertListParams {
  since?: DateTime;
  status?: AlertStatus;
}

export interface UnreadCount {
  count: number;
  by_case: { case_id: string; count: number }[];
}

export interface AlertResponseRequest {
  kind: 'YES' | 'NO';
}

export interface AlertResponseResult {
  alert: Alert;
  decision: Decision | null;
  task_id: string | null;
}

// ---------- 영상 ----------

export interface Video {
  id: string;
  camera_id: string;
  camera_code: string;
  file_name: string;
  recorded_at: DateTime;
  duration_sec: number | null;
  status: VideoStatus;
  progress: number;
  error_message: string | null;
  task_id: string | null;
  case_id: string | null;
  uploaded_at: DateTime;
}

export interface CaseVideo {
  video: Video;
  camera: Camera;
}

export interface CaseVideoAccepted {
  video: Video;
  camera: Camera;
  task_id: string;
}

export interface VideoListParams extends PageParams {
  status?: VideoStatus;
  camera_id?: string;
}

export interface VideoPage extends Page<Video> {
  summary: { waiting: number; processing: number; done: number; failed: number };
}

export interface VideoAccepted {
  video: Video;
  task_id: string;
}

// ---------- 카메라·도보 경로·위험 지역 ----------

export interface CameraCreateRequest {
  code: string;
  name: string;
  location: LatLng;
  direction_deg: number;
  fov_deg: number;
}

export type CameraUpdateRequest = Partial<CameraCreateRequest>;

export interface WalkEdge {
  id: string;
  from_camera_id: string;
  to_camera_id: string;
  api_distance_m: number;
  api_minutes: number;
  corrected_distance_m: number | null;
  corrected_minutes: number | null;
  detour_suspected: boolean;
  path: LatLng[];
}

export interface WalkEdgeUpdateRequest {
  corrected_distance_m?: number | null;
  corrected_minutes?: number | null;
}

export interface DangerZone {
  id: string;
  name: string;
  target_type: TargetType;
  area: GeoJSONArea;
}

export interface DangerZoneCreateRequest {
  name: string;
  target_type: TargetType;
  area: GeoJSONArea;
}

export type DangerZoneUpdateRequest = Partial<DangerZoneCreateRequest>;

// ---------- 설정·이용 기록·보관 ----------

export interface Settings {
  walk_speed_mps: Record<WalkSpeedPreset, number>;
  similarity_threshold_default: number;
  confirm_request_threshold: number;
  filter_margin_minutes: number;
  out_of_filter_threshold: number;
  area_level_bounds: { high: number; mid: number };
  updated_at: DateTime;
  updated_by: UserBrief;
}

export type SettingsUpdateRequest = Omit<Settings, 'updated_at' | 'updated_by'>;

export interface AuditLog {
  id: string;
  at: DateTime;
  user: UserBrief;
  action: AuditAction;
  case_id: string | null;
  case_no: string | null;
  detail: string;
}

export interface AuditLogParams extends PageParams {
  from?: DateTime;
  to?: DateTime;
  user_id?: string;
  case_id?: string;
  action?: AuditAction;
}

export interface Retention {
  closed_case_days: number;
  raw_video_days: number;
}

export interface PendingDeletion {
  target_type: 'CASE' | 'VIDEO';
  target_id: string;
  label: string;
  delete_at: DateTime;
}
