// 백엔드 openapi.json 모양 → 화면용 타입. 서버 모양이 바뀌면 이 파일만 고친다.
import {
  areaView,
  idView,
  idViewOrNull,
  lineView,
  pointView,
  secondsToMinutes,
} from '@/api/convert';
import type {
  S,
  ServerCase,
  ServerSystemSettings,
  ServerVideoStats,
  VideoStatusCounts,
} from '@/api/server';
import { closeReasonLabel, walkSpeedViewLabel } from '@/utils/format';
import type {
  AlertView,
  AuditLogView,
  DeletionCandidateView,
  RetentionView,
  CameraVideoStats,
  AreaLevelView,
  CameraView,
  CandidateView,
  CaseCardView,
  CaseView,
  DecisionView,
  LatLngView,
  PolygonView,
  QueryView,
  QueueView,
  ReasonView,
  RouteView,
  SceneView,
  SearchAreaView,
  SearchRunView,
  TrackPointView,
  UserView,
  VideoStatsView,
  VideoView,
  WatchView,
  DangerZoneView,
  PersonTypeView,
  PersonView,
  SettingsFormView,
  SettingsView,
  TaskView,
  WalkEdgeView,
} from '@/api/view/types';

// ---------- 공통 ----------

export const fromServerUser = (u: S['User']): UserView => ({
  id: idView(u.user_id),
  username: u.username,
  name: u.display_name,
  role: u.role,
  active: u.active,
  mustChangePassword: u.must_change_password,
  createdAt: u.created_at,
  version: u.version,
});

/** 다각형들의 대략적인 가운데(라벨 위치용) */
export function polygonsCenter(polygons: PolygonView[]): LatLngView {
  const pts = polygons.flatMap((p) => p[0] ?? []);
  const n = Math.max(1, pts.length);
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / n,
    lng: pts.reduce((s, p) => s + p.lng, 0) / n,
  };
}

export const fromServerUserSummary = (u: S['UserSummary']): PersonView => ({
  id: idView(u.user_id),
  name: u.display_name,
});

const taskStatus = {
  queued: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
} as const;

export const fromServerTask = (t: S['Task']): TaskView => ({
  id: t.task_id,
  status: taskStatus[t.status],
  stage: t.stage,
  progress: t.progress,
  error: t.error?.message ?? null,
  result: (t.result as Record<string, unknown> | null) ?? null,
});

// ---------- 설정 ----------

const PERSON_TYPES: PersonTypeView[] = ['adult', 'child', 'elderly', 'other'];

const presetOf = (s: ServerSystemSettings, type: PersonTypeView) =>
  s.walking_speed_presets.find((p) => p.person_type === type);

export const fromServerSettings = (s: ServerSystemSettings): SettingsView => ({
  walkSpeedMps: {
    adult: presetOf(s, 'adult')?.speed_mps ?? null,
    child: presetOf(s, 'child')?.speed_mps ?? null,
    elderly: presetOf(s, 'elderly')?.speed_mps ?? null,
    other: presetOf(s, 'other')?.speed_mps ?? null,
  },
  similarityThresholdDefault: s.default_similarity_threshold,
  alertHighThreshold: s.alert_high_threshold,
});

export const fromServerSettingsForm = (s: ServerSystemSettings): SettingsFormView => {
  const [high = 0.5, mid = 0.8] = s.area_level_ratios;
  return {
    walkSpeeds: Object.fromEntries(
      PERSON_TYPES.map((t) => {
        const p = presetOf(s, t);
        return [t, { speedMps: p?.speed_mps ?? null, maxSpeedMps: p?.max_speed_mps ?? null }];
      }),
    ) as SettingsFormView['walkSpeeds'],
    similarityThresholdDefault: s.default_similarity_threshold,
    alertHighThreshold: s.alert_high_threshold,
    outOfFilterThreshold: s.out_of_filter_threshold,
    areaLevelRatios: { high, mid },
    areaBufferM: s.area_buffer_m,
    maxUploadMb: s.max_upload_bytes === null ? null : Math.round(s.max_upload_bytes / 1_000_000),
    version: s.version,
    updatedAt: s.updated_at,
  };
};

// ---------- 지도 ----------

/** "C3 학생회관" → { code: "C3", name: "학생회관" }. 코드로 시작하지 않으면 이름 전체가 코드 */
export function splitCameraName(full: string) {
  const m = /^([A-Za-z]{1,3}\d{1,4})\s+(.+)$/.exec(full.trim());
  return m ? { code: m[1].toUpperCase(), name: m[2] } : { code: full, name: full };
}

export const fromServerCamera = (c: S['Camera'], source: CameraView['source']): CameraView => {
  const { code, name } = splitCameraName(c.name);
  return {
    id: idView(c.node_id),
    cameraId: idViewOrNull(c.camera_id),
    kind: c.kind,
    code,
    name,
    location: pointView(c.location),
    directionDeg: c.direction_deg,
    fovDeg: c.field_of_view_deg,
    source,
    analyzed: true,
    videoCount: null,
    hasStream: c.has_stream,
    version: c.version,
  };
};

export const fromServerDangerZone = (z: S['DangerZone']): DangerZoneView => ({
  id: idView(z.zone_id),
  name: z.name,
  kind: z.kind,
  severity: z.severity,
  description: z.description,
  polygons: areaView(z.geometry),
  version: z.version,
});

export const fromServerWalkEdge = (
  e: S['WalkEdge'],
  nodes: Map<string, CameraView>,
): WalkEdgeView => {
  const from = idView(e.from_node_id);
  const to = idView(e.to_node_id);
  // 경로선이 없으면 두 노드를 곧게 잇는다
  const path = e.geometry
    ? lineView(e.geometry)
    : [nodes.get(from)?.location, nodes.get(to)?.location].filter(
        (p): p is NonNullable<typeof p> => !!p,
      );
  return {
    id: idView(e.edge_id),
    fromCameraId: from,
    toCameraId: to,
    path,
    detourSuspected: e.suspected_detour,
    detourRatio: e.detour_ratio,
    distanceM: Math.round(e.distance_m),
    minutes: secondsToMinutes(e.duration_s) ?? 0,
    source: e.source,
    needsManual: e.status === 'needs_manual',
    correctionFactor: e.correction_factor,
    version: e.version,
  };
};

// ---------- 사건 ----------

const ownerOf = (c: ServerCase): PersonView => {
  const owner = c.assignees.find((a) => a.is_owner) ?? c.assignees[0];
  return owner
    ? fromServerUserSummary(owner.user)
    : { id: idView(c.owner_id), name: '(알 수 없음)' };
};

export const fromServerCase = (c: ServerCase): CaseView => ({
  id: idView(c.case_id),
  title: c.title,
  closed: c.status === 'closed',
  personName: c.person_name,
  age: c.person_age,
  description: c.appearance,
  missingAt: c.last_seen_at,
  lastSeenPlace: { name: c.last_seen_place_name, location: pointView(c.last_seen_location) },
  walkSpeed: c.person_type,
  createdBy: ownerOf(c),
  members: c.assignees.map((a) => fromServerUserSummary(a.user)),
  closedAt: c.closed_at,
  closeReason: c.close_outcome,
  closeNote: c.close_reason,
  confirmedCount: c.summary.confirmed_count,
  pendingCount: c.summary.pending_count,
  lastSeenAt: null,
  lastSeenCameraCode: null,
  latestSearch: c.latest_search
    ? {
        id: c.latest_search.search_id,
        status: taskStatus[c.latest_search.status],
        stale: c.latest_search.stale,
      }
    : null,
  similarityThreshold: c.search_conditions.similarity_threshold,
  watchEnabled: c.watch_enabled,
  version: c.version,
});

export const fromServerCaseCard = (c: ServerCase): CaseCardView => ({
  id: idView(c.case_id),
  title: c.title,
  personName: c.person_name,
  age: c.person_age,
  description: c.appearance,
  missingAt: c.last_seen_at,
  walkSpeedLabel: walkSpeedViewLabel[c.person_type],
  closed: c.status === 'closed',
  closeReasonLabel: c.close_outcome ? closeReasonLabel[c.close_outcome] : null,
});

// ---------- 동선 추적 ----------

/** 트랙렛 → 장면(재생 주소는 장면 상세에서 채운다) */
export const fromServerTracklet = (
  t: S['Tracklet'],
  clip?: { start: number; end: number },
): SceneView => ({
  id: t.tracklet_id,
  cameraId: idView(t.camera_id),
  cameraCode: splitCameraName(t.camera_name).code,
  startAt: t.start_at,
  endAt: t.end_at,
  thumbnailUrl: t.thumbnail_url,
  highlightUrl: null,
  videoUrl: null,
  clipStartSec: clip?.start ?? 0,
  clipEndSec: clip?.end ?? 0,
  bbox: null,
});

/** 재생 정보: 하이라이트는 ready일 때만. 박스는 원본 픽셀을 0~1로 바꾼다 */
export function fromServerMediaScene(
  scene: SceneView,
  media: S['MediaSegment'] | null,
  trajectory: S['TrajectoryPoint'][],
  source: { w: number; h: number } | null,
): { scene: SceneView; track: TrackPointView[] } {
  const withMedia: SceneView = media
    ? {
        ...scene,
        videoUrl: media.playback_url,
        highlightUrl:
          media.highlight_status === 'ready' && media.highlight_url ? media.highlight_url : null,
        clipStartSec: media.clip_start_s,
        clipEndSec: media.clip_end_s,
      }
    : scene;
  const track =
    source && source.w > 0 && source.h > 0
      ? trajectory.map((p) => ({
          t: p.offset_s,
          x: p.x_px / source.w,
          y: p.y_px / source.h,
          w: p.width_px / source.w,
          h: p.height_px / source.h,
        }))
      : [];
  return { scene: withMedia, track };
}

export const fromServerTrackletScene = (ts: S['TrackletScene']) =>
  fromServerMediaScene(fromServerTracklet(ts.tracklet), ts.media, ts.trajectory, {
    w: ts.source_width_px,
    h: ts.source_height_px,
  });

const toMinutes = (s: number | null) => (s === null ? null : Math.round(s / 60));

/** 근거: 서버가 준 코드와 설명만 쓴다(사람 겹침·방향은 자체 추정하지 않음, 요청서 R5) */
function reasonsOf(r: S['CandidateReason']): ReasonView[] {
  const list: ReasonView[] = [];
  const min = toMinutes(r.minimum_travel_time_s);
  const avail = toMinutes(r.available_time_s);
  for (const code of r.reason_codes) {
    if (code === 'TIME_FEASIBLE')
      list.push({
        kind: 'route_ok',
        text:
          avail !== null && min !== null
            ? `이동 시간 맞음 (${avail}분 / 최소 ${min}분)`
            : '이동 시간 맞음',
      });
    else if (code === 'TIME_REVIEW_REQUIRED')
      list.push({ kind: 'out_of_filter', text: '시간상 도달이 어려움 · 확인 필요' });
    else if (code === 'ROUTE_UNKNOWN') list.push({ kind: 'info', text: '경로를 판정할 수 없음' });
    else if (code === 'MANUAL_REVIEW_REQUIRED')
      list.push({ kind: 'low_quality', text: '사람이 직접 확인 필요' });
  }
  if (r.summary) list.push({ kind: 'info', text: r.summary });
  return list;
}

const CANDIDATE_STATUS = {
  confirmed: 'confirmed',
  rejected: 'rejected',
  deferred: 'held',
} as const;

export const fromServerCandidate = (c: S['Candidate']): CandidateView => ({
  id: c.tracklet.tracklet_id,
  scene: fromServerTracklet(c.tracklet, { start: c.clip_start_s, end: c.clip_end_s }),
  similarity: c.similarity,
  status: c.decision ? CANDIDATE_STATUS[c.decision] : 'pending',
  decisionId: c.decision_id,
  belowThreshold: false,
  outOfFilter: c.reason.time_feasible === false,
  reasons: reasonsOf(c.reason),
  travelMinutes: toMinutes(c.reason.available_time_s),
  expectedMinutes: toMinutes(c.reason.minimum_travel_time_s),
});

export const fromServerSearchRun = (s: S['SearchRun']): SearchRunView => ({
  id: s.search_id,
  status: taskStatus[s.status],
  stale: s.stale,
  taskId: s.task_id,
  candidateCount: s.candidate_count,
  createdAt: s.created_at,
  completedAt: s.completed_at,
});

/**
 * 대기열: 아직 판단하지 않은 후보 + 보류(맨 뒤). 확정·제외는 빠진다.
 * 시간 조건 밖 후보(확인 요청)는 조건 안 후보 뒤에, 그 안에서는 유사도 순.
 */
export function toQueue(search: S['SearchRun'], items: S['Candidate'][]): QueueView {
  const list = items
    .map(fromServerCandidate)
    .filter((c) => c.status === 'pending' || c.status === 'held')
    .sort(
      (a, b) =>
        Number(a.status === 'held') - Number(b.status === 'held') ||
        Number(a.outOfFilter) - Number(b.outOfFilter) ||
        b.similarity - a.similarity,
    );
  return { search: fromServerSearchRun(search), items: list };
}

const VERDICT_VIEW = { confirmed: 'yes', rejected: 'no', deferred: 'hold' } as const;

export const fromServerDecision = (
  d: S['Decision'],
  sceneOf: (trackletId: string) => SceneView | undefined,
): DecisionView => {
  const scene = d.tracklet_id ? sceneOf(d.tracklet_id) : undefined;
  return {
    id: d.decision_id,
    candidateId: d.tracklet_id,
    source: d.source_type,
    verdict: VERDICT_VIEW[d.verdict],
    decidedAt: d.decided_at,
    decidedByName: d.decided_by.display_name,
    observedAt: d.observed_at,
    scene: scene
      ? { cameraCode: scene.cameraCode, startAt: scene.startAt, thumbnailUrl: scene.thumbnailUrl }
      : null,
    revert:
      d.status === 'reversed'
        ? {
            at: d.reversed_at ?? d.decided_at,
            byName: d.reversed_by?.display_name ?? '(알 수 없음)',
            reason: d.reversal_reason,
          }
        : null,
    needsRecheck: d.needs_reconfirmation,
    version: d.version,
  };
};

export const fromServerRouteScene = (s: S['RouteScene']): SceneView => ({
  id: s.tracklet_id ?? s.scene_id,
  cameraId: idView(s.camera_id),
  cameraCode: splitCameraName(s.camera_name).code,
  startAt: s.observed_start_at,
  endAt: s.observed_end_at,
  thumbnailUrl: s.thumbnail_url,
  highlightUrl: null,
  videoUrl: null,
  clipStartSec: 0,
  clipEndSec: 0,
  bbox: null,
});

/**
 * 동선: 확정 장면(서버 route) + 재확인 필요 장면(판단 기록에서, 장면은 트랙렛 상세로 채움).
 * 경로선은 구간 geometry, 없으면 두 장면 위치를 직선으로.
 */
export function toRoute(
  route: S['ConfirmedRoute'],
  decisions: S['Decision'][],
  recheckScenes: SceneView[],
): RouteView {
  type Item = Omit<RouteView['scenes'][number], 'order'>;
  const byId = new Map(decisions.map((d) => [d.decision_id, d]));
  const confirmed = route.scenes.map((s): Item => {
    const d = byId.get(s.decision_id);
    return {
      candidateId: s.tracklet_id ?? s.scene_id,
      decisionId: s.decision_id,
      scene: fromServerRouteScene(s),
      cameraId: idView(s.camera_id),
      status: 'confirmed',
      confirmedByName: d?.decided_by.display_name ?? '',
      confirmedAt: d?.decided_at ?? '',
    };
  });
  const recheck: Item[] = [];
  for (const d of decisions) {
    if (d.status !== 'active' || !d.needs_reconfirmation || !d.tracklet_id) continue;
    const scene = recheckScenes.find((x) => x.id === d.tracklet_id);
    if (!scene) continue;
    recheck.push({
      candidateId: d.tracklet_id,
      decisionId: d.decision_id,
      scene,
      cameraId: scene.cameraId,
      status: 'needs_recheck',
      confirmedByName: d.decided_by.display_name,
      confirmedAt: d.decided_at,
    });
  }
  const scenes = [...confirmed, ...recheck]
    .sort((a, b) => a.scene.startAt.localeCompare(b.scene.startAt))
    .map((x, i) => ({ ...x, order: i + 1 }));
  const path: LatLngView[] = [];
  route.scenes.forEach((s, i) => {
    const seg = i > 0 ? route.segments[i - 1] : undefined;
    if (seg?.geometry) path.push(...lineView(seg.geometry));
    else path.push(pointView(s.location));
  });
  return { scenes, path, pending: null };
}

/** 사건 응답의 기준 대상·검색 조건 → 질의 바 */
export function toQueryView(c: ServerCase, thresholdDefault: number | null): QueryView {
  const q = c.query;
  const status =
    q.status === 'ready'
      ? 'ready'
      : q.status === 'failed'
        ? 'failed'
        : q.status === 'not_set'
          ? 'not_set'
          : 'embedding';
  let imageUrl: string | null = null;
  if (q.source_type === 'tracklet' && q.tracklet_id)
    imageUrl = `/api/tracklets/${q.tracklet_id}/thumbnail`;
  // 사진을 바꾸면 주소가 같아도 새로 받게 버전을 붙인다
  else if (q.photo_url) imageUrl = `${q.photo_url}?v=${q.query_version}`;
  return {
    status,
    source: q.source_type,
    imageUrl,
    queryVersion: q.query_version,
    locked: c.summary.confirmed_count > 0,
    timeFrom: c.last_seen_at,
    timeTo: null,
    threshold: c.search_conditions.similarity_threshold,
    thresholdDefault,
    conditionsVersion: c.search_conditions.version,
  };
}

// ---------- 현재 위치·감시·알림 ----------

const AREA_LEVEL: Record<number, AreaLevelView> = { 1: 'high', 2: 'mid', 3: 'low' };

/** 다각형들의 대략적인 가운데(번호 표시 위치) */
function centerOf(polygons: PolygonView[]): LatLngView {
  const pts = polygons.flatMap((p) => p[0] ?? []);
  const n = Math.max(1, pts.length);
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / n,
    lng: pts.reduce((s, p) => s + p.lng, 0) / n,
  };
}

export function fromServerSearchArea(a: S['SearchArea']): SearchAreaView {
  const asOfMs = new Date(a.as_of).getTime();
  const basisMs = new Date(a.basis_observed_at).getTime();
  return {
    asOf: a.as_of,
    calculatedAt: a.calculated_at,
    basisDecisionId: a.basis_decision_id,
    basisLocation: pointView(a.basis_location),
    basisObservedAt: a.basis_observed_at,
    // 요청서 3.5: max(0, as_of − 기준 시각)
    elapsedMinutes: Math.max(0, Math.round((asOfMs - basisMs) / 60_000)),
    walkingSpeedMps: a.walking_speed_mps,
    levels: a.levels.map((l) => ({
      level: AREA_LEVEL[l.level] ?? 'low',
      polygons: areaView(l.geometry),
      maxMinutes: Math.round(l.max_travel_time_s / 60),
    })),
    dangerOverlaps: a.hazard_overlaps.map((o) => ({
      zoneId: idView(o.zone_id),
      name: o.name,
      severity: o.severity,
      level: AREA_LEVEL[o.level] ?? 'low',
    })),
    priorityZones: a.priority_areas.map((p) => {
      const polygons = areaView(p.geometry);
      // 서버 우선 구역에는 이름이 없다: 첫 이유를 이름처럼, 나머지를 설명으로
      const [first, ...rest] = p.reasons;
      return {
        rank: p.rank,
        name: first ?? `우선 구역 ${p.rank}`,
        reason: rest.join(' · '),
        center: centerOf(polygons),
        polygons,
      };
    }),
    warnings: a.warnings.map((w) => ({ code: w.code, message: w.message })),
  };
}

export const fromServerWatch = (w: S['WatchState']): WatchView => ({
  enabled: w.enabled,
  status: w.status,
  cameras: w.cameras.map((c) => ({
    cameraId: idView(c.camera_id),
    status: c.status,
    reason: c.blocked_reason ?? c.reason_code,
  })),
  watchingCount: w.cameras.filter((c) => c.status === 'watching').length,
  updatedAt: w.updated_at,
});

const ALERT_STATUS = { pending: 'new', confirmed: 'confirmed', rejected: 'dismissed' } as const;

export const fromServerAlert = (a: S['Alert']): AlertView => ({
  id: a.alert_id,
  cameraId: idView(a.camera_id),
  cameraCode: splitCameraName(a.camera_name).code,
  level: a.level,
  version: a.version,
  createdAt: a.detected_at,
  seenAt: a.detected_at,
  thumbnailUrl: a.snapshot_url,
  similarity: a.similarity,
  status: ALERT_STATUS[a.status],
  respondedByName: a.decided_by?.display_name ?? null,
  sceneId: `alert:${a.alert_id}`,
});

/** 사건 장면 상세(alert:{id} 등). 원본 크기를 몰라 박스는 그리지 않는다 */
export const fromServerCaseScene = (cs: S['CaseScene']) =>
  fromServerMediaScene(fromServerRouteScene(cs.scene), cs.media, cs.trajectory, null);

// ---------- 영상 ----------

const ANALYSIS_STATUS = {
  queued: 'waiting',
  running: 'processing',
  done: 'done',
  failed: 'failed',
} as const;

export const fromServerVideo = (v: S['Video']): VideoView => ({
  id: idView(v.video_id),
  label: `영상 #${v.video_id}`,
  cameraId: idView(v.camera_id),
  cameraCode: splitCameraName(v.camera_name).code,
  cameraName: splitCameraName(v.camera_name).name,
  recordedAt: v.recorded_start_at,
  durationSec: v.duration_s,
  status: ANALYSIS_STATUS[v.analysis.status],
  stage: v.analysis.stage,
  progress: v.analysis.progress,
  errorMessage: v.analysis.message,
  taskId: v.analysis.task_id,
  caseId: v.case_id === null ? null : idView(v.case_id),
  uploadedAt: v.created_at,
  trackletCount: v.tracklet_count,
  warnings: v.warnings.map((w) => w.message),
});

const toCameraStats = (c: VideoStatusCounts): CameraVideoStats => ({
  total: c.queued + c.running + c.done + c.failed,
  waiting: c.queued,
  processing: c.running,
  done: c.done,
  failed: c.failed,
});

export const fromServerVideoStats = (s: ServerVideoStats): VideoStatsView => ({
  total: s.total,
  byStatus: {
    waiting: s.by_status.queued,
    processing: s.by_status.running,
    done: s.by_status.done,
    failed: s.by_status.failed,
  },
  byCamera: Object.fromEntries(
    s.by_camera.map((c) => [idView(c.camera_id), toCameraStats(c.by_status)]),
  ),
  asOf: s.as_of,
});

// ---------- 계정·이용 기록·보관 ----------

export const fromServerAudit = (l: S['AuditEntry']): AuditLogView => ({
  id: l.log_id,
  at: l.occurred_at,
  userName: l.actor_name ?? '(시스템)',
  action: l.action,
  caseId: l.case_id === null ? null : idView(l.case_id),
  target: l.resource_id ? `${l.resource_type} ${l.resource_id}` : l.resource_type,
  result: l.result,
  changedFields: l.changed_fields,
});

export const fromServerRetention = (r: S['RetentionPolicy']): RetentionView => ({
  videoDays: r.video_retention_days,
  closedCaseDays: r.closed_case_retention_days,
  alertDays: r.alert_retention_days,
  auditDays: r.audit_retention_days,
  automaticDeletion: r.automatic_deletion_enabled,
  version: r.version,
  updatedAt: r.updated_at,
});

export const fromServerDeletionCandidate = (d: S['DeletionCandidate']): DeletionCandidateView => ({
  kind: d.resource_type,
  id: d.resource_id,
  retainUntil: d.retain_until,
  eligible: d.eligible,
  blockedReasons: d.blocked_reasons,
  referencedCaseIds: d.referenced_case_ids.map(idView),
  estimatedBytes: d.estimated_bytes,
});
