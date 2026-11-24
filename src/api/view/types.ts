// 화면용 타입. 컴포넌트는 서버 타입(src/api/types.ts) 대신 이 타입만 받는다.
// 서버 명세가 바뀌면 src/api/view의 변환 함수(serverMappers.ts)만 고친다.
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
  /** 인물 강조 하이라이트 영상. highlight_status가 ready일 때만, 아니면 null */
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

/** 후보 = 검색 결과의 트랙렛 하나. id는 서버 tracklet_id */
export interface CandidateView {
  id: string;
  scene: SceneView;
  similarity: number;
  status: CandidateStatusView;
  /** 이 후보의 유효 판단(보류 등). 없으면 null */
  decisionId: string | null;
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
  /** 판단한 트랙렛(후보 id와 같음). 출현 알림 판단이면 null */
  candidateId: string | null;
  source: 'tracklet' | 'alert';
  verdict: VerdictView;
  decidedAt: string;
  decidedByName: string;
  /** 사람이 찍힌 시각 */
  observedAt: string;
  /** 장면 정보. 서버 판단 기록에는 없어서, 화면이 아는 장면(동선·대기열)으로 채우고 모르면 null */
  scene: { cameraCode: string; startAt: string; thumbnailUrl: string } | null;
  revert: { at: string; byName: string; reason: string | null } | null;
  /** 앞선 확정이 번복돼 다시 확인해야 함 */
  needsRecheck: boolean;
  /** 번복할 때 expected_version */
  version: number;
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
  /** 사건 제목(사건 번호 대신) */
  title: string;
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

/** 카메라·보조 지점(지도 노드). id는 서버 node_id */
export interface CameraView {
  id: string;
  /** 영상이 가리키는 서버 camera_id(보조 지점은 null) */
  cameraId: string | null;
  /** camera = CCTV, waypoint = 카메라 없는 보조 지점(갈림길 등) */
  kind: 'camera' | 'waypoint';
  /** 짧은 표시용 코드. 서버 이름이 "C3 학생회관"처럼 코드로 시작하면 그 코드, 아니면 이름 */
  code: string;
  name: string;
  location: LatLngView;
  directionDeg: number | null;
  fovDeg: number | null;
  /** fixed = 고정 CCTV(원), case = 사건 영상(네모) */
  source: 'fixed' | 'case';
  /** 분석된 영상이 있는지. 서버 카메라 응답에는 없어서 관리자 화면만 영상 목록으로 채운다(기본 true) */
  analyzed: boolean;
  videoCount: number | null;
  hasStream: boolean;
  version: number;
}

export type DangerKindView = 'water' | 'steep_slope' | 'road' | 'construction' | 'other';
export type SeverityView = 'low' | 'medium' | 'high';

export interface DangerZoneView {
  id: string;
  name: string;
  kind: DangerKindView;
  severity: SeverityView;
  description: string;
  /** 하나 이상의 다각형 */
  polygons: PolygonView[];
  version: number;
}

export interface WalkEdgeView {
  id: string;
  /** 양 끝 노드(CameraView.id) */
  fromCameraId: string;
  toCameraId: string;
  path: LatLngView[];
  detourSuspected: boolean;
  detourRatio: number | null;
  distanceM: number;
  minutes: number;
  /** manual = 관리자가 직접 고친 값, api = 도보 경로 API 값 */
  source: 'api' | 'manual';
  /** 경로를 못 구해 직접 입력이 필요한 구간 */
  needsManual: boolean;
  correctionFactor: number;
  version: number;
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

/** 사람 유형(보행 속도 프리셋). 서버 person_type */
export type WalkSpeedPresetView = 'adult' | 'child' | 'elderly' | 'other';
/** 사건 종료 결과. 서버 close_outcome */
export type CloseReasonView = 'found' | 'unresolved' | 'other';

/** 사건(목록·관리 메뉴) */
export interface CaseView {
  id: string;
  title: string;
  closed: boolean;
  personName: string;
  age: number | null;
  /** 인상착의(서버 appearance) */
  description: string;
  /** 마지막 목격 시각(서버 last_seen_at) */
  missingAt: string;
  lastSeenPlace: { name: string | null; location: LatLngView };
  walkSpeed: WalkSpeedPresetView;
  /** 주 담당자(등록자) */
  createdBy: PersonView;
  members: PersonView[];
  closedAt: string | null;
  closeReason: CloseReasonView | null;
  closeNote: string | null;
  confirmedCount: number;
  /** 최신 검색이 끝났고 낡지 않았을 때만 숫자, 그 밖에는 null(R1) */
  pendingCount: number | null;
  /** 마지막 확정 목격. 사건 응답에는 없어서 동선(route)에서 채운다 */
  lastSeenAt: string | null;
  lastSeenCameraCode: string | null;
  /** 최근 검색(R6) */
  latestSearch: { id: string; status: TaskStatusView; stale: boolean } | null;
  similarityThreshold: number;
  watchEnabled: boolean;
  version: number;
}

/** 목록 한 페이지 */
export interface PageView<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export type TaskStatusView = 'pending' | 'running' | 'done' | 'failed';

export type TaskStageView =
  'queued' | 'preparing' | 'converting' | 'analyzing' | 'saving' | 'done' | 'failed';

export interface TaskView {
  id: string;
  status: TaskStatusView;
  stage: TaskStageView;
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

/** 시스템 설정 중 화면에 필요한 값. 관리자가 아직 안 정한 값은 null(D03) */
export interface SettingsView {
  walkSpeedMps: Record<WalkSpeedPresetView, number | null>;
  similarityThresholdDefault: number | null;
  alertHighThreshold: number | null;
}

// ---------- 동선 추적 ----------

export interface QueryImageView {
  id: string;
  url: string;
  /** 특징 추출 완료 */
  ready: boolean;
}

/** 기준 대상(사진 한 장 또는 트랙렛 하나) + 검색 조건(질의 바) */
export interface QueryView {
  /** not_set = 없음, embedding = 특징 추출 중, ready = 검색 가능, failed = 추출 실패 */
  status: 'not_set' | 'embedding' | 'ready' | 'failed';
  source: 'photo' | 'tracklet' | null;
  /** 기준 사진(또는 트랙렛 썸네일) 주소 */
  imageUrl: string | null;
  queryVersion: number;
  /** 확정한 장면이 있으면 기준 대상을 바꿀 수 없다 */
  locked: boolean;
  timeFrom: string;
  timeTo: string | null;
  threshold: number;
  /** 관리자 기본값(없으면 null) */
  thresholdDefault: number | null;
  conditionsVersion: number;
}

/** 검색 실행 하나(search_id) */
export interface SearchRunView {
  id: string;
  status: TaskStatusView;
  /** 기준이 바뀌어 이 결과로는 판단할 수 없음 */
  stale: boolean;
  taskId: string | null;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
}

/** 후보 대기열: 한 검색의 후보 */
export interface QueueView {
  search: SearchRunView;
  items: CandidateView[];
}

export interface RouteSceneView {
  order: number;
  /** 트랙렛 id(후보 id와 같음) */
  candidateId: string;
  decisionId: string;
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

export type PersonTypeView = 'adult' | 'child' | 'elderly' | 'other';

/** 시스템 설정 전체(관리자 폼). 아직 안 정한 값은 null */
export interface SettingsFormView {
  walkSpeeds: Record<PersonTypeView, { speedMps: number | null; maxSpeedMps: number | null }>;
  similarityThresholdDefault: number | null;
  alertHighThreshold: number | null;
  outOfFilterThreshold: number | null;
  /** 범위 3단계 누적 비율: 높음 r1 < 중간 r2 < 낮음 1 */
  areaLevelRatios: { high: number; mid: number };
  areaBufferM: number | null;
  maxUploadMb: number | null;
  version: number;
  updatedAt: string;
}
