// 화면용 타입. 컴포넌트는 서버 타입(src/api/types.ts) 대신 이 타입만 받는다.
// 서버 명세가 바뀌면(docs/openapi-diff.md) src/api/view/mappers.ts만 고친다.
// 필드는 camelCase, 시각은 ISO 문자열, 시간은 분/초를 이름에 밝힌다.

export interface BoxView {
  /** 0~1 비율 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 장면(트랙렛 하나) */
export interface SceneView {
  id: string;
  /** 지도 위치 찾기용 */
  cameraId: string;
  cameraCode: string;
  startAt: string;
  endAt: string;
  thumbnailUrl: string;
  /** 3~5초 하이라이트 영상. 없으면(미구현 등) null */
  highlightUrl: string | null;
  /** 원본 재생용 영상. 없으면 null */
  videoUrl: string | null;
  /** 영상 안에서 장면 구간(초) */
  clipStartSec: number;
  clipEndSec: number;
  /** 대표 프레임 인물 박스 */
  bbox: BoxView | null;
}

/** 재생 중 인물 박스(초 단위) */
export interface TrackPointView extends BoxView {
  t: number;
}

/** 근거 종류: 아이콘과 색을 정한다 */
export type ReasonViewKind =
  | 'route_ok'
  | 'time_short'
  | 'direction_mismatch'
  | 'out_of_filter'
  | 'low_quality'
  | 'overlap'
  | 'info';

export interface ReasonView {
  kind: ReasonViewKind;
  /** 예: "이동 시간 7분 맞음" */
  text: string;
}

export type CandidateStatusView = 'pending' | 'confirmed' | 'rejected' | 'held' | 'needs_recheck';

export interface CandidateView {
  id: string;
  scene: SceneView;
  similarity: number;
  status: CandidateStatusView;
  /** 유사도 기준 미만 */
  belowThreshold: boolean;
  /** 자동 필터 밖이지만 유사도가 높아 올라온 후보 */
  outOfFilter: boolean;
  reasons: ReasonView[];
  /** 직전 확정 장면에서 걸린 시간(분) */
  travelMinutes: number | null;
  /** 도보 기준 예상 시간(분) */
  expectedMinutes: number | null;
}

export type VerdictView = 'yes' | 'no' | 'hold';

/**
 * 결정 기록 한 건. 번복은 별도 기록이 아니라 원래 기록에 붙는 정보로 둔다
 * (현재 명세는 REVERT 기록, openapi 초안은 status=reversed — 둘 다 이 모양으로 변환된다).
 */
export interface DecisionView {
  id: string;
  candidateId: string;
  verdict: VerdictView;
  decidedAt: string;
  decidedByName: string;
  scene: { cameraCode: string; startAt: string; thumbnailUrl: string };
  revert: { at: string; byName: string } | null;
}

export type AlertStatusView = 'new' | 'confirmed' | 'dismissed';

export interface AlertView {
  id: string;
  cameraCode: string;
  /** 알림이 생긴 시각 */
  createdAt: string;
  /** 사람이 찍힌 시각 */
  seenAt: string;
  thumbnailUrl: string;
  similarity: number;
  status: AlertStatusView;
  respondedByName: string | null;
  /** 재생할 장면(녹화가 없으면 null) */
  scene: SceneView | null;
}

/** 사이드바 사건 카드 */
export interface CaseCardView {
  id: string;
  caseNo: string;
  personName: string;
  age: number | null;
  description: string;
  missingAt: string;
  /** 예: "어린이" */
  walkSpeedLabel: string;
  closed: boolean;
  /** 예: "발견" */
  closeReasonLabel: string | null;
}

export type AnalysisStatusView = 'waiting' | 'processing' | 'done' | 'failed';

// ---------- 지도 ----------

/** 지도 좌표. GeoJSON [lng, lat] 변환은 mappers에서만 한다 */
export interface LatLngView {
  lat: number;
  lng: number;
}

/** 다각형 하나: 바깥 고리 + 구멍들 */
export type PolygonView = LatLngView[][];

export interface CameraView {
  id: string;
  code: string;
  name: string;
  location: LatLngView;
  directionDeg: number | null;
  fovDeg: number | null;
  /** fixed = 고정 CCTV(원), case = 사건 영상(네모) */
  source: 'fixed' | 'case';
  analyzed: boolean;
  videoCount: number;
}

export interface DangerZoneView {
  id: string;
  name: string;
  /** missing = 실종자(하천·공사장), criminal = 범죄자(인파 밀집) */
  targetType: 'missing' | 'criminal';
  /** 하나 이상의 다각형 */
  polygons: PolygonView[];
}

export interface WalkEdgeView {
  id: string;
  fromCameraId: string;
  toCameraId: string;
  path: LatLngView[];
  detourSuspected: boolean;
  apiDistanceM: number;
  apiMinutes: number;
  correctedDistanceM: number | null;
  correctedMinutes: number | null;
}

/** 지도에 그리는 동선 */
export interface RouteMapView {
  /** 확정 장면 위치(순번 원) */
  stops: { order: number; location: LatLngView; status: 'confirmed' | 'needs_recheck' }[];
  /** 확정 장면을 잇는 경로(굵은 초록 실선) */
  path: LatLngView[];
  /** 확인 대기 구간(굵은 주황 점선 + "?" 원) */
  pending: { path: LatLngView[]; location: LatLngView } | null;
}

/** 현재 위치 범위 3단계 */
export type AreaLevelView = 'high' | 'mid' | 'low';

export interface AreaLevelPolygons {
  level: AreaLevelView;
  polygons: PolygonView[];
}

export interface PriorityZoneView {
  rank: number;
  name: string;
  reason: string;
  /** 번호 표시 위치 */
  center: LatLngView;
  polygons: PolygonView[];
}

// ---------- 사건·계정·작업 ----------

export interface PersonView {
  id: string;
  name: string;
}

export type WalkSpeedPresetView = 'adult' | 'child' | 'elderly';
export type CloseReasonView = 'found' | 'search_stopped' | 'other';

/** 사건(목록·관리 메뉴) */
export interface CaseView {
  id: string;
  caseNo: string;
  closed: boolean;
  personName: string;
  age: number | null;
  description: string;
  missingAt: string;
  lastSeenPlace: { name: string; location: LatLngView };
  walkSpeed: WalkSpeedPresetView;
  createdBy: PersonView;
  members: PersonView[];
  closedAt: string | null;
  closeReason: CloseReasonView | null;
  confirmedCount: number;
  pendingCount: number;
  lastSeenAt: string | null;
  lastSeenCameraCode: string | null;
}

/** 목록 한 페이지 */
export interface PageView<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export type TaskStatusView = 'pending' | 'running' | 'done' | 'failed';

export interface TaskView {
  id: string;
  status: TaskStatusView;
  progress: number;
  error: string | null;
  /** 작업별 결과(완료 때만) */
  result: Record<string, unknown> | null;
}

export interface CaseVideoView {
  id: string;
  fileName: string;
  cameraCode: string;
  cameraName: string;
  recordedAt: string;
  status: AnalysisStatusView;
  progress: number;
  errorMessage: string | null;
  taskId: string | null;
}

/** 시스템 설정 중 화면에 필요한 값 */
export interface SettingsView {
  walkSpeedMps: Record<WalkSpeedPresetView, number>;
  similarityThresholdDefault: number;
}

// ---------- 동선 추적 ----------

export interface QueryImageView {
  id: string;
  url: string;
  /** 특징 추출 완료 */
  ready: boolean;
}

/** 검색 조건(질의 바) */
export interface QueryView {
  images: QueryImageView[];
  timeFrom: string;
  timeTo: string | null;
  threshold: number;
  thresholdDefault: number;
}

/** 후보 대기열 */
export interface QueueView {
  /** 기준 이상(위) + 기준 미만(아래). 화면에서 belowThreshold로 나눈다 */
  items: CandidateView[];
  belowThresholdCount: number;
}

export interface RouteSceneView {
  order: number;
  candidateId: string;
  scene: SceneView;
  /** 카메라 id(지도 위치 찾기용) */
  cameraId: string;
  status: 'confirmed' | 'needs_recheck';
  confirmedByName: string;
  confirmedAt: string;
}

/** 확정 동선 */
export interface RouteView {
  scenes: RouteSceneView[];
  path: LatLngView[];
  /** 다음 구간 확인 대기 후보 */
  pending: (CandidateView & { cameraId: string }) | null;
}

// ---------- 현재 위치 수색·실시간 감시 ----------

export interface SearchAreaView {
  computedAt: string;
  baseScene: SceneView;
  /** 계산 시점 기준 경과(분) */
  elapsedMinutes: number;
  levels: AreaLevelPolygons[];
  dangerOverlaps: { zoneId: string; name: string; level: AreaLevelView }[];
  priorityZones: PriorityZoneView[];
}

export interface WatchView {
  on: boolean;
  startedAt: string | null;
  startedByName: string | null;
  cameraCount: number;
}

// ---------- 관리자 ----------

export interface VideoView {
  id: string;
  fileName: string;
  cameraId: string;
  cameraCode: string;
  recordedAt: string;
  durationSec: number | null;
  status: AnalysisStatusView;
  progress: number;
  errorMessage: string | null;
  taskId: string | null;
  /** 사건 영상이면 사건 id */
  caseId: string | null;
  uploadedAt: string;
}

export interface VideoPageView extends PageView<VideoView> {
  summary: Record<AnalysisStatusView, number>;
}

export type RoleView = 'admin' | 'user';

export interface UserView {
  id: string;
  username: string;
  name: string;
  role: RoleView;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export type AuditActionView =
  | 'login'
  | 'search'
  | 'decision'
  | 'revert'
  | 'video_view'
  | 'video_upload'
  | 'case_create'
  | 'case_close'
  | 'account_change'
  | 'settings_change'
  | 'data_delete';

export interface AuditLogView {
  id: string;
  at: string;
  userName: string;
  action: AuditActionView;
  caseNo: string | null;
  detail: string;
}

export interface RetentionView {
  closedCaseDays: number;
  rawVideoDays: number;
}

export interface PendingDeletionView {
  kind: 'case' | 'video';
  id: string;
  label: string;
  deleteAt: string;
}

/** 시스템 설정 전체(관리자 폼) */
export interface SettingsFormView {
  walkSpeedMps: Record<WalkSpeedPresetView, number>;
  similarityThresholdDefault: number;
  confirmRequestThreshold: number;
  filterMarginMinutes: number;
  outOfFilterThreshold: number;
  areaLevelBounds: { high: number; mid: number };
  updatedAt: string;
  updatedByName: string;
}
