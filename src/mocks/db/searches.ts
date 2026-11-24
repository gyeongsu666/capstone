// 후보 검색 실행(search_id)·판단·동선을 백엔드(openapi.json) 모양으로.
// 가짜 DB의 후보는 "기준점(anchor)별 유사도"를 갖고 있어서, 검색 하나 = 그 시점의 기준점으로 본 후보 목록이다.
import type { S } from '@/api/server';
import type { Scene } from '@/api/types';
import { control } from '@/mocks/control';
import { db, findCase, findUser, pubId } from '@/mocks/db';
import { toServerUserSummary } from '@/mocks/db/cases';
import type { DbCandidate, DbCase, DbDecision, DbSearch } from '@/mocks/db/schema';
import { createTask, taskProgress } from '@/mocks/db/tasks';
import { currentAnchor, ensureQuery, findScene } from '@/mocks/db/tracking';
import { START_ANCHOR } from '@/mocks/scenario/tracking';

const iso = (t: string) => new Date(t).toISOString();
const MODEL = 'mock-reid';
/** 가짜 원본 영상 크기(트랙렛 박스 픽셀 좌표 기준) */
export const SOURCE_W = 1280;
export const SOURCE_H = 720;

// ---------- 버전 ----------

export const caseVersion = (c: DbCase) => c.version ?? 1;
export const bumpCaseVersion = (c: DbCase) => (c.version = caseVersion(c) + 1);
export const caseEpoch = (c: DbCase) => c.search_epoch ?? 0;
/** 확정·번복처럼 검색 기준을 바꾸는 변경: 그 전 검색은 모두 stale */
export const bumpEpoch = (c: DbCase) => (c.search_epoch = caseEpoch(c) + 1);
export const queryVersion = (c: DbCase) => ensureQuery(c).query_version ?? 1;
export const conditionsVersion = (c: DbCase) => ensureQuery(c).conditions_version ?? 1;

// ---------- 카메라·장면 ----------

function cameraOf(scene: Scene) {
  return db.state.cameras.find((c) => c.id === scene.camera_id);
}

export function cameraName(scene: Scene) {
  const cam = cameraOf(scene);
  return cam ? (cam.code ? `${cam.code} ${cam.name}` : cam.name) : scene.camera_code;
}

export const trackletId = (scene: Scene) => pubId(scene.id);
export const videoIdOf = (scene: Scene) => Number(pubId(scene.video_id));
export const sceneByTracklet = (tid: string) => db.state.scenes.find((s) => pubId(s.id) === tid);

export function toServerTracklet(scene: Scene): S['Tracklet'] {
  const tid = trackletId(scene);
  return {
    tracklet_id: tid,
    video_id: videoIdOf(scene),
    camera_id: Number(scene.camera_id),
    camera_name: cameraName(scene),
    start_at: iso(scene.start_at),
    end_at: iso(scene.end_at),
    thumbnail_url: `/api/tracklets/${tid}/thumbnail`,
    entry_node_id: null,
    exit_node_id: null,
    model_name: MODEL,
    embedding_dimension: 512,
  };
}

export function toServerMedia(scene: Scene): S['MediaSegment'] {
  const vid = videoIdOf(scene);
  return {
    video_id: vid,
    playback_url: `/api/videos/${vid}/stream`,
    recorded_start_at: new Date(
      new Date(scene.start_at).getTime() - scene.start_sec * 1000,
    ).toISOString(),
    duration_s: 3600,
    clip_start_s: scene.start_sec,
    clip_end_s: scene.end_sec,
    // 하이라이트 생성은 미정(D01): 가짜 서버도 준비되지 않은 상태로 둔다
    highlight_url: null,
    highlight_status: 'not_available',
  };
}

/** 인물이 왼쪽에서 오른쪽으로 걸어가는 박스(0.5초 간격, 원본 픽셀) */
export function trajectoryOf(scene: Scene): S['TrajectoryPoint'][] {
  return Array.from({ length: 9 }, (_, i) => ({
    offset_s: scene.start_sec + i * 0.5,
    x_px: Math.round((0.25 + i * 0.04) * SOURCE_W),
    y_px: Math.round(0.2 * SOURCE_H),
    width_px: Math.round(0.18 * SOURCE_W),
    height_px: Math.round(0.6 * SOURCE_H),
  }));
}

export function toServerTrackletScene(scene: Scene): S['TrackletScene'] {
  return {
    tracklet: toServerTracklet(scene),
    media: toServerMedia(scene),
    trajectory: trajectoryOf(scene),
    source_width_px: SOURCE_W,
    source_height_px: SOURCE_H,
  };
}

// ---------- 판단 ----------

const VERDICT = { YES: 'confirmed', NO: 'rejected', HOLD: 'deferred' } as const;

export const nextDecisionId = () =>
  `dec-${Math.max(0, ...db.state.decisions.map((d) => Number(d.id.replace(/\D/g, '')) || 0)) + 1}`;

/** 이 후보의 유효 판단(번복되지 않은 예/아니오/보류) */
export function activeDecision(candidateId: string) {
  return db.state.decisions
    .filter((d) => d.candidate_id === candidateId && d.kind !== 'REVERT' && !d.reverted)
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
}

const revertOf = (d: DbDecision) =>
  db.state.decisions.find((x) => x.kind === 'REVERT' && x.target_decision_id === d.id);

export function toServerDecision(d: DbDecision): S['Decision'] {
  const cand = db.state.candidates.find((x) => x.id === d.candidate_id);
  const scene = cand ? findScene(cand.scene_id) : undefined;
  const rev = d.reverted ? revertOf(d) : undefined;
  const verdict = VERDICT[d.kind as keyof typeof VERDICT];
  return {
    decision_id: pubId(d.id),
    case_id: Number(d.case_id),
    source_type: 'tracklet',
    tracklet_id: scene ? trackletId(scene) : null,
    alert_id: null,
    search_id: d.search_id ?? null,
    verdict,
    status: d.reverted ? 'reversed' : 'active',
    note: '',
    observed_at: iso(scene?.start_at ?? d.decided_at),
    decided_at: iso(d.decided_at),
    decided_by: toServerUserSummary(d.decided_by),
    reversed_at: rev ? iso(rev.decided_at) : null,
    reversed_by: rev ? toServerUserSummary(rev.decided_by) : null,
    reversal_reason: rev?.reason ?? null,
    needs_reconfirmation:
      !d.reverted && verdict === 'confirmed' && cand?.status === 'NEEDS_RECHECK',
    depends_on_decision_id: null,
    version: d.version ?? 1,
  };
}

export const decidedByName = (d: DbDecision) => findUser(d.decided_by)?.name ?? '다른 담당자';

// ---------- 검색 실행 ----------

export function searchStatus(s: DbSearch): S['SearchRun']['status'] {
  const t = db.state.tasks.find((x) => x.task_id === s.task_id);
  if (!t) return 'done';
  return ({ PENDING: 'queued', PROGRESS: 'running', SUCCESS: 'done', FAILURE: 'failed' } as const)[
    taskProgress(t).status
  ];
}

export function isStale(s: DbSearch) {
  const c = findCase(s.case_id);
  if (!c) return true;
  return (
    s.epoch !== caseEpoch(c) ||
    s.query_version !== queryVersion(c) ||
    s.conditions_version !== conditionsVersion(c)
  );
}

const variantFor = (cand: DbCandidate, anchor: string) =>
  cand.variants[anchor] ?? (cand.pinned ? Object.values(cand.variants).at(-1) : undefined);

/** 이 검색의 후보: 기준점에서 본 유사도가 기준 이상인 트랙렛(번복으로 돌아온 후보 포함) */
export function searchCandidates(s: DbSearch) {
  const oof = db.state.settings.out_of_filter_threshold;
  return (
    db.state.candidates
      .filter((x) => x.case_id === s.case_id)
      .map((cand) => ({ cand, v: variantFor(cand, s.anchor) }))
      .filter((x): x is { cand: DbCandidate; v: NonNullable<typeof x.v> } => !!x.v)
      .filter(({ v }) => v.similarity >= s.threshold)
      // R5: 시간상 도달이 어려운 후보는 예외 기준 이상일 때만
      .filter(
        ({ v }) => !v.out_of_filter || (oof !== null && v.similarity >= Math.max(s.threshold, oof)),
      )
      .sort((a, b) => b.v.similarity - a.v.similarity)
  );
}

export function toServerCandidate(
  cand: DbCandidate,
  v: NonNullable<ReturnType<typeof variantFor>>,
  threshold: number,
): S['Candidate'] {
  const scene = findScene(cand.scene_id)!;
  const kinds = new Set(v.reasons.map((r) => r.kind));
  const codes: S['CandidateReason']['reason_codes'] = ['APPEARANCE_MATCH'];
  let feasible: boolean | null = true;
  if (v.out_of_filter) {
    feasible = false;
    codes.push('TIME_REVIEW_REQUIRED');
  } else {
    codes.push('TIME_FEASIBLE');
  }
  if (kinds.has('OVERLAP') || kinds.has('DIRECTION_MISMATCH') || kinds.has('TIME_SHORT'))
    codes.push('MANUAL_REVIEW_REQUIRED');
  const active = activeDecision(cand.id);
  return {
    tracklet: toServerTracklet(scene),
    similarity: v.similarity,
    reason: {
      similarity: v.similarity,
      threshold,
      model_name: MODEL,
      time_feasible: feasible,
      minimum_travel_time_s: v.expected_minutes === null ? null : v.expected_minutes * 60,
      available_time_s: v.travel_minutes === null ? null : v.travel_minutes * 60,
      reason_codes: codes,
      summary: v.reasons.map((r) => r.text).join(' · '),
    },
    decision: active ? VERDICT[active.kind as keyof typeof VERDICT] : null,
    decision_id: active ? pubId(active.id) : null,
    clip_start_s: scene.start_sec,
    clip_end_s: scene.end_sec,
  };
}

export function toServerSearchRun(s: DbSearch): S['SearchRun'] {
  const status = searchStatus(s);
  const created = iso(s.created_at);
  return {
    search_id: s.id,
    case_id: Number(s.case_id),
    task_id: status === 'queued' || status === 'running' ? s.task_id : null,
    status,
    query_version: s.query_version,
    conditions_version: s.conditions_version,
    case_version: s.case_version,
    candidate_count: status === 'done' ? searchCandidates(s).length : 0,
    stale: isStale(s),
    created_at: created,
    completed_at: status === 'done' ? created : null,
  };
}

/** 가장 최근에 만든 검색(R6 latest_search) */
export const latestSearch = (caseId: string) =>
  db.state.searches.filter((s) => s.case_id === caseId).at(-1);

/** 검색 실행: 기준점(지정한 확정 판단의 후보, 없으면 지금 기준점)으로 작업을 만든다 */
export function createSearch(
  c: DbCase,
  opts: { anchorDecisionId?: string | null; direction?: 'forward' | 'backward' } = {},
): DbSearch {
  const q = ensureQuery(c);
  let anchor = currentAnchor(c.id);
  if (opts.anchorDecisionId) {
    const d = db.state.decisions.find((x) => x.id === opts.anchorDecisionId);
    if (d) anchor = d.candidate_id;
  }
  // 시연용: 개발 패널에서 켜 두면 검색이 끝날 때 새 가짜 후보 1~2개
  const fake = control.get().fakeNewCandidates ? 1 + Math.round(Math.random()) : 0;
  const cameraCount = db.state.cameras.filter((x) => x.source === 'FIXED').length;
  // 단계가 보이도록 폴링 간격(2.5초)과 같게: 0 → 40 → 80 → 100 에 약 7.5초
  const task = createTask(
    'CANDIDATE_SEARCH',
    { kind: 'search_done', case_id: c.id, fake_count: fake },
    { stepMs: 2500, result: { searched_camera_count: cameraCount } },
  );
  q.search_task_id = task.task_id;
  const s: DbSearch = {
    id: crypto.randomUUID(),
    case_id: c.id,
    anchor: anchor ?? START_ANCHOR,
    anchor_decision_id: opts.anchorDecisionId ?? null,
    direction: opts.direction ?? 'forward',
    task_id: task.task_id,
    created_at: new Date().toISOString(),
    epoch: caseEpoch(c),
    query_version: queryVersion(c),
    conditions_version: conditionsVersion(c),
    case_version: caseVersion(c),
    threshold: q.threshold,
  };
  db.state.searches.push(s);
  return s;
}

// ---------- 동선 ----------

const camLoc = (scene: Scene) => cameraOf(scene)?.location;

export function toServerRouteScene(cand: DbCandidate): S['RouteScene'] {
  const scene = findScene(cand.scene_id)!;
  const d = activeDecision(cand.id);
  const loc = camLoc(scene) ?? { lat: 0, lng: 0 };
  const tid = trackletId(scene);
  return {
    scene_id: `tracklet:${tid}`,
    decision_id: d ? pubId(d.id) : '0',
    source_type: 'tracklet',
    tracklet_id: tid,
    alert_id: null,
    camera_id: Number(scene.camera_id),
    camera_name: cameraName(scene),
    location: { type: 'Point', coordinates: [loc.lng, loc.lat] },
    observed_start_at: iso(scene.start_at),
    observed_end_at: iso(scene.end_at),
    thumbnail_url: `/api/tracklets/${tid}/thumbnail`,
  };
}

/** 두 확정 장면 사이 도보 추정 경로(도보 구간이 있으면 그 선, 없으면 직선) */
export function toServerSegment(a: DbCandidate, b: DbCandidate): S['RouteSegment'] {
  const sa = findScene(a.scene_id)!;
  const sb = findScene(b.scene_id)!;
  const edge = db.state.walk_edges.find(
    (e) =>
      (e.from_camera_id === sa.camera_id && e.to_camera_id === sb.camera_id) ||
      (e.from_camera_id === sb.camera_id && e.to_camera_id === sa.camera_id),
  );
  const la = camLoc(sa);
  const lb = camLoc(sb);
  const path = edge
    ? edge.from_camera_id === sa.camera_id
      ? edge.path
      : [...edge.path].reverse()
    : la && lb
      ? [la, lb]
      : [];
  const da = activeDecision(a.id);
  const dbb = activeDecision(b.id);
  return {
    from_decision_id: da ? pubId(da.id) : '0',
    to_decision_id: dbb ? pubId(dbb.id) : '0',
    geometry:
      path.length >= 2 && sa.camera_id !== sb.camera_id
        ? { type: 'LineString', coordinates: path.map((p) => [p.lng, p.lat]) }
        : null,
    distance_m: edge ? (edge.corrected_distance_m ?? edge.api_distance_m) : null,
    estimated_duration_s: edge ? (edge.corrected_minutes ?? edge.api_minutes) * 60 : null,
    status: edge || sa.camera_id === sb.camera_id ? 'estimated' : 'unavailable',
    reason_code: edge ? null : 'ROUTE_UNKNOWN',
  };
}
