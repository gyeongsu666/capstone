// 동선 추적: 기준 대상 · 검색 조건 · 후보 검색(search_id) · 판단 · 번복 · 동선 · 장면 (openapi.json)
import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCase } from '@/api/cases';
import { isApiError, request } from '@/api/client';
import { useSettings, useTaskPolling } from '@/api/common';
import { fetchAll, idServer, PAGE_LIMIT } from '@/api/convert';
import { queryKeys } from '@/api/queryKeys';
import type { S, ServerCase, ServerDecisionReverseRequest } from '@/api/server';
import {
  fromServerDecision,
  fromServerSearchRun,
  fromServerTracklet,
  fromServerTrackletScene,
  toQueryView,
  toQueue,
  toRoute,
  type CandidateView,
  type DecisionView,
  type SceneView,
  type TaskView,
  type VerdictView,
} from '@/api/view';
import { useTrackingStore } from '@/stores/tracking';

/** 공동 담당자의 판단이 보이도록 대기열·동선·기록을 주기적으로 다시 받는다 */
const SHARED_POLL_MS = 5000;
const VERDICT: Record<VerdictView, S['DecisionCreateRequest']['verdict']> = {
  yes: 'confirmed',
  no: 'rejected',
  hold: 'deferred',
};

const cid = (caseId: string) => idServer(caseId);

// ---------- 엔드포인트 ----------

export const patchConditions = (caseId: string, body: S['SearchConditionPatch']) =>
  request<S['SearchConditions']>('PATCH', `/cases/${cid(caseId)}/search-conditions`, { body });

export function uploadQueryPhoto(caseId: string, file: File, expectedQueryVersion: number) {
  const form = new FormData();
  form.append('photo', file);
  form.append('expected_query_version', String(expectedQueryVersion));
  return request<S['QueryAccepted']>('POST', `/cases/${cid(caseId)}/query/photo`, {
    formData: form,
  });
}

export const setQueryTracklet = (caseId: string, body: S['TrackletQueryRequest']) =>
  request<S['QueryTarget']>('POST', `/cases/${cid(caseId)}/query/tracklet`, { body });

export const createSearch = (caseId: string, body: S['SearchRequest']) =>
  request<S['SearchRun']>('POST', `/cases/${cid(caseId)}/searches`, { body });

export const getSearch = (caseId: string, searchId: string) =>
  request<S['SearchRun']>('GET', `/cases/${cid(caseId)}/searches/${searchId}`);

/** 한 검색의 후보(최대 100개 요청이라 한 페이지면 끝) */
export const getCandidates = (caseId: string, searchId: string) =>
  request<S['CandidatePage']>('GET', `/cases/${cid(caseId)}/candidates`, {
    query: { search_id: searchId, limit: PAGE_LIMIT },
  });

export const postDecision = (caseId: string, body: S['DecisionCreateRequest']) =>
  request<S['Decision']>('POST', `/cases/${cid(caseId)}/decisions`, { body });

export const getDecisions = (caseId: string) =>
  fetchAll<S['Decision']>(`/cases/${cid(caseId)}/decisions`);

export const postReverse = (
  caseId: string,
  decisionId: string,
  body: ServerDecisionReverseRequest,
) =>
  request<S['DecisionReverseResponse']>(
    'POST',
    `/cases/${cid(caseId)}/decisions/${decisionId}/reverse`,
    { body },
  );

export const getRoute = (caseId: string) =>
  request<S['ConfirmedRoute']>('GET', `/cases/${cid(caseId)}/route`);

export const getTrackletScene = (trackletId: string) =>
  request<S['TrackletScene']>('GET', `/tracklets/${trackletId}`);

export const getVideoTracklets = (videoId: number) =>
  fetchAll<S['Tracklet']>(`/videos/${videoId}/tracklets`);

// ---------- 무효화 ----------

function useInvalidateTracking(caseId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['tracking', caseId] });
    // 사이드바 사건 카드·사건 목록의 확정·대기 수, 사건 버전
    qc.invalidateQueries({ queryKey: queryKeys.cases.all });
  };
}

/** 사건(버전·기준 대상·검색 조건)을 서버에서 새로 받는다 */
function useFreshCase(caseId: string) {
  const qc = useQueryClient();
  return () =>
    qc.fetchQuery({
      queryKey: queryKeys.cases.detail(caseId),
      queryFn: () => getCase(caseId),
      staleTime: 0,
    });
}

// ---------- 조회 훅 ----------

/** 기준 대상 + 검색 조건(사건 응답에 들어 있다) */
export function useQueryConditions(caseId: string) {
  const { data: settings } = useSettings();
  const thresholdDefault = settings?.similarityThresholdDefault ?? null;
  return useQuery({
    queryKey: queryKeys.cases.detail(caseId),
    queryFn: () => getCase(caseId),
    select: (c: ServerCase) => toQueryView(c, thresholdDefault),
  });
}

/** 지금 보고 있는 검색: 화면에서 고른 것, 없으면 사건의 최근 검색(R6) */
export function useCurrentSearchId(caseId: string) {
  const picked = useTrackingStore((s) => s.searchId[caseId] ?? null);
  const { data: latest } = useQuery({
    queryKey: queryKeys.cases.detail(caseId),
    queryFn: () => getCase(caseId),
    select: (c: ServerCase) => c.latest_search?.search_id ?? null,
  });
  return picked ?? latest ?? null;
}

/** 사건의 최근 검색 id(공동 담당자가 새 검색을 만들었는지 알아보기용) */
export function useLatestSearchId(caseId: string) {
  const { data } = useQuery({
    queryKey: queryKeys.cases.detail(caseId),
    queryFn: () => getCase(caseId),
    select: (c: ServerCase) => c.latest_search?.search_id ?? null,
  });
  return data ?? null;
}

/** 검색 실행 상태. 실행 중이면 2.5초, 끝나면 5초마다(낡음 여부가 바뀔 수 있다) */
export function useSearchRun(caseId: string, searchId: string | null) {
  return useQuery({
    queryKey: queryKeys.tracking.search(caseId, searchId ?? ''),
    queryFn: () => getSearch(caseId, searchId!),
    enabled: !!searchId,
    select: fromServerSearchRun,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'queued' || s === 'running' ? 2500 : SHARED_POLL_MS;
    },
  });
}

/** 후보 대기열(검색이 끝났을 때만) */
export function useQueue(caseId: string, searchId: string | null, ready: boolean) {
  return useQuery({
    queryKey: queryKeys.tracking.queue(caseId, searchId),
    queryFn: () => getCandidates(caseId, searchId!),
    enabled: !!searchId && ready,
    select: (p) => toQueue(p.search, p.items),
    refetchInterval: SHARED_POLL_MS,
  });
}

function useServerDecisions(caseId: string) {
  return useQuery({
    queryKey: queryKeys.tracking.decisions(caseId),
    queryFn: () => getDecisions(caseId),
    refetchInterval: SHARED_POLL_MS,
  });
}

/** 재확인 필요 장면은 동선 응답에 없어서 트랙렛 상세로 채운다 */
function useRecheckScenes(decisions: S['Decision'][] | undefined) {
  const ids = (decisions ?? [])
    .filter((d) => d.status === 'active' && d.needs_reconfirmation && d.tracklet_id)
    .map((d) => d.tracklet_id!);
  // combine 결과는 내용이 같으면 같은 참조로 유지된다(TanStack 구조 공유)
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.tracking.tracklet(id),
      queryFn: () => getTrackletScene(id),
      staleTime: 5 * 60_000,
    })),
    combine: (results) =>
      results
        .map((r) => r.data)
        .filter((d): d is S['TrackletScene'] => !!d)
        .map((d) => fromServerTracklet(d.tracklet)),
  });
}

/** 확정 동선(타임라인 + 지도) */
export function useRoute(caseId: string) {
  const route = useQuery({
    queryKey: queryKeys.tracking.route(caseId),
    queryFn: () => getRoute(caseId),
    refetchInterval: SHARED_POLL_MS,
  });
  const { data: decisions } = useServerDecisions(caseId);
  const recheck = useRecheckScenes(decisions);
  const data = useMemo(
    () => (route.data ? toRoute(route.data, decisions ?? [], recheck) : undefined),
    [route.data, decisions, recheck],
  );
  return { ...route, data };
}

/**
 * 결정 기록. 서버 기록에는 장면 정보가 없어서 화면이 아는 장면(동선·대기열)으로 채운다(요청서 3.4).
 */
export function useDecisions(caseId: string, knownScenes: SceneView[]) {
  const q = useServerDecisions(caseId);
  const data = useMemo<DecisionView[]>(() => {
    const byId = new Map(knownScenes.map((s) => [s.id, s]));
    return (q.data ?? []).map((d) => fromServerDecision(d, (id) => byId.get(id)));
  }, [q.data, knownScenes]);
  return { ...q, data };
}

/** 장면 상세(영상 재생기: 장면 + 인물 박스 궤적) */
export function useSceneDetail(trackletId: string | null) {
  return useQuery({
    queryKey: queryKeys.tracking.tracklet(trackletId ?? ''),
    queryFn: () => getTrackletScene(trackletId!),
    enabled: !!trackletId,
    select: fromServerTrackletScene,
    staleTime: 5 * 60_000,
  });
}

// ---------- 작업 폴링 ----------

/** 검색 작업 진행률(단계 표시용). 끝나면 검색·대기열·사건을 다시 받는다 */
export function useSearchTask(
  caseId: string,
  taskId: string | null,
  onFinish?: (t: TaskView) => void,
) {
  const invalidate = useInvalidateTracking(caseId);
  const query = useTaskPolling(taskId, (t) => {
    invalidate();
    onFinish?.(t);
  });
  return taskId ? query.data : undefined;
}

/** 기준 사진 특징 추출 작업 폴링. 끝나면 자동으로 후보 검색을 시작한다 */
export function useEmbedTask(caseId: string, onFinish?: (t: TaskView) => void) {
  const taskId = useTrackingStore((s) => s.embedTask[caseId] ?? null);
  const setEmbedTask = useTrackingStore((s) => s.setEmbedTask);
  const invalidate = useInvalidateTracking(caseId);
  const runSearch = useRunSearch(caseId);
  const query = useTaskPolling(taskId, (t) => {
    setEmbedTask(caseId, null);
    invalidate();
    // 특징 추출이 끝나면 새 기준·조건 버전으로 검색(요청서 3.2)
    if (t.status === 'done') runSearch.mutate({});
    onFinish?.(t);
  });
  return { taskId, task: taskId ? query.data : undefined };
}

// ---------- 변경 훅 ----------

/**
 * 후보 검색 실행. 기준·조건 버전은 사건을 새로 받아 보낸다.
 * anchorDecisionId를 주면 그 확정 장면 기준(없으면 서버가 최초 목격 기준).
 */
export function useRunSearch(caseId: string) {
  const setSearchId = useTrackingStore((s) => s.setSearchId);
  const freshCase = useFreshCase(caseId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      anchorDecisionId?: string | null;
      direction?: 'forward' | 'backward';
    }) => {
      const c = await freshCase();
      return createSearch(caseId, {
        direction: v.direction ?? 'forward',
        anchor_decision_id: v.anchorDecisionId ?? undefined,
        max_candidates: 100,
        expected_query_version: c.query.query_version,
        expected_conditions_version: c.search_conditions.version,
      });
    },
    onSuccess: (run) => {
      setSearchId(caseId, run.search_id);
      qc.setQueryData(queryKeys.tracking.search(caseId, run.search_id), run);
      qc.invalidateQueries({ queryKey: queryKeys.cases.detail(caseId) });
    },
  });
}

/** 유사도 기준을 바꾸고 그 자리에서 다시 검색 */
export function useUpdateThreshold(caseId: string) {
  const freshCase = useFreshCase(caseId);
  const runSearch = useRunSearch(caseId);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: async (threshold: number) => {
      const c = await freshCase();
      await patchConditions(caseId, {
        similarity_threshold: threshold,
        expected_version: c.search_conditions.version,
      });
      return runSearch.mutateAsync({});
    },
    onSettled: invalidate,
  });
}

/** 기준 사진 올리기(한 장. 새로 올리면 바뀐다). 특징 추출이 끝나면 자동 검색 */
export function useUploadQueryPhoto(caseId: string) {
  const setEmbedTask = useTrackingStore((s) => s.setEmbedTask);
  const freshCase = useFreshCase(caseId);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: async (file: File) => {
      const c = await freshCase();
      return uploadQueryPhoto(caseId, file, c.query.query_version);
    },
    onSuccess: (res) => {
      setEmbedTask(caseId, res.task_id);
      invalidate();
    },
  });
}

/** 영상 속 인물(트랙렛)을 기준 대상으로. 특징을 복사하므로 바로 검색한다 */
export function useSetQueryTracklet(caseId: string) {
  const freshCase = useFreshCase(caseId);
  const runSearch = useRunSearch(caseId);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: async (trackletId: string) => {
      const c = await freshCase();
      await setQueryTracklet(caseId, {
        tracklet_id: trackletId,
        expected_query_version: c.query.query_version,
      });
      return runSearch.mutateAsync({});
    },
    onSettled: invalidate,
  });
}

/**
 * 예/아니오/보류 저장.
 * - 사건 버전(expected_case_version)은 화면이 가진 값으로 보내고, 성공하면 1 올려 둔다(서버도 1 올림).
 *   버전이 다르면(공동 담당자 판단) 409 VERSION_CONFLICT → 사건을 다시 받고 사용자가 다시 누른다.
 * - 보류한 후보는 보류를 번복한 뒤 새로 저장한다(한 트랙렛에 유효 판단은 하나).
 * - "예"면 그 확정 장면을 기준으로 다음 구간을 바로 검색한다.
 */
export function useDecide(caseId: string, searchId: string | null) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTracking(caseId);
  const freshCase = useFreshCase(caseId);
  const runSearch = useRunSearch(caseId);
  return useMutation({
    mutationFn: async (v: { candidate: CandidateView; verdict: VerdictView }) => {
      if (!searchId) throw new Error('검색이 없어요.');
      const c = qc.getQueryData<ServerCase>(queryKeys.cases.detail(caseId)) ?? (await freshCase());
      let version = c.version;
      if (v.candidate.status === 'held' && v.candidate.decisionId) {
        const held = qc
          .getQueryData<S['Decision'][]>(queryKeys.tracking.decisions(caseId))
          ?.find((d) => d.decision_id === v.candidate.decisionId);
        const res = await postReverse(caseId, v.candidate.decisionId, {
          expected_version: held?.version ?? 1,
        });
        version = res.case_version;
      }
      const decision = await postDecision(caseId, {
        tracklet_id: v.candidate.id,
        search_id: searchId,
        verdict: VERDICT[v.verdict],
        expected_case_version: version,
      });
      qc.setQueryData<ServerCase>(queryKeys.cases.detail(caseId), (old) =>
        old ? { ...old, version: version + 1 } : old,
      );
      return decision;
    },
    onSuccess: (d, v) => {
      // 판단한 후보를 대기열에서 바로 뺀다(다시 받기 전까지 같은 후보가 다시 보이지 않게)
      qc.setQueryData<S['CandidatePage']>(queryKeys.tracking.queue(caseId, searchId), (old) =>
        old
          ? {
              ...old,
              items: old.items.map((x) =>
                x.tracklet.tracklet_id === v.candidate.id
                  ? { ...x, decision: d.verdict, decision_id: d.decision_id }
                  : x,
              ),
            }
          : old,
      );
      invalidate();
      if (v.verdict === 'yes') runSearch.mutate({ anchorDecisionId: d.decision_id });
    },
    onError: (e) => {
      if (isApiError(e, 'VERSION_CONFLICT')) void freshCase();
      invalidate();
    },
  });
}

/** 판단 번복(되돌리기 알림은 사유 없이, 결정 기록 탭은 사유와 함께). 재검색은 하지 않는다 */
export function useRevert(caseId: string) {
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: (v: { decisionId: string; version: number; reason?: string }) =>
      postReverse(caseId, v.decisionId, {
        expected_version: v.version,
        reason: v.reason?.trim() || undefined,
      }),
    onSettled: invalidate,
  });
}
