// 옛 서버 데이터(처음 프론트 명세 모양) → 화면용 타입. 옮긴 영역은 serverMappers.ts.
// 백엔드 openapi.json으로 바꾸면 이 파일의 함수만 새 모양에 맞춰 고친다.
import type { ServerUser } from '@/api/server';
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
  CaseVideo,
  Page,
  UserBrief,
  AreaLevel,
  GeoJSONArea,
  Alert,
  Scene,
  VideoStatus,
} from '@/api/types';
import type {
  AuditActionView,
  AuditLogView,
  PendingDeletionView,
  RetentionView,
  RoleView,
  UserView,
  VideoPageView,
  VideoView,
  SearchAreaView,
  WatchView,
  CaseVideoView,
  PageView,
  PersonView,
  AlertView,
  AnalysisStatusView,
  AreaLevelPolygons,
  AreaLevelView,
  LatLngView,
  PolygonView,
  PriorityZoneView,
  SceneView,
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

export const toPageView = <S, T>(p: Page<S>, map: (s: S) => T): PageView<T> => ({
  items: p.items.map(map),
  total: p.total,
  page: p.page,
  size: p.size,
});

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

// ---------- 동선 추적 ----------

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

/** 백엔드 openapi.json의 User → 화면용 */
export const fromServerUser = (u: ServerUser): UserView => ({
  id: String(u.user_id),
  username: u.username,
  name: u.display_name,
  role: u.role,
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
