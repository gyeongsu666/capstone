// 현재 위치 범위 · 실시간 감시 · 출현 알림 (docs/mock-scenario.md "현재 위치", "실시간 감시")
import { http, HttpResponse } from 'msw';
import type {
  Alert,
  AlertResponseRequest,
  AlertResponseResult,
  AreaLevel,
  GeoJSONArea,
  SearchArea,
  TaskAccepted,
  UnreadCount,
  WatchState,
  WatchUpdateRequest,
} from '@/api/types';
import { addAudit, db, newId, toUserBrief } from '@/mocks/db';
import type { DbAlert, DbCase, DbDecision, DbWatch } from '@/mocks/db/schema';
import { createTask, settleTasks } from '@/mocks/db/tasks';
import { nowKst, toKst } from '@/mocks/db/time';
import { currentAnchor, findScene, routeCandidates, toDecision } from '@/mocks/db/tracking';
import {
  MockError,
  readJson,
  requireCaseAccess,
  requireOpenCase,
  requireUser,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';
import { CASE_IDS } from '@/mocks/scenario';
import { toPolygon } from '@/mocks/scenario/geometry';
import { cameraPos, RESERVOIR_ENTRANCE, searchAreaLevels } from '@/mocks/scenario/map';
import { makeScene } from '@/mocks/scenario/tracking';

const ALERT_DELAY_MS = 60_000;

/** 마지막 확정 장면 */
function lastConfirmedScene(caseId: string) {
  const last = routeCandidates(caseId)
    .filter((x) => x.status === 'CONFIRMED')
    .at(-1);
  return last ? findScene(last.scene_id) : undefined;
}

function requireConfirmedScene(caseId: string) {
  const scene = lastConfirmedScene(caseId);
  if (!scene)
    throw new MockError(400, 'NO_CONFIRMED_SCENE', '확정된 장면이 없어 계산할 수 없어요.');
  return scene;
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

const box = (lat: number, lng: number, d = 0.0002) =>
  toPolygon([
    { lat: lat + d, lng: lng - d },
    { lat: lat + d, lng: lng + d },
    { lat: lat - d, lng: lng + d },
    { lat: lat - d, lng: lng - d },
  ]);

function ensureWatch(caseId: string): DbWatch {
  let w = db.state.watches[caseId];
  if (!w) {
    w = { status: 'OFF', started_at: null, started_by: null, alert_due_at: null };
    db.state.watches[caseId] = w;
  }
  return w;
}

const fixedCameraCount = () =>
  db.state.cameras.filter((c) => c.source === 'FIXED' && c.analyzed).length;

function toWatchState(caseId: string): WatchState {
  const w = ensureWatch(caseId);
  return {
    status: w.status,
    started_at: w.started_at,
    started_by: w.started_by ? toUserBrief(w.started_by) : null,
    camera_count: w.status === 'ON' ? fixedCameraCount() : 0,
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
    });
    changed = true;
  }
  if (changed) db.save();
}

function toAlert(a: DbAlert): Alert {
  return {
    id: a.id,
    scene: findScene(a.scene_id)!,
    similarity: a.similarity,
    status: a.status,
    created_at: a.created_at,
    responded_by: a.responded_by ? toUserBrief(a.responded_by) : null,
  };
}

function stopWatch(c: DbCase) {
  const w = ensureWatch(c.id);
  w.status = 'OFF';
  w.alert_due_at = null;
}

export const searchHandlers = [
  // 현재 위치 범위(마지막 계산 결과) · 사용자 · SYS02-006
  http.get(
    '/api/cases/:caseId/search-area',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const scene = requireConfirmedScene(c.id);
      const computedMs = db.state.search_area_at[c.id] ?? Date.now();
      if (!db.state.search_area_at[c.id]) {
        db.state.search_area_at[c.id] = computedMs;
        db.save();
      }
      const raw = searchAreaLevels(scene.camera_code);
      const levels = (['HIGH', 'MID', 'LOW'] as AreaLevel[]).map((level) => ({
        level,
        area: raw[level],
      }));
      const dangerOverlaps = db.state.danger_zones.flatMap((z) => {
        const hit = levels.find((l) => overlaps(l.area, z.area));
        return hit ? [{ zone_id: z.id, name: z.name, level: hit.level }] : [];
      });
      const base = cameraPos(scene.camera_code);
      return HttpResponse.json<SearchArea>({
        computed_at: toKst(computedMs),
        base_scene: scene,
        elapsed_minutes: Math.round((computedMs - new Date(scene.start_at).getTime()) / 60_000),
        levels,
        danger_overlaps: dangerOverlaps,
        priority_zones: [
          {
            rank: 1,
            name: '가까운 건물 사이 통로',
            area: box(base.lat - 0.0006, base.lng),
            reason: '이탈 방향(남쪽)으로 가장 가까운 골목',
          },
          {
            rank: 2,
            name: '학생회관 앞 광장',
            area: box(34.90987, 126.43574),
            reason: '사람이 많아 목격 제보 가능성 높음',
          },
          {
            rank: 3,
            name: '도림제(저수지) 둘레길 입구',
            area: box(RESERVOIR_ENTRANCE.lat, RESERVOIR_ENTRANCE.lng),
            reason: '위험 지역(도림제) 인접',
          },
        ],
      });
    }),
  ),

  // 현재 시각 기준으로 다시 계산 · 사용자 · SYS02-006
  http.post(
    '/api/cases/:caseId/search-area/recalculate',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireConfirmedScene(c.id);
      const task = createTask('SEARCH_AREA_CALC', { kind: 'area_done', case_id: c.id });
      db.save();
      return HttpResponse.json<TaskAccepted>({ task_id: task.task_id }, { status: 202 });
    }),
  ),

  // 실시간 감시 상태 · 사용자 · SYS02-007
  http.get(
    '/api/cases/:caseId/watch',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleWatches();
      return HttpResponse.json<WatchState>(toWatchState(c.id));
    }),
  ),

  // 실시간 감시 시작·중지 · 사용자 · SYS02-007
  http.put(
    '/api/cases/:caseId/watch',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const body = await readJson<WatchUpdateRequest>(request);
      if (body.status !== 'ON' && body.status !== 'OFF') return validationError('status');
      const w = ensureWatch(c.id);
      if (body.status === 'ON') {
        requireConfirmedScene(c.id);
        if (w.status !== 'ON') {
          w.status = 'ON';
          w.started_at = nowKst();
          w.started_by = user.id;
          w.alert_due_at = Date.now() + ALERT_DELAY_MS;
        }
      } else {
        stopWatch(c);
      }
      db.save();
      return HttpResponse.json<WatchState>(toWatchState(c.id));
    }),
  ),

  // 출현 알림 조회(2~3초 폴링) · 사용자 · SYS02-008
  http.get(
    '/api/cases/:caseId/alerts',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleWatches();
      const url = new URL(request.url);
      const since = url.searchParams.get('since');
      const status = url.searchParams.get('status');
      const list = db.state.alerts
        .filter((a) => a.case_id === c.id)
        .filter((a) => !since || a.created_at > since)
        .filter((a) => !status || a.status === status)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toAlert);
      return HttpResponse.json<Alert[]>(list);
    }),
  ),

  // 사이드바 알림 숫자(모든 화면에서 폴링) · 사용자 · SYS02-008
  http.get(
    '/api/alerts/unread-count',
    withMock(({ request }) => {
      const user = requireUser(request);
      settleWatches();
      const mine = new Set(
        db.state.cases
          .filter((c) => user.role === 'ADMIN' || c.member_ids.includes(user.id))
          .map((c) => c.id),
      );
      const counts = new Map<string, number>();
      for (const a of db.state.alerts) {
        if (a.status === 'NEW' && mine.has(a.case_id))
          counts.set(a.case_id, (counts.get(a.case_id) ?? 0) + 1);
      }
      const byCase = [...counts].map(([case_id, count]) => ({ case_id, count }));
      return HttpResponse.json<UnreadCount>({
        count: byCase.reduce((s, x) => s + x.count, 0),
        by_case: byCase,
      });
    }),
  ),

  // 알림에 예/아니오 응답 · 사용자 · SYS02-008
  http.post(
    '/api/cases/:caseId/alerts/:alertId/response',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const body = await readJson<AlertResponseRequest>(request);
      if (body.kind !== 'YES' && body.kind !== 'NO') return validationError('kind');
      const a = db.state.alerts.find((x) => x.id === params.alertId && x.case_id === c.id);
      if (!a) throw new MockError(404, 'NOT_FOUND', '알림을 찾을 수 없어요.');
      if (a.status !== 'NEW') {
        const who = a.responded_by ? toUserBrief(a.responded_by).name : '다른 담당자';
        throw new MockError(409, 'ALREADY_RESPONDED', `${who}님이 먼저 응답했어요.`);
      }
      a.responded_by = user.id;
      let decision: DbDecision | null = null;
      let taskId: string | null = null;
      if (body.kind === 'YES') {
        a.status = 'CONFIRMED';
        // 확정 기록 생성 → 동선에 추가
        const anchor = currentAnchor(c.id);
        const candId = newId('cand-live');
        db.state.candidates.push({
          id: candId,
          case_id: c.id,
          scene_id: a.scene_id,
          status: 'CONFIRMED',
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
        decision = {
          id: newId('dec'),
          case_id: c.id,
          candidate_id: candId,
          kind: 'YES',
          target_decision_id: null,
          reverted: false,
          decided_by: user.id,
          decided_at: nowKst(),
        };
        db.state.decisions.unshift(decision);
        taskId = createTask('SEARCH_AREA_CALC', { kind: 'area_done', case_id: c.id }).task_id;
      } else {
        a.status = 'DISMISSED';
      }
      const scene = findScene(a.scene_id);
      addAudit(
        user.id,
        'DECISION',
        `출현 알림 ${scene?.camera_code ?? ''} ${body.kind === 'YES' ? '맞음' : '아님'}`,
        c.id,
      );
      db.save();
      return HttpResponse.json<AlertResponseResult>({
        alert: toAlert(a),
        decision: decision ? toDecision(decision) : null,
        task_id: taskId,
      });
    }),
  ),
];

/** 사건 종료 때 실시간 감시 자동 해제 */
export function stopWatchOnClose(c: DbCase) {
  stopWatch(c);
}
