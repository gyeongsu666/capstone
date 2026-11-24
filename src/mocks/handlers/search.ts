// 현재 위치 범위 · 실시간 감시 · 출현 알림 (openapi.json + 요청서 R2)
import { http, HttpResponse } from 'msw';
import type { S, ServerPendingCount } from '@/api/server';
import type { GeoJSONArea, LatLng } from '@/mocks/db/legacyTypes';
import { addAudit, db, newId, pubId } from '@/mocks/db';
import { casePersonType, toServerUserSummary } from '@/mocks/db/cases';
import type { DbAlert, DbCase, DbDecision, DbWatch } from '@/mocks/db/schema';
import {
  bumpCaseVersion,
  bumpEpoch,
  caseVersion,
  nextDecisionId,
  toServerDecision,
  toServerTracklet,
} from '@/mocks/db/searches';
import { settleTasks } from '@/mocks/db/tasks';
import { nowKst } from '@/mocks/db/time';
import { currentAnchor, ensureQuery, findScene, routeCandidates } from '@/mocks/db/tracking';
import { serveStatic } from '@/mocks/handlers/tracking';
import {
  cursorPage,
  MockError,
  readJson,
  requireCaseAccess,
  requireOpenCase,
  requireUser,
  requireVersion,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';
import { CASE_IDS } from '@/mocks/scenario';
import { toPolygon } from '@/mocks/scenario/geometry';
import { RESERVOIR_ENTRANCE, searchAreaLevelsAt } from '@/mocks/scenario/map';
import { makeScene } from '@/mocks/scenario/tracking';

const ALERT_DELAY_MS = 60_000;
/** 감시를 켠 직후 이 시간 동안은 starting */
const WATCH_STARTING_MS = 5_000;
const LEVELS = [
  { key: 'HIGH', level: 1, label: '높음' },
  { key: 'MID', level: 2, label: '중간' },
  { key: 'LOW', level: 3, label: '낮음' },
] as const;

const iso = (t: string | number) => new Date(t).toISOString();

/** 마지막 확정 장면(재확인 필요 제외) */
function lastConfirmed(caseId: string) {
  const last = routeCandidates(caseId)
    .filter((x) => x.status === 'CONFIRMED')
    .at(-1);
  const scene = last ? findScene(last.scene_id) : undefined;
  const d = last
    ? db.state.decisions.find((x) => x.candidate_id === last.id && x.kind === 'YES' && !x.reverted)
    : undefined;
  return scene ? { scene, decision: d } : undefined;
}

function bbox(area: GeoJSONArea) {
  const pts = area.type === 'Polygon' ? area.coordinates.flat() : area.coordinates.flat(2);
  const lngs = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

/** 대략적인 겹침 판정(경계 상자). 가짜 서버용 */
function overlaps(a: GeoJSONArea, b: GeoJSONArea) {
  const x = bbox(a);
  const y = bbox(b);
  return (
    x.minLng <= y.maxLng && y.minLng <= x.maxLng && x.minLat <= y.maxLat && y.minLat <= x.maxLat
  );
}

const box = (p: LatLng, d = 0.0002): S['AreaGeometry'] =>
  toPolygon([
    { lat: p.lat + d, lng: p.lng - d },
    { lat: p.lat + d, lng: p.lng + d },
    { lat: p.lat - d, lng: p.lng + d },
    { lat: p.lat - d, lng: p.lng - d },
  ]) as S['AreaGeometry'];

function ensureWatch(caseId: string): DbWatch {
  let w = db.state.watches[caseId];
  if (!w) {
    w = { status: 'OFF', started_at: null, started_by: null, alert_due_at: null };
    db.state.watches[caseId] = w;
  }
  return w;
}

/** 감시 대상 카메라: 분석된 영상이 있는 고정 카메라 */
const watchCameras = () =>
  db.state.cameras.filter(
    (c) =>
      c.source === 'FIXED' &&
      db.state.videos.some((v) => v.camera_id === c.id && v.status === 'DONE'),
  );

function toWatchState(caseId: string): S['WatchState'] {
  const w = ensureWatch(caseId);
  const on = w.status === 'ON';
  const starting =
    on &&
    w.started_at !== null &&
    Date.now() - new Date(w.started_at).getTime() < WATCH_STARTING_MS;
  const now = new Date().toISOString();
  return {
    case_id: Number(caseId),
    enabled: on,
    status: !on ? 'stopped' : starting ? 'starting' : 'watching',
    cameras: on
      ? watchCameras().map((c, i) => ({
          camera_id: Number(c.id),
          stream_session_id: null,
          seq: i + 1,
          status: starting ? 'starting' : 'watching',
          heartbeat_at: now,
          last_frame_at: starting ? null : now,
          reason_code: null,
          blocked_reason: null,
        }))
      : [],
    updated_at: w.started_at ? iso(w.started_at) : now,
  };
}

/** 감시 시작 60초 뒤 C10 출현 알림(메인 사건만). 조회할 때마다 확인한다 */
export function settleWatches() {
  let changed = false;
  for (const [caseId, w] of Object.entries(db.state.watches)) {
    if (w.status !== 'ON' || w.alert_due_at === null || Date.now() < w.alert_due_at) continue;
    w.alert_due_at = null;
    if (caseId !== CASE_IDS.main) continue;
    const r = db.state.r;
    const seenMinutes = (Date.now() - 60_000 - r) / 60_000;
    const scene = makeScene(r, 'C10', seenMinutes, 'red');
    scene.id = newId('scene-live');
    db.state.scenes.push(scene);
    db.state.alerts.unshift({
      id: newId('alert'),
      case_id: caseId,
      scene_id: scene.id,
      similarity: 0.84,
      status: 'NEW',
      created_at: nowKst(),
      responded_by: null,
      version: 1,
    });
    changed = true;
  }
  if (changed) db.save();
}

const ALERT_STATUS = { NEW: 'pending', CONFIRMED: 'confirmed', DISMISSED: 'rejected' } as const;

function toServerAlert(a: DbAlert): S['Alert'] {
  const scene = findScene(a.scene_id)!;
  const aid = pubId(a.id);
  const high = db.state.settings.alert_high_threshold;
  const threshold = db.state.queries[a.case_id]?.threshold ?? 0.6;
  return {
    alert_id: aid,
    case_id: Number(a.case_id),
    camera_id: Number(scene.camera_id),
    camera_name: toServerTracklet(scene).camera_name,
    detected_at: iso(a.created_at),
    similarity: a.similarity,
    level: high !== null && a.similarity >= high ? 'high' : 'mid',
    status: ALERT_STATUS[a.status],
    snapshot_url: `/api/cases/${a.case_id}/alerts/${aid}/snapshot`,
    reason: {
      similarity: a.similarity,
      threshold,
      model_name: 'mock-reid',
      time_feasible: true,
      minimum_travel_time_s: null,
      available_time_s: null,
      reason_codes: ['APPEARANCE_MATCH', 'TIME_FEASIBLE'],
      summary: '실시간 감시 출현',
    },
    decision_id: a.decision_id ? pubId(a.decision_id) : null,
    decided_by: a.responded_by ? toServerUserSummary(a.responded_by) : null,
    decided_at: a.responded_at ? iso(a.responded_at) : null,
    version: a.version ?? 1,
  };
}

function findAlert(c: DbCase, alertId: string) {
  const a = db.state.alerts.find((x) => x.case_id === c.id && pubId(x.id) === alertId);
  if (!a) throw new MockError(404, 'RESOURCE_NOT_FOUND', '알림을 찾을 수 없어요.');
  return a;
}

function stopWatch(c: DbCase) {
  const w = ensureWatch(c.id);
  w.status = 'OFF';
  w.alert_due_at = null;
}

export const searchHandlers = [
  // 현재 위치 3단계 범위·위험 지역 겹침·우선 구역 · 사용자 · SYS02-006
  // 조회할 때 계산한다(as_of 기준, 없으면 지금). 확정 장면이 없으면 사건의 마지막 목격 위치·시각 기준
  http.get(
    '/api/cases/:caseId/search-area',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const asOfRaw = new URL(request.url).searchParams.get('as_of');
      const asOfMs = asOfRaw ? new Date(asOfRaw).getTime() : Date.now();
      if (Number.isNaN(asOfMs) || asOfMs > Date.now() + 60_000)
        throw new MockError(422, 'INVALID_AS_OF', '기준 시각이 올바르지 않아요.');

      const preset = db.state.settings.walking_speed_presets.find(
        (p) => p.person_type === casePersonType(c),
      );
      const ratios = db.state.settings.area_level_ratios;
      if (!preset || ratios.length !== 3)
        throw new MockError(
          409,
          'SETTINGS_NOT_CONFIGURED',
          '관리자가 시스템 설정을 먼저 입력해야 해요.',
        );

      const confirmed = lastConfirmed(c.id);
      const cam = confirmed
        ? db.state.cameras.find((x) => x.id === confirmed.scene.camera_id)
        : undefined;
      const basis: LatLng | undefined = confirmed ? cam?.location : c.last_seen_place.location;
      if (!basis) throw new MockError(409, 'ORIGIN_MISSING', '기준 위치가 없어 계산할 수 없어요.');
      const observedAt = confirmed ? confirmed.scene.start_at : c.missing_at;
      const elapsedS = Math.max(0, (asOfMs - new Date(observedAt).getTime()) / 1000);

      const raw = searchAreaLevelsAt(basis);
      const levels = LEVELS.map((l, i) => ({
        level: l.level,
        label: l.label,
        geometry: raw[l.key] as S['AreaGeometry'],
        max_travel_time_s: Math.round(elapsedS * ratios[i]),
      }));
      const hazards = db.state.danger_zones.flatMap((z) => {
        const hit = LEVELS.find((l) => overlaps(raw[l.key], z.area));
        return hit
          ? [
              {
                zone_id: Number(z.id),
                name: z.name,
                severity: z.severity,
                overlap_geometry: z.area as S['AreaGeometry'],
                level: hit.level,
              },
            ]
          : [];
      });
      const reservoir = db.state.danger_zones[0];
      return HttpResponse.json<S['SearchArea']>({
        case_id: Number(c.id),
        case_version: caseVersion(c),
        calculated_at: new Date().toISOString(),
        as_of: iso(asOfMs),
        basis_decision_id: confirmed?.decision ? pubId(confirmed.decision.id) : null,
        basis_location: { type: 'Point', coordinates: [basis.lng, basis.lat] },
        basis_observed_at: iso(observedAt),
        walking_speed_mps: preset.speed_mps,
        levels,
        hazard_overlaps: hazards,
        priority_areas: [
          {
            rank: 1,
            geometry: box({ lat: basis.lat - 0.0006, lng: basis.lng }),
            reasons: ['이탈 방향(남쪽)으로 가장 가까운 통로'],
            hazard_zone_ids: [],
          },
          {
            rank: 2,
            geometry: box({ lat: 34.90987, lng: 126.43574 }),
            reasons: ['학생회관 앞 광장', '사람이 많아 목격 제보 가능성 높음'],
            hazard_zone_ids: [],
          },
          {
            rank: 3,
            geometry: box(RESERVOIR_ENTRANCE),
            reasons: ['도림제(저수지) 둘레길 입구', '위험 지역 인접'],
            hazard_zone_ids: reservoir ? [Number(reservoir.id)] : [],
          },
        ],
        warnings: confirmed
          ? []
          : [
              {
                code: 'NO_CONFIRMED_SCENE',
                message: '확정한 장면이 없어 사건의 마지막 목격 위치 기준으로 계산했어요.',
                related_video_ids: [],
              },
            ],
      });
    }),
  ),

  // 실시간 감시 상태 · 사용자 · SYS02-007
  http.get(
    '/api/cases/:caseId/watch',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleWatches();
      return HttpResponse.json<S['WatchState']>(toWatchState(c.id));
    }),
  ),

  // 실시간 감시 시작·중지 · 사용자 · SYS02-007
  http.put(
    '/api/cases/:caseId/watch',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const b = await readJson<S['WatchPut']>(request);
      if (typeof b.enabled !== 'boolean') return validationError('enabled');
      requireVersion(caseVersion(c), b.expected_case_version);
      const w = ensureWatch(c.id);
      if (b.enabled) {
        if (!ensureQuery(c).images.some((i) => i.ready))
          throw new MockError(409, 'NO_QUERY_VECTOR', '기준 대상의 특징이 없어 감시할 수 없어요.');
        const s = db.state.settings;
        if (s.alert_high_threshold === null)
          throw new MockError(
            409,
            'SETTINGS_NOT_CONFIGURED',
            '관리자가 출현 알림 기준을 먼저 정해야 해요.',
          );
        if (w.status !== 'ON') {
          w.status = 'ON';
          w.started_at = nowKst();
          w.started_by = user.id;
          w.alert_due_at = Date.now() + ALERT_DELAY_MS;
        }
      } else {
        stopWatch(c);
      }
      bumpCaseVersion(c);
      addAudit(user.id, 'SEARCH', b.enabled ? '실시간 감시 시작' : '실시간 감시 중지', c.id);
      db.save();
      return HttpResponse.json<S['WatchState']>(toWatchState(c.id));
    }),
  ),

  // 출현 알림 목록(2~3초 폴링) · 사용자 · SYS02-008 (최신순, cursor)
  http.get(
    '/api/cases/:caseId/alerts',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleWatches();
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const level = url.searchParams.get('level');
      const list = db.state.alerts
        .filter((a) => a.case_id === c.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toServerAlert)
        .filter((a) => !status || a.status === status)
        .filter((a) => !level || a.level === level);
      return HttpResponse.json<S['AlertPage']>(cursorPage(list, request));
    }),
  ),

  // 출현 알림 상세 · 사용자
  http.get(
    '/api/cases/:caseId/alerts/:alertId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      return HttpResponse.json<S['Alert']>(toServerAlert(findAlert(c, String(params.alertId))));
    }),
  ),

  // 출현 알림 스냅샷 파일 · 사용자
  http.get(
    '/api/cases/:caseId/alerts/:alertId/snapshot',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      const a = findAlert(c, String(params.alertId));
      const scene = findScene(a.scene_id);
      if (!scene) throw new MockError(404, 'MEDIA_NOT_FOUND', '스냅샷이 없어요.');
      return serveStatic(scene.thumbnail_url, request);
    }),
  ),

  // 미처리 출현 알림 수(사이드바 배지, 모든 화면에서 폴링) · 사용자 · R2
  http.get(
    '/api/alerts/pending-count',
    withMock(({ request }) => {
      const user = requireUser(request);
      settleWatches();
      const mine = new Set(
        db.state.cases
          .filter((c) => c.status === 'OPEN')
          .filter((c) => user.role === 'ADMIN' || c.member_ids.includes(user.id))
          .map((c) => c.id),
      );
      const counts = new Map<string, number>();
      for (const a of db.state.alerts) {
        if (a.status === 'NEW' && mine.has(a.case_id))
          counts.set(a.case_id, (counts.get(a.case_id) ?? 0) + 1);
      }
      const byCase = [...counts]
        .map(([id, count]) => ({ case_id: Number(id), count }))
        .sort((a, b) => b.count - a.count || a.case_id - b.case_id);
      return HttpResponse.json<ServerPendingCount>({
        count: byCase.reduce((s, x) => s + x.count, 0),
        by_case: byCase,
      });
    }),
  ),

  // 출현 알림 예/아니오 · 사용자 · SYS02-008 (예면 확정 목격으로 동선에 추가)
  http.post(
    '/api/cases/:caseId/alerts/:alertId/decision',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const b = await readJson<S['AlertDecisionRequest']>(request);
      if (b.decision !== 'confirmed' && b.decision !== 'rejected')
        return validationError('decision');
      const a = findAlert(c, String(params.alertId));
      if (a.status !== 'NEW') {
        const who = a.responded_by
          ? toServerUserSummary(a.responded_by).display_name
          : '다른 담당자';
        throw new MockError(409, 'ALERT_ALREADY_DECIDED', `${who}님이 먼저 응답했어요.`);
      }
      requireVersion(a.version ?? 1, b.expected_version);

      // 알림 판단도 판단 기록으로 남긴다(예는 동선에 반영)
      const anchor = currentAnchor(c.id);
      const candId = newId('cand-live');
      const yes = b.decision === 'confirmed';
      db.state.candidates.push({
        id: candId,
        case_id: c.id,
        scene_id: a.scene_id,
        status: yes ? 'CONFIRMED' : 'REJECTED',
        variants: {
          [anchor]: {
            similarity: a.similarity,
            reasons: [{ kind: 'ROUTE_OK', text: '실시간 감시 출현' }],
            out_of_filter: false,
            travel_minutes: null,
            expected_minutes: null,
          },
        },
        pinned: false,
      });
      const decision: DbDecision = {
        id: nextDecisionId(),
        case_id: c.id,
        candidate_id: candId,
        kind: yes ? 'YES' : 'NO',
        target_decision_id: null,
        reverted: false,
        decided_by: user.id,
        decided_at: nowKst(),
        version: 1,
        alert_id: a.id,
      };
      db.state.decisions.unshift(decision);
      a.status = yes ? 'CONFIRMED' : 'DISMISSED';
      a.responded_by = user.id;
      a.responded_at = decision.decided_at;
      a.decision_id = decision.id;
      a.version = (a.version ?? 1) + 1;
      bumpCaseVersion(c);
      // 확정은 기준점을 바꾸므로 검색이 낡는다
      if (yes) bumpEpoch(c);
      const scene = findScene(a.scene_id);
      addAudit(
        user.id,
        'DECISION',
        `출현 알림 ${scene?.camera_code ?? ''} ${yes ? '맞음' : '아님'}`,
        c.id,
      );
      db.save();
      return HttpResponse.json<S['AlertDecisionResponse']>({
        alert: toServerAlert(a),
        decision: toServerDecision(decision),
        case_version: caseVersion(c),
      });
    }),
  ),
];

/** 사건 종료 때 실시간 감시 자동 해제 */
export function stopWatchOnClose(c: DbCase) {
  stopWatch(c);
}
