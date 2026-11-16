import { http, HttpResponse } from 'msw';
import type {
  CandidatePage,
  Decision,
  DecisionRequest,
  DecisionResponse,
  Page,
  QueryImageAccepted,
  RevertResponse,
  RouteResponse,
  SceneDetail,
  SearchQuery,
  SearchQueryUpdateRequest,
  TaskAccepted,
} from '@/api/types';
import { control } from '@/mocks/control';
import { addAudit, db, newId, toUserBrief } from '@/mocks/db';
import type { DbCase, DbDecision } from '@/mocks/db/schema';
import { createTask, settleTasks, taskProgress } from '@/mocks/db/tasks';
import { nowKst } from '@/mocks/db/time';
import {
  activeDecisionFor,
  decidedByName,
  ensureQuery,
  findScene,
  routeCandidates,
  routePath,
  toCandidate,
  toDecision,
  visibleQueue,
} from '@/mocks/db/tracking';
import { paginate } from '@/mocks/handlers/cases';
import {
  MockError,
  readJson,
  requireCaseAccess,
  requireOpenCase,
  requireUser,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

const VERDICT_TEXT = { YES: '확정', NO: '제외', HOLD: '보류' } as const;

function toSearchQuery(c: DbCase): SearchQuery {
  const q = ensureQuery(c);
  return {
    images: q.images,
    time_from: q.time_from,
    time_to: q.time_to,
    threshold: q.threshold,
    threshold_default: db.state.settings.similarity_threshold_default,
  };
}

/** 이 사건에서 진행 중인 후보 검색 작업이 있으면 그 id */
function runningSearch(c: DbCase) {
  const q = ensureQuery(c);
  if (!q.search_task_id) return null;
  const t = db.state.tasks.find((x) => x.task_id === q.search_task_id);
  if (!t) return null;
  const { status } = taskProgress(t);
  return status === 'SUCCESS' || status === 'FAILURE' ? null : t.task_id;
}

function startSearch(c: DbCase, fakeCount = 0) {
  // 단계가 보이도록 폴링 간격(2.5초)과 같게: 0 → 40 → 80 → 100 에 약 7.5초
  const cameraCount = db.state.cameras.filter((x) => x.source === 'FIXED').length;
  const task = createTask(
    'CANDIDATE_SEARCH',
    { kind: 'search_done', case_id: c.id, fake_count: fakeCount },
    { stepMs: 2500, result: { searched_camera_count: cameraCount } },
  );
  ensureQuery(c).search_task_id = task.task_id;
  return task;
}

/** 파일 → data URL(작은 사진만). 큰 사진은 자리 표시 그림 */
async function toImageUrl(file: File) {
  if (file.size > 1.5 * 1024 * 1024) return '/mock/thumbnails/query-red.svg';
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${file.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

export const trackingHandlers = [
  // 검색 조건 조회(질의 바) · 사용자 · SYS02-002, 003
  http.get(
    '/api/cases/:caseId/query',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      return HttpResponse.json<SearchQuery>(toSearchQuery(c));
    }),
  ),

  // 검색 조건 수정 · 사용자 · SYS02-003
  http.patch(
    '/api/cases/:caseId/query',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const body = await readJson<SearchQueryUpdateRequest>(request);
      const q = ensureQuery(c);
      if (body.threshold !== undefined) {
        if (typeof body.threshold !== 'number' || body.threshold < 0 || body.threshold > 1)
          return validationError('threshold', 'Input should be between 0 and 1');
        q.threshold = Math.round(body.threshold * 100) / 100;
      }
      if (body.time_from) q.time_from = body.time_from;
      if (body.time_to !== undefined) q.time_to = body.time_to;
      db.save();
      return HttpResponse.json<SearchQuery>(toSearchQuery(c));
    }),
  ),

  // 기준 사진 업로드(특징 추출 작업 시작) · 사용자 · SYS02-002
  http.post(
    '/api/cases/:caseId/query/images',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const file = (await request.formData()).get('file');
      if (!(file instanceof File)) return validationError('file');
      if (file.type && !['image/jpeg', 'image/png'].includes(file.type))
        throw new MockError(415, 'UNSUPPORTED_FILE', 'jpg, png 사진만 올릴 수 있어요.');
      if (file.size > 10 * 1024 * 1024)
        throw new MockError(413, 'FILE_TOO_LARGE', '사진은 10MB까지 올릴 수 있어요.');
      const image = {
        id: newId('qimg'),
        image_url: await toImageUrl(file),
        source: 'UPLOAD' as const,
        ready: false,
      };
      const task = createTask('QUERY_EMBEDDING', {
        kind: 'image_ready',
        case_id: c.id,
        image_id: image.id,
      });
      ensureQuery(c).images.push(image);
      db.save();
      return HttpResponse.json<QueryImageAccepted>(
        { task_id: task.task_id, image },
        { status: 202 },
      );
    }),
  ),

  // 기준 사진 삭제 · 사용자 · SYS02-002
  http.delete(
    '/api/cases/:caseId/query/images/:imageId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const q = ensureQuery(c);
      if (!q.images.some((i) => i.id === params.imageId))
        throw new MockError(404, 'NOT_FOUND', '기준 사진을 찾을 수 없어요.');
      q.images = q.images.filter((i) => i.id !== params.imageId);
      db.save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // 후보 검색 실행 · 사용자 · SYS02-003
  http.post(
    '/api/cases/:caseId/searches',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      settleTasks();
      const q = ensureQuery(c);
      if (!q.images.some((i) => i.ready))
        throw new MockError(400, 'NO_QUERY_IMAGE', '특징 추출이 끝난 기준 사진이 없어요.');
      const running = runningSearch(c);
      if (running)
        throw new MockError(409, 'SEARCH_RUNNING', `이미 검색 중이에요. (task_id: ${running})`);
      // 시연용: 개발 패널에서 켜 두면 검색이 끝날 때 새 가짜 후보 1~2개
      const fake = control.get().fakeNewCandidates ? 1 + Math.round(Math.random()) : 0;
      const task = startSearch(c, fake);
      addAudit(user.id, 'SEARCH', `후보 검색 (유사도 기준 ${q.threshold.toFixed(2)})`, c.id);
      db.save();
      return HttpResponse.json<TaskAccepted>({ task_id: task.task_id }, { status: 202 });
    }),
  ),

  // 후보 대기열 · 사용자 · SYS02-003, 004
  http.get(
    '/api/cases/:caseId/candidates',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const url = new URL(request.url);
      const includeBelow = url.searchParams.get('include_below_threshold') === 'true';
      const all = visibleQueue(c.id, ensureQuery(c));
      const below = all.filter((x) => x.below_threshold);
      const items = includeBelow ? all : all.filter((x) => !x.below_threshold);
      const page = paginate(items, url);
      return HttpResponse.json<CandidatePage>({ ...page, below_threshold_count: below.length });
    }),
  ),

  // 예/아니오/보류 저장 · 사용자 · SYS02-004
  http.post(
    '/api/cases/:caseId/decisions',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const body = await readJson<DecisionRequest>(request);
      if (!body.candidate_id) return validationError('candidate_id');
      if (!body.kind || !['YES', 'NO', 'HOLD'].includes(body.kind)) return validationError('kind');
      const cand = db.state.candidates.find(
        (x) => x.id === body.candidate_id && x.case_id === c.id,
      );
      if (!cand) throw new MockError(404, 'NOT_FOUND', '후보를 찾을 수 없어요.');

      // 공동 담당자가 먼저 판단함(보류·재확인 필요는 다시 판단 가능)
      if (cand.status === 'CONFIRMED' || cand.status === 'REJECTED') {
        const prev = activeDecisionFor(cand.id);
        const name = prev ? decidedByName(prev) : '다른 담당자';
        const text = prev && prev.kind !== 'REVERT' ? VERDICT_TEXT[prev.kind] : '판단';
        throw new MockError(409, 'ALREADY_DECIDED', `${name}님이 먼저 ${text}했어요.`);
      }

      const d: DbDecision = {
        id: newId('dec'),
        case_id: c.id,
        candidate_id: cand.id,
        kind: body.kind,
        target_decision_id: null,
        reverted: false,
        decided_by: user.id,
        decided_at: nowKst(),
      };
      const threshold = ensureQuery(c).threshold;
      // 판단 전 기준점에서 본 유사도로 응답
      const before = toCandidate(cand, threshold);
      cand.status = body.kind === 'YES' ? 'CONFIRMED' : body.kind === 'NO' ? 'REJECTED' : 'HELD';
      cand.pinned = body.kind === 'HOLD' ? cand.pinned : false;
      db.state.decisions.unshift(d);
      // YES: 확정 장면 기준 재검색
      const task = body.kind === 'YES' ? startSearch(c) : null;
      const scene = findScene(cand.scene_id);
      addAudit(user.id, 'DECISION', `${scene?.camera_code ?? ''} ${VERDICT_TEXT[body.kind]}`, c.id);
      db.save();
      return HttpResponse.json<DecisionResponse>(
        {
          decision: toDecision(d),
          candidate: { ...before, status: cand.status },
          task_id: task?.task_id ?? null,
        },
        { status: 201 },
      );
    }),
  ),

  // 결정 기록(최신순) · 사용자 · SYS02-004, 010
  http.get(
    '/api/cases/:caseId/decisions',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      const list = db.state.decisions
        .filter((d) => d.case_id === c.id)
        .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
        .map(toDecision);
      return HttpResponse.json<Page<Decision>>(paginate(list, new URL(request.url)));
    }),
  ),

  // 판단 번복 · 사용자 · SYS02-010
  http.post(
    '/api/cases/:caseId/decisions/:decisionId/revert',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const target = db.state.decisions.find(
        (d) => d.id === params.decisionId && d.case_id === c.id,
      );
      if (!target) throw new MockError(404, 'NOT_FOUND', '판단 기록을 찾을 수 없어요.');
      if (target.kind === 'REVERT')
        throw new MockError(400, 'NOT_REVERTIBLE', '번복 기록은 다시 번복할 수 없어요.');
      if (target.reverted) throw new MockError(409, 'ALREADY_REVERTED', '이미 번복된 판단이에요.');
      if (activeDecisionFor(target.candidate_id)?.id !== target.id)
        throw new MockError(400, 'NOT_REVERTIBLE', '이 후보에 더 최근 판단이 있어요.');

      const cand = db.state.candidates.find((x) => x.id === target.candidate_id)!;
      const affected: RevertResponse['affected'] = [];
      let task = null;

      if (target.kind === 'YES') {
        const targetTime = findScene(cand.scene_id)?.start_at ?? '';
        // 그 뒤의 확정 장면은 재확인 필요
        for (const x of routeCandidates(c.id)) {
          if (
            x.id !== cand.id &&
            x.status === 'CONFIRMED' &&
            (findScene(x.scene_id)?.start_at ?? '') > targetTime
          ) {
            x.status = 'NEEDS_RECHECK';
            affected.push({ candidate_id: x.id, status: 'NEEDS_RECHECK' });
          }
        }
        cand.status = 'PENDING';
        task = startSearch(c);
      } else {
        // 아니오·보류 번복: 대기열로 복귀
        cand.status = 'PENDING';
        cand.pinned = true;
      }
      affected.unshift({ candidate_id: cand.id, status: 'PENDING' });
      target.reverted = true;
      const revert: DbDecision = {
        id: newId('dec'),
        case_id: c.id,
        candidate_id: cand.id,
        kind: 'REVERT',
        target_decision_id: target.id,
        reverted: false,
        decided_by: user.id,
        decided_at: nowKst(),
      };
      db.state.decisions.unshift(revert);
      addAudit(
        user.id,
        'REVERT',
        `${findScene(cand.scene_id)?.camera_code ?? ''} ${VERDICT_TEXT[target.kind]} 번복`,
        c.id,
      );
      db.save();
      return HttpResponse.json<RevertResponse>(
        { revert: toDecision(revert), affected, task_id: task?.task_id ?? null },
        { status: 201 },
      );
    }),
  ),

  // 확정 동선(타임라인 + 지도 경로) · 사용자 · SYS02-005
  http.get(
    '/api/cases/:caseId/route',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const q = ensureQuery(c);
      const scenes = routeCandidates(c.id).map((x, i) => {
        const d = activeDecisionFor(x.id);
        return {
          order: i + 1,
          candidate_id: x.id,
          scene: findScene(x.scene_id)!,
          status: x.status as 'CONFIRMED' | 'NEEDS_RECHECK',
          confirmed_by: toUserBrief(d?.decided_by ?? ''),
          confirmed_at: d?.decided_at ?? '',
        };
      });
      const pending =
        visibleQueue(c.id, q).find(
          (x) => !x.below_threshold && !x.out_of_filter && x.status === 'PENDING',
        ) ?? null;
      return HttpResponse.json<RouteResponse>({ scenes, path: routePath(c.id), pending });
    }),
  ),

  // 장면 상세(영상 재생기) · 사용자(맡은 사건에서 나온 장면) · SYS02-005
  http.get(
    '/api/scenes/:sceneId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const scene = findScene(String(params.sceneId));
      if (!scene) throw new MockError(404, 'NOT_FOUND', '장면을 찾을 수 없어요.');
      const cand = db.state.candidates.find((x) => x.scene_id === scene.id);
      if (cand) requireCaseAccess(user, cand.case_id);
      // 인물이 왼쪽에서 오른쪽으로 걸어가는 박스(0.5초 간격)
      const track = Array.from({ length: 9 }, (_, i) => ({
        t: scene.start_sec + i * 0.5,
        x: 0.25 + i * 0.04,
        y: 0.2,
        w: 0.18,
        h: 0.6,
      }));
      addAudit(user.id, 'VIDEO_VIEW', `${scene.camera_code} 장면 열람`, cand?.case_id ?? null);
      db.save();
      return HttpResponse.json<SceneDetail>({ scene, track });
    }),
  ),
];
