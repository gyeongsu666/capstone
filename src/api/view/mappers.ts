// 서버 데이터(docs/api-spec.md 모양) → 화면용 타입.
// 백엔드 openapi.json으로 바꾸면 이 파일의 함수만 새 모양에 맞춰 고친다.
import { walkSpeedLabel } from '@/utils/format';
import type {
  AuditAction,
  AuditLog,
  PendingDeletion,
  Retention,
  Role,
  User,
  Video,
  VideoPage,
  SearchArea,
  WatchState,
  CandidatePage,
  RouteResponse,
  SearchQuery,
  CaseVideo,
  Page,
  Settings,
  Task,
  UserBrief,
  WalkSpeedPreset,
  AreaLevel,
  Camera,
  DangerZone,
  GeoJSONArea,
  WalkEdge,
  Alert,
  Candidate,
  Case,
  CloseReason,
  CandidateStatus,
  Decision,
  Reason,
  ReasonKind,
  Scene,
  TrackPoint,
  VideoStatus,
} from '@/api/types';
import type {
  AuditActionView,
  AuditLogView,
  PendingDeletionView,
  RetentionView,
  RoleView,
  SettingsFormView,
  UserView,
  VideoPageView,
  VideoView,
  SearchAreaView,
  WatchView,
  QueryView,
  QueueView,
  RouteView,
  CaseView,
  CaseVideoView,
  CloseReasonView,
  PageView,
  PersonView,
  SettingsView,
  TaskView,
  WalkSpeedPresetView,
  AlertView,
  AnalysisStatusView,
  CandidateStatusView,
  AreaLevelPolygons,
  AreaLevelView,
  CameraView,
  DangerZoneView,
  LatLngView,
  PolygonView,
  PriorityZoneView,
  WalkEdgeView,
  CandidateView,
  CaseCardView,
  DecisionView,
  ReasonView,
  ReasonViewKind,
  SceneView,
  TrackPointView,
} from '@/api/view/types';

export function toSceneView(s: Scene): SceneView {
  return {
    id: s.id,
    cameraId: s.camera_id,
    cameraCode: s.camera_code,
    startAt: s.start_at,
    endAt: s.end_at,
    thumbnailUrl: s.thumbnail_url,
    highlightUrl: s.highlight_url || null,
    videoUrl: s.video_url || null,
    clipStartSec: s.start_sec,
    clipEndSec: s.end_sec,
    bbox: s.bbox,
  };
}

export const toTrackView = (track: TrackPoint[]): TrackPointView[] => track.map((p) => ({ ...p }));

const reasonKind: Record<ReasonKind, ReasonViewKind> = {
  ROUTE_OK: 'route_ok',
  TIME_SHORT: 'time_short',
  DIRECTION_MISMATCH: 'direction_mismatch',
  OUT_OF_FILTER: 'out_of_filter',
  LOW_QUALITY: 'low_quality',
  OVERLAP: 'overlap',
};

export const toReasonView = (r: Reason): ReasonView => ({
  kind: reasonKind[r.kind] ?? 'info',
  text: r.text,
});

const candidateStatus: Record<CandidateStatus, CandidateStatusView> = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  HELD: 'held',
  NEEDS_RECHECK: 'needs_recheck',
};

export const toCandidateStatusView = (s: CandidateStatus) => candidateStatus[s];

export function toCandidateView(c: Candidate): CandidateView {
  return {
    id: c.id,
    scene: toSceneView(c.scene),
    similarity: c.similarity,
    status: candidateStatus[c.status],
    belowThreshold: c.below_threshold,
    outOfFilter: c.out_of_filter,
    reasons: c.reasons.map(toReasonView),
    travelMinutes: c.travel_minutes,
    expectedMinutes: c.expected_minutes,
  };
}

/** 결정 기록(최신순). REVERT 기록은 대상 기록의 revert 정보로 합친다. */
export function toDecisionViews(decisions: Decision[]): DecisionView[] {
  const reverts = new Map<string, Decision>();
  for (const d of decisions) {
    if (d.kind === 'REVERT' && d.target_decision_id) reverts.set(d.target_decision_id, d);
  }
  return decisions
    .filter((d) => d.kind !== 'REVERT')
    .map((d) => {
      const r = reverts.get(d.id);
      return {
        id: d.id,
        candidateId: d.candidate_id,
        verdict: d.kind === 'YES' ? 'yes' : d.kind === 'NO' ? 'no' : 'hold',
        decidedAt: d.decided_at,
        decidedByName: d.decided_by.name,
        scene: {
          cameraCode: d.scene.camera_code,
          startAt: d.scene.start_at,
          thumbnailUrl: d.scene.thumbnail_url,
        },
        revert: r ? { at: r.decided_at, byName: r.decided_by.name } : null,
      };
    });
}

export function toAlertView(a: Alert): AlertView {
  return {
    id: a.id,
    cameraCode: a.scene.camera_code,
    createdAt: a.created_at,
    seenAt: a.scene.start_at,
    thumbnailUrl: a.scene.thumbnail_url,
    similarity: a.similarity,
    status: a.status === 'NEW' ? 'new' : a.status === 'CONFIRMED' ? 'confirmed' : 'dismissed',
    respondedByName: a.responded_by?.name ?? null,
    scene: toSceneView(a.scene),
  };
}

const closeReasonLabel: Record<CloseReason, string> = {
  FOUND: '발견',
  SEARCH_STOPPED: '수색 중단',
  OTHER: '기타',
};

export function toCaseCardView(c: Case): CaseCardView {
  return {
    id: c.id,
    caseNo: c.case_no,
    personName: c.missing_person.name,
    age: c.missing_person.age,
    description: c.missing_person.description,
    missingAt: c.missing_at,
    walkSpeedLabel: walkSpeedLabel[c.walk_speed_preset],
    closed: c.status === 'CLOSED',
    closeReasonLabel: c.close_reason ? closeReasonLabel[c.close_reason] : null,
  };
}

// ---------- 지도 ----------

/** GeoJSON 영역 → 다각형 목록([lng, lat] → {lat, lng}). 좌표 변환은 여기서만 한다. */
export function toPolygons(area: GeoJSONArea): PolygonView[] {
  const ring = (r: number[][]): LatLngView[] => r.map(([lng, lat]) => ({ lat, lng }));
  return area.type === 'Polygon'
    ? [area.coordinates.map(ring)]
    : area.coordinates.map((poly) => poly.map(ring));
}

/** 다각형들의 대략적인 가운데(라벨 위치용) */
export function polygonsCenter(polygons: PolygonView[]): LatLngView {
  const pts = polygons.flatMap((p) => p[0] ?? []);
  const lat = pts.reduce((s, p) => s + p.lat, 0) / Math.max(1, pts.length);
  const lng = pts.reduce((s, p) => s + p.lng, 0) / Math.max(1, pts.length);
  return { lat, lng };
}

export const toCameraView = (c: Camera): CameraView => ({
  id: c.id,
  code: c.code,
  name: c.name,
  location: { lat: c.location.lat, lng: c.location.lng },
  directionDeg: c.direction_deg,
  fovDeg: c.fov_deg,
  source: c.source === 'CASE' ? 'case' : 'fixed',
  analyzed: c.analyzed,
  videoCount: c.video_count,
});

export const toDangerZoneView = (z: DangerZone): DangerZoneView => ({
  id: z.id,
  name: z.name,
  targetType: z.target_type === 'MISSING' ? 'missing' : 'criminal',
  polygons: toPolygons(z.area),
});

export const toWalkEdgeView = (e: WalkEdge): WalkEdgeView => ({
  id: e.id,
  fromCameraId: e.from_camera_id,
  toCameraId: e.to_camera_id,
  path: e.path.map((p) => ({ lat: p.lat, lng: p.lng })),
  detourSuspected: e.detour_suspected,
  apiDistanceM: e.api_distance_m,
  apiMinutes: e.api_minutes,
  correctedDistanceM: e.corrected_distance_m,
  correctedMinutes: e.corrected_minutes,
});

const areaLevel: Record<AreaLevel, AreaLevelView> = { HIGH: 'high', MID: 'mid', LOW: 'low' };

export const toAreaLevelPolygons = (l: {
  level: AreaLevel;
  area: GeoJSONArea;
}): AreaLevelPolygons => ({
  level: areaLevel[l.level],
  polygons: toPolygons(l.area),
});

export function toPriorityZoneView(z: {
  rank: number;
  name: string;
  area: GeoJSONArea;
  reason?: string;
}): PriorityZoneView {
  const polygons = toPolygons(z.area);
  return {
    rank: z.rank,
    name: z.name,
    reason: z.reason ?? '',
    polygons,
    center: polygonsCenter(polygons),
  };
}

const analysisStatus: Record<VideoStatus, AnalysisStatusView> = {
  WAITING: 'waiting',
  PROCESSING: 'processing',
  DONE: 'done',
  FAILED: 'failed',
};

export const toAnalysisStatusView = (s: VideoStatus) => analysisStatus[s];

// ---------- 사건·계정·작업 ----------

export const toPersonView = (u: UserBrief): PersonView => ({ id: u.id, name: u.name });

const walkSpeed: Record<WalkSpeedPreset, WalkSpeedPresetView> = {
  ADULT: 'adult',
  CHILD: 'child',
  ELDERLY: 'elderly',
};
export const toWalkSpeedServer = (v: WalkSpeedPresetView): WalkSpeedPreset =>
  (Object.keys(walkSpeed) as WalkSpeedPreset[]).find((k) => walkSpeed[k] === v)!;

const closeReason: Record<CloseReason, CloseReasonView> = {
  FOUND: 'found',
  SEARCH_STOPPED: 'search_stopped',
  OTHER: 'other',
};
export const toCloseReasonServer = (v: CloseReasonView): CloseReason =>
  (Object.keys(closeReason) as CloseReason[]).find((k) => closeReason[k] === v)!;

export function toCaseView(c: Case): CaseView {
  return {
    id: c.id,
    caseNo: c.case_no,
    closed: c.status === 'CLOSED',
    personName: c.missing_person.name,
    age: c.missing_person.age,
    description: c.missing_person.description,
    missingAt: c.missing_at,
    lastSeenPlace: {
      name: c.last_seen_place.name,
      location: { lat: c.last_seen_place.location.lat, lng: c.last_seen_place.location.lng },
    },
    walkSpeed: walkSpeed[c.walk_speed_preset],
    createdBy: toPersonView(c.created_by),
    members: c.members.map(toPersonView),
    closedAt: c.closed_at,
    closeReason: c.close_reason ? closeReason[c.close_reason] : null,
    confirmedCount: c.summary.confirmed_count,
    pendingCount: c.summary.pending_count,
    lastSeenAt: c.summary.last_seen_at,
    lastSeenCameraCode: c.summary.last_seen_camera_code,
  };
}

export const toPageView = <S, T>(p: Page<S>, map: (s: S) => T): PageView<T> => ({
  items: p.items.map(map),
  total: p.total,
  page: p.page,
  size: p.size,
});

export function toTaskView(t: Task): TaskView {
  const status = {
    PENDING: 'pending',
    PROGRESS: 'running',
    SUCCESS: 'done',
    FAILURE: 'failed',
  } as const;
  return {
    id: t.task_id,
    status: status[t.status],
    progress: t.progress,
    error: t.error,
    result: t.result,
  };
}

export const toCaseVideoView = (cv: CaseVideo): CaseVideoView => ({
  id: cv.video.id,
  fileName: cv.video.file_name,
  cameraCode: cv.camera.code,
  cameraName: cv.camera.name,
  recordedAt: cv.video.recorded_at,
  status: analysisStatus[cv.video.status],
  progress: cv.video.progress,
  errorMessage: cv.video.error_message,
  taskId: cv.video.task_id,
});

export const toSettingsView = (s: Settings): SettingsView => ({
  walkSpeedMps: {
    adult: s.walk_speed_mps.ADULT,
    child: s.walk_speed_mps.CHILD,
    elderly: s.walk_speed_mps.ELDERLY,
  },
  similarityThresholdDefault: s.similarity_threshold_default,
});

// ---------- 동선 추적 ----------

export const toQueryView = (q: SearchQuery): QueryView => ({
  images: q.images.map((i) => ({ id: i.id, url: i.image_url, ready: i.ready })),
  timeFrom: q.time_from,
  timeTo: q.time_to,
  threshold: q.threshold,
  thresholdDefault: q.threshold_default,
});

export const toQueueView = (p: CandidatePage): QueueView => ({
  items: p.items.map(toCandidateView),
  belowThresholdCount: p.below_threshold_count,
});

export const toRouteView = (r: RouteResponse): RouteView => ({
  scenes: r.scenes.map((s) => ({
    order: s.order,
    candidateId: s.candidate_id,
    scene: toSceneView(s.scene),
    cameraId: s.scene.camera_id,
    status: s.status === 'CONFIRMED' ? 'confirmed' : 'needs_recheck',
    confirmedByName: s.confirmed_by.name,
    confirmedAt: s.confirmed_at,
  })),
  path: r.path.map((p) => ({ lat: p.lat, lng: p.lng })),
  pending: r.pending
    ? { ...toCandidateView(r.pending), cameraId: r.pending.scene.camera_id }
    : null,
});

// ---------- 현재 위치 수색·실시간 감시 ----------

export const toSearchAreaView = (a: SearchArea): SearchAreaView => ({
  computedAt: a.computed_at,
  baseScene: toSceneView(a.base_scene),
  elapsedMinutes: a.elapsed_minutes,
  levels: a.levels.map(toAreaLevelPolygons),
  dangerOverlaps: a.danger_overlaps.map((o) => ({
    zoneId: o.zone_id,
    name: o.name,
    level: areaLevel[o.level],
  })),
  priorityZones: a.priority_zones.map(toPriorityZoneView),
});

export const toWatchView = (w: WatchState): WatchView => ({
  on: w.status === 'ON',
  startedAt: w.started_at,
  startedByName: w.started_by?.name ?? null,
  cameraCount: w.camera_count,
});

// ---------- 관리자 ----------

export const toVideoView = (v: Video): VideoView => ({
  id: v.id,
  fileName: v.file_name,
  cameraId: v.camera_id,
  cameraCode: v.camera_code,
  recordedAt: v.recorded_at,
  durationSec: v.duration_sec,
  status: analysisStatus[v.status],
  progress: v.progress,
  errorMessage: v.error_message,
  taskId: v.task_id,
  caseId: v.case_id,
  uploadedAt: v.uploaded_at,
});

export const toVideoPageView = (p: VideoPage): VideoPageView => ({
  ...toPageView(p, toVideoView),
  summary: {
    waiting: p.summary.waiting,
    processing: p.summary.processing,
    done: p.summary.done,
    failed: p.summary.failed,
  },
});

const role: Record<Role, RoleView> = { ADMIN: 'admin', USER: 'user' };
export const toRoleServer = (r: RoleView): Role => (r === 'admin' ? 'ADMIN' : 'USER');

export const toUserView = (u: User): UserView => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: role[u.role],
  active: u.active,
  mustChangePassword: u.must_change_password,
  createdAt: u.created_at,
});

export const toAuditActionView = (a: AuditAction) => a.toLowerCase() as AuditActionView;
export const toAuditActionServer = (a: AuditActionView) => a.toUpperCase() as AuditAction;

export const toAuditLogView = (l: AuditLog): AuditLogView => ({
  id: l.id,
  at: l.at,
  userName: l.user.name,
  action: toAuditActionView(l.action),
  caseNo: l.case_no,
  detail: l.detail,
});

export const toRetentionView = (r: Retention): RetentionView => ({
  closedCaseDays: r.closed_case_days,
  rawVideoDays: r.raw_video_days,
});

export const toPendingDeletionView = (p: PendingDeletion): PendingDeletionView => ({
  kind: p.target_type === 'CASE' ? 'case' : 'video',
  id: p.target_id,
  label: p.label,
  deleteAt: p.delete_at,
});

export const toSettingsFormView = (s: Settings): SettingsFormView => ({
  walkSpeedMps: {
    adult: s.walk_speed_mps.ADULT,
    child: s.walk_speed_mps.CHILD,
    elderly: s.walk_speed_mps.ELDERLY,
  },
  similarityThresholdDefault: s.similarity_threshold_default,
  confirmRequestThreshold: s.confirm_request_threshold,
  filterMarginMinutes: s.filter_margin_minutes,
  outOfFilterThreshold: s.out_of_filter_threshold,
  areaLevelBounds: { ...s.area_level_bounds },
  updatedAt: s.updated_at,
  updatedByName: s.updated_by.name,
});
