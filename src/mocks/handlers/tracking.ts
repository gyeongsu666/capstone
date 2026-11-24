// 동선 추적: 기준 대상·검색 조건·후보 검색·판단·번복·동선·장면 (openapi.json 모양)
import { bypass, http, HttpResponse } from 'msw';
import type { S, ServerDecisionReverseRequest } from '@/api/server';
import { addAudit, db, fromPubId, newId, pubId } from '@/mocks/db';
import type { DbCase, DbDecision } from '@/mocks/db/schema';
import {
  activeDecision,
  bumpCaseVersion,
  bumpEpoch,
  caseVersion,
  conditionsVersion,
  createSearch,
  decidedByName,
  isStale,
  nextDecisionId,
  queryVersion,
  sceneByTracklet,
  searchCandidates,
  searchStatus,
  toServerCandidate,
  toServerDecision,
  toServerMedia,
  toServerRouteScene,
  toServerSearchRun,
  toServerSegment,
  toServerTrackletScene,
  toServerTracklet,
  trackletId,
  trajectoryOf,
  videoIdOf,
} from '@/mocks/db/searches';
import { createTask, settleTasks, taskProgress } from '@/mocks/db/tasks';
import { nowKst } from '@/mocks/db/time';
import { ensureQuery, findScene, routeCandidates } from '@/mocks/db/tracking';
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

const VERDICT_KIND = { confirmed: 'YES', rejected: 'NO', deferred: 'HOLD' } as const;
const VERDICT_TEXT = { YES: '확정', NO: '제외', HOLD: '보류' } as const;

/** 파일 → data URL(작은 사진만). 큰 사진은 자리 표시 그림 */
async function toImageUrl(file: File) {
  if (file.size > 1.5 * 1024 * 1024) return '/mock/thumbnails/query-red.svg';
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${file.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

/** 정적 파일(가짜 썸네일·영상)을 인증된 파일 API처럼 돌려준다 */
async function serveStatic(url: string, request: Request) {
  const headers: Record<string, string> = {};
  const range = request.headers.get('Range');
  if (range) headers.Range = range;
  const res = await fetch(bypass(new Request(new URL(url, location.origin), { headers })));
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html'))
    throw new MockError(404, 'MEDIA_NOT_FOUND', '파일이 없어요(가짜 데이터).');
  return new HttpResponse(res.body, { status: res.status, headers: res.headers });
}

/** 진행 중인 후보 검색이 있으면 그 작업 */
function runningSearchTask(c: DbCase) {
  const q = ensureQuery(c);
  if (!q.search_task_id) return null;
  const t = db.state.tasks.find((x) => x.task_id === q.search_task_id);
  if (!t) return null;
  const { status } = taskProgress(t);
  return status === 'SUCCESS' || status === 'FAILURE' ? null : t;
}

/** 확정 이력이 있으면 기준 대상을 바꿀 수 없다(openapi.json) */
function requireNoConfirmedHistory(c: DbCase) {
  if (db.state.decisions.some((d) => d.case_id === c.id && d.kind === 'YES'))
    throw new MockError(
      409,
      'CONFIRMED_HISTORY_EXISTS',
      '확정한 장면이 있어 기준 대상을 바꿀 수 없어요.',
    );
}

function toQueryTarget(c: DbCase): S['QueryTarget'] {
  const q = ensureQuery(c);
  const img = q.images[0];
  const embedding = img && !img.ready;
  return {
    status: !img ? 'not_set' : embedding ? 'running' : 'ready',
    source_type: !img ? null : q.tracklet_scene_id ? 'tracklet' : 'photo',
    query_version: queryVersion(c),
    tracklet_id: q.tracklet_scene_id ? pubId(q.tracklet_scene_id) : null,
    photo_url: img && !q.tracklet_scene_id ? `/api/cases/${c.id}/query/photo` : null,
    model_name: img?.ready ? 'mock-reid' : null,
    embedding_dimension: img?.ready ? 512 : null,
    task_id: null,
    error_code: null,
    updated_at: new Date().toISOString(),
  };
}

function toConditions(c: DbCase): S['SearchConditions'] {
  return {
    case_id: Number(c.id),
    similarity_threshold: ensureQuery(c).threshold,
    alert_high_threshold: db.state.settings.alert_high_threshold,
    version: conditionsVersion(c),
    updated_at: new Date().toISOString(),
  };
}

function findSearch(c: DbCase, searchId: string | null | undefined) {
  const s = db.state.searches.find((x) => x.id === searchId && x.case_id === c.id);
  if (!s) throw new MockError(404, 'RESOURCE_NOT_FOUND', '검색을 찾을 수 없어요.');
  return s;
}

/** 사건에 속한 장면만(후보·판단에 나온 트랙렛) */
function caseScene(c: DbCase, tid: string) {
  const scene = sceneByTracklet(tid);
  const cand =
    scene && db.state.candidates.find((x) => x.scene_id === scene.id && x.case_id === c.id);
  if (!scene || !cand) throw new MockError(404, 'RESOURCE_NOT_FOUND', '장면을 찾을 수 없어요.');
  return { scene, cand };
}

export const trackingHandlers = [
  // 사건별 검색 조건 · 사용자 · SYS02-003
  http.get(
    '/api/cases/:caseId/search-conditions',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      return HttpResponse.json<S['SearchConditions']>(toConditions(c));
    }),
  ),

  // 사건별 유사도 기준 변경 · 사용자 · SYS02-003 (기존 검색은 stale)
  http.patch(
    '/api/cases/:caseId/search-conditions',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const b = await readJson<S['SearchConditionPatch']>(request);
      requireVersion(conditionsVersion(c), b.expected_version);
      if (
        typeof b.similarity_threshold !== 'number' ||
        b.similarity_threshold < 0 ||
        b.similarity_threshold > 1
      )
        return validationError('similarity_threshold', '0~1');
      const q = ensureQuery(c);
      q.threshold = Math.round(b.similarity_threshold * 100) / 100;
      q.conditions_version = conditionsVersion(c) + 1;
      addAudit(user.id, 'SEARCH', `유사도 기준 ${q.threshold.toFixed(2)}로 변경`, c.id);
      db.save();
      return HttpResponse.json<S['SearchConditions']>(toConditions(c));
    }),
  ),

  // 기준 사진 업로드·특징 추출 · 사용자 · SYS02-002 (사진 한 장. 새로 올리면 바뀐다)
  http.post(
    '/api/cases/:caseId/query/photo',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const form = await request.formData();
      const photo = form.get('photo');
      if (!(photo instanceof File)) return validationError('photo');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type))
        throw new MockError(422, 'INVALID_IMAGE', 'JPEG·PNG·WebP 사진만 올릴 수 있어요.');
      requireVersion(queryVersion(c), Number(form.get('expected_query_version')));
      requireNoConfirmedHistory(c);
      const image = {
        id: newId('qimg'),
        image_url: await toImageUrl(photo),
        source: 'UPLOAD' as const,
        ready: false,
      };
      const q = ensureQuery(c);
      q.images = [image];
      q.tracklet_scene_id = null;
      q.query_version = queryVersion(c) + 1;
      const task = createTask('QUERY_EMBEDDING', {
        kind: 'image_ready',
        case_id: c.id,
        image_id: image.id,
      });
      addAudit(user.id, 'SEARCH', '기준 사진 업로드', c.id);
      db.save();
      return HttpResponse.json<S['QueryAccepted']>(
        {
          case_id: Number(c.id),
          query_version: q.query_version,
          task_id: task.task_id,
          status: 'queued',
          status_url: `/api/tasks/${task.task_id}`,
        },
        { status: 202 },
      );
    }),
  ),

  // 기준 사진 파일 · 사용자
  http.get(
    '/api/cases/:caseId/query/photo',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      const img = ensureQuery(c).images[0];
      if (!img) throw new MockError(404, 'MEDIA_NOT_FOUND', '기준 사진이 없어요.');
      return serveStatic(img.image_url, request);
    }),
  ),

  // 영상 트랙렛을 기준 대상으로 · 사용자 · SYS02-002 (특징을 복사하므로 바로 준비됨)
  http.post(
    '/api/cases/:caseId/query/tracklet',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const b = await readJson<S['TrackletQueryRequest']>(request);
      if (!b.tracklet_id) return validationError('tracklet_id');
      requireVersion(queryVersion(c), b.expected_query_version);
      requireNoConfirmedHistory(c);
      const scene = sceneByTracklet(b.tracklet_id);
      if (!scene) throw new MockError(404, 'RESOURCE_NOT_FOUND', '트랙렛을 찾을 수 없어요.');
      const q = ensureQuery(c);
      q.images = [
        { id: newId('qimg'), image_url: scene.thumbnail_url, source: 'SCENE', ready: true },
      ];
      q.tracklet_scene_id = scene.id;
      q.query_version = queryVersion(c) + 1;
      addAudit(user.id, 'SEARCH', `기준 대상을 ${scene.camera_code} 장면으로`, c.id);
      db.save();
      return HttpResponse.json<S['QueryTarget']>(toQueryTarget(c));
    }),
  ),

  // 후보 검색 실행 · 사용자 · SYS02-003 (비동기 202 + search_id)
  http.post(
    '/api/cases/:caseId/searches',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      settleTasks();
      const b = await readJson<S['SearchRequest']>(request);
      if (b.direction !== 'forward' && b.direction !== 'backward')
        return validationError('direction');
      if (b.expected_query_version !== queryVersion(c))
        throw new MockError(
          409,
          'QUERY_VERSION_CONFLICT',
          '기준 대상이 바뀌었어요. 다시 불러온 뒤 검색하세요.',
        );
      requireVersion(conditionsVersion(c), b.expected_conditions_version);
      const q = ensureQuery(c);
      if (!q.images.some((i) => i.ready))
        throw new MockError(409, 'NO_QUERY_VECTOR', '특징 추출이 끝난 기준 대상이 없어요.');
      if (runningSearchTask(c))
        throw new MockError(409, 'QUERY_UPDATE_IN_PROGRESS', '이미 검색 중이에요.');
      let anchorDecisionId: string | null = null;
      if (b.anchor_decision_id) {
        const internal = fromPubId(b.anchor_decision_id);
        const d = db.state.decisions.find((x) => x.id === internal && x.case_id === c.id);
        if (!d || d.kind !== 'YES' || d.reverted)
          throw new MockError(422, 'ANCHOR_INVALID', '기준 판단은 유효한 확정이어야 해요.');
        anchorDecisionId = d.id;
      }
      const s = createSearch(c, { anchorDecisionId, direction: b.direction });
      addAudit(user.id, 'SEARCH', `후보 검색 (유사도 기준 ${q.threshold.toFixed(2)})`, c.id);
      db.save();
      return HttpResponse.json<S['SearchRun']>(toServerSearchRun(s), { status: 202 });
    }),
  ),

  // 검색 실행 상태 · 사용자
  http.get(
    '/api/cases/:caseId/searches/:searchId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      return HttpResponse.json<S['SearchRun']>(
        toServerSearchRun(findSearch(c, String(params.searchId))),
      );
    }),
  ),

  // 검색 후보·판단 근거 · 사용자 · SYS02-003, 004 (search_id 필수, 유사도 내림차순)
  http.get(
    '/api/cases/:caseId/candidates',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const searchId = new URL(request.url).searchParams.get('search_id');
      if (!searchId) return validationError('search_id');
      const s = findSearch(c, searchId);
      const status = searchStatus(s);
      if (status === 'failed') throw new MockError(409, 'SEARCH_FAILED', '검색이 실패했어요.');
      if (status !== 'done')
        throw new MockError(409, 'SEARCH_NOT_READY', '검색이 아직 끝나지 않았어요.');
      const items = searchCandidates(s).map(({ cand, v }) =>
        toServerCandidate(cand, v, s.threshold),
      );
      return HttpResponse.json<S['CandidatePage']>({
        search: toServerSearchRun(s),
        ...cursorPage(items, request),
      });
    }),
  ),

  // 예/아니오/보류 저장 · 사용자 · SYS02-004
  http.post(
    '/api/cases/:caseId/decisions',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      settleTasks();
      const b = await readJson<S['DecisionCreateRequest']>(request);
      if (!b.tracklet_id) return validationError('tracklet_id');
      if (!b.search_id) return validationError('search_id');
      if (!b.verdict || !(b.verdict in VERDICT_KIND)) return validationError('verdict');
      const s = findSearch(c, b.search_id);
      if (isStale(s))
        throw new MockError(
          409,
          'SEARCH_STALE',
          '검색 결과가 낡았어요. 다시 검색한 뒤 판단하세요.',
        );
      const hit = searchCandidates(s).find(
        ({ cand }) => trackletId(findScene(cand.scene_id)!) === b.tracklet_id,
      );
      if (!hit) throw new MockError(422, 'CANDIDATE_NOT_IN_SEARCH', '이 검색의 후보가 아니에요.');
      const cand = hit.cand;

      // 한 트랙렛에 유효 판단은 하나. 공동 담당자가 먼저 판단했으면 409
      const prev = activeDecision(cand.id);
      if (prev) {
        const text = prev.kind === 'REVERT' ? '판단' : VERDICT_TEXT[prev.kind];
        throw new MockError(
          409,
          'ALREADY_DECIDED',
          `${decidedByName(prev)}님이 먼저 ${text}했어요.`,
        );
      }
      requireVersion(caseVersion(c), b.expected_case_version);

      const kind = VERDICT_KIND[b.verdict];
      const d: DbDecision = {
        id: nextDecisionId(),
        case_id: c.id,
        candidate_id: cand.id,
        kind,
        target_decision_id: null,
        reverted: false,
        decided_by: user.id,
        decided_at: nowKst(),
        version: 1,
        search_id: s.id,
      };
      cand.status = kind === 'YES' ? 'CONFIRMED' : kind === 'NO' ? 'REJECTED' : 'HELD';
      if (kind !== 'HOLD') cand.pinned = false;
      db.state.decisions.unshift(d);
      bumpCaseVersion(c);
      // 확정하면 기준점이 바뀌므로 그 전 검색은 낡는다(아니오·보류는 같은 검색에서 계속 판단)
      if (kind === 'YES') bumpEpoch(c);
      const scene = findScene(cand.scene_id);
      addAudit(user.id, 'DECISION', `${scene?.camera_code ?? ''} ${VERDICT_TEXT[kind]}`, c.id);
      db.save();
      return HttpResponse.json<S['Decision']>(toServerDecision(d), { status: 201 });
    }),
  ),

  // 판단 기록 · 사용자 · SYS02-004, 010 (최신순, 번복은 원래 기록의 status=reversed)
  http.get(
    '/api/cases/:caseId/decisions',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      const url = new URL(request.url);
      const verdict = url.searchParams.get('verdict');
      const status = url.searchParams.get('status');
      const recheck = url.searchParams.get('needs_reconfirmation');
      const list = db.state.decisions
        .filter((d) => d.case_id === c.id && d.kind !== 'REVERT')
        .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
        .map(toServerDecision)
        .filter((d) => !verdict || d.verdict === verdict)
        .filter((d) => !status || d.status === status)
        .filter((d) => recheck === null || String(d.needs_reconfirmation) === recheck);
      return HttpResponse.json<S['DecisionPage']>(cursorPage(list, request));
    }),
  ),

  // 판단 번복 · 사용자 · SYS02-010 (사유 선택 R3. 재검색은 자동으로 하지 않는다)
  http.post(
    '/api/cases/:caseId/decisions/:decisionId/reverse',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const internal = fromPubId(String(params.decisionId));
      const target = db.state.decisions.find(
        (d) => d.id === internal && d.case_id === c.id && d.kind !== 'REVERT',
      );
      if (!target) throw new MockError(404, 'RESOURCE_NOT_FOUND', '판단 기록을 찾을 수 없어요.');
      const b = await readJson<ServerDecisionReverseRequest>(request);
      if (target.reverted)
        throw new MockError(409, 'DECISION_ALREADY_REVERSED', '이미 번복된 판단이에요.');
      requireVersion(target.version ?? 1, b.expected_version);
      if (b.reason !== undefined) {
        if (typeof b.reason !== 'string' || !b.reason.trim() || b.reason.trim().length > 500)
          return validationError('reason', '1~500자');
      }

      const cand = db.state.candidates.find((x) => x.id === target.candidate_id)!;
      const affected: S['AffectedScene'][] = [];
      if (target.kind === 'YES') {
        const targetTime = findScene(cand.scene_id)?.start_at ?? '';
        // 그 뒤의 확정 장면은 재확인 필요
        for (const x of routeCandidates(c.id)) {
          const sx = findScene(x.scene_id);
          if (x.id !== cand.id && x.status === 'CONFIRMED' && (sx?.start_at ?? '') > targetTime) {
            x.status = 'NEEDS_RECHECK';
            const dx = activeDecision(x.id);
            if (sx && dx)
              affected.push({
                source_type: 'tracklet',
                tracklet_id: trackletId(sx),
                alert_id: null,
                decision_id: pubId(dx.id),
                camera_id: Number(sx.camera_id),
                observed_at: new Date(sx.start_at).toISOString(),
                thumbnail_url: `/api/tracklets/${trackletId(sx)}/thumbnail`,
                reason: '앞선 확정이 번복됐어요',
                needs_reconfirmation: true,
              });
          }
        }
        cand.status = 'PENDING';
      } else {
        // 아니오·보류 번복: 후보로 돌아온다(아니오는 다음 유효한 검색에서 다시 판단)
        cand.status = 'PENDING';
        cand.pinned = true;
      }
      // 이 사건의 낡지 않은 검색은 모두 무효.
      // 단, 보류 번복은 동선·기준점에 영향이 없어 검색을 그대로 둔다(보류 후보를 같은 검색에서 다시 판단, 요청서 R3)
      const staling = target.kind !== 'HOLD';
      const invalidated = staling
        ? db.state.searches.filter((s) => s.case_id === c.id && !isStale(s)).map((s) => s.id)
        : [];
      target.reverted = true;
      target.version = (target.version ?? 1) + 1;
      db.state.decisions.unshift({
        id: newId('rev'),
        case_id: c.id,
        candidate_id: cand.id,
        kind: 'REVERT',
        target_decision_id: target.id,
        reverted: false,
        decided_by: user.id,
        decided_at: nowKst(),
        reason: b.reason?.trim() ?? null,
      });
      if (staling) bumpEpoch(c);
      bumpCaseVersion(c);
      addAudit(
        user.id,
        'REVERT',
        `${findScene(cand.scene_id)?.camera_code ?? ''} ${VERDICT_TEXT[target.kind as keyof typeof VERDICT_TEXT]} 번복${b.reason ? `: ${b.reason.trim()}` : ''}`,
        c.id,
      );
      db.save();
      return HttpResponse.json<S['DecisionReverseResponse']>({
        decision: toServerDecision(target),
        affected_scenes: affected,
        invalidated_search_ids: invalidated,
        case_version: caseVersion(c),
      });
    }),
  ),

  // 확정 목격 동선 · 사용자 · SYS02-005 (재확인 필요 장면은 빠진다)
  http.get(
    '/api/cases/:caseId/route',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const confirmed = routeCandidates(c.id).filter((x) => x.status === 'CONFIRMED');
      return HttpResponse.json<S['ConfirmedRoute']>({
        case_id: Number(c.id),
        case_version: caseVersion(c),
        scenes: confirmed.map(toServerRouteScene),
        segments: confirmed.slice(1).map((x, i) => toServerSegment(confirmed[i], x)),
        calculated_at: new Date().toISOString(),
      });
    }),
  ),

  // 사건 장면 상세 · 사용자 (scene_id = tracklet:{id})
  http.get(
    '/api/cases/:caseId/scenes/:sceneId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      const [kind, tid] = String(params.sceneId).split(':');
      if (kind !== 'tracklet' || !tid)
        throw new MockError(404, 'RESOURCE_NOT_FOUND', '장면을 찾을 수 없어요.');
      const { scene, cand } = caseScene(c, tid);
      addAudit(user.id, 'VIDEO_VIEW', `${scene.camera_code} 장면 열람`, c.id);
      db.save();
      return HttpResponse.json<S['CaseScene']>({
        scene: toServerRouteScene(cand),
        media: toServerMedia(scene),
        trajectory: trajectoryOf(scene),
        media_unavailable_reason: null,
      });
    }),
  ),

  // 트랙렛 장면 상세 · 사용자(맡은 사건의 후보이거나 전역 영상)
  http.get(
    '/api/tracklets/:trackletId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const scene = sceneByTracklet(String(params.trackletId));
      if (!scene) throw new MockError(404, 'RESOURCE_NOT_FOUND', '트랙렛을 찾을 수 없어요.');
      const cand = db.state.candidates.find((x) => x.scene_id === scene.id);
      if (cand) requireCaseAccess(user, cand.case_id);
      return HttpResponse.json<S['TrackletScene']>(toServerTrackletScene(scene));
    }),
  ),

  // 트랙렛 썸네일 파일 · 사용자
  http.get(
    '/api/tracklets/:trackletId/thumbnail',
    withMock(({ request, params }) => {
      requireUser(request);
      const scene = sceneByTracklet(String(params.trackletId));
      if (!scene) throw new MockError(404, 'MEDIA_NOT_FOUND', '썸네일이 없어요.');
      return serveStatic(scene.thumbnail_url, request);
    }),
  ),

  // 하이라이트 영상 · 사용자 (생성 방식 미정 D01: 가짜 서버는 준비 안 됨)
  http.get(
    '/api/tracklets/:trackletId/highlight',
    withMock(({ request }) => {
      requireUser(request);
      throw new MockError(409, 'HIGHLIGHT_NOT_READY', '하이라이트 영상이 아직 없어요.');
    }),
  ),

  // 영상 속 인물(트랙렛) 목록 · 사용자 · SYS02-002
  http.get(
    '/api/videos/:videoId/tracklets',
    withMock(({ request, params }) => {
      requireUser(request);
      const vid = Number(params.videoId);
      const list = db.state.scenes
        .filter((s) => videoIdOf(s) === vid)
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .map(toServerTracklet);
      return HttpResponse.json<S['TrackletPage']>(cursorPage(list, request));
    }),
  ),

  // 재생용 영상 스트림 · 사용자 (가짜 영상 파일이 있으면 그대로, 없으면 404)
  http.get(
    '/api/videos/:videoId/stream',
    withMock(({ request, params }) => {
      requireUser(request);
      const vid = Number(params.videoId);
      const scene = db.state.scenes.find((s) => videoIdOf(s) === vid);
      if (!scene?.video_url)
        throw new MockError(404, 'MEDIA_NOT_FOUND', '영상이 없어요(가짜 데이터).');
      return serveStatic(scene.video_url, request);
    }),
  ),
];
