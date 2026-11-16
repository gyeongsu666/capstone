import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/api/client';
import { useTaskPolling } from '@/api/common';
import { queryKeys } from '@/api/queryKeys';
import type {
  CandidatePage,
  Decision,
  DecisionResponse,
  Page,
  QueryImageAccepted,
  RevertResponse,
  RouteResponse,
  SceneDetail,
  SearchQuery,
  TaskAccepted,
} from '@/api/types';
import {
  toDecisionViews,
  toQueryView,
  toQueueView,
  toRouteView,
  toSceneView,
  toTrackView,
  type TaskView,
  type VerdictView,
} from '@/api/view';
import { useTrackingStore } from '@/stores/tracking';

/** 공동 담당자의 판단이 보이도록 대기열·동선·기록을 주기적으로 다시 받는다 */
const SHARED_POLL_MS = 5000;

const VERDICT_KIND = { yes: 'YES', no: 'NO', hold: 'HOLD' } as const;

// ---------- 엔드포인트 ----------

export const getQuery = (caseId: string) => request<SearchQuery>('GET', `/cases/${caseId}/query`);
export const patchQuery = (caseId: string, body: { threshold?: number }) =>
  request<SearchQuery>('PATCH', `/cases/${caseId}/query`, { body });
export function uploadQueryImage(caseId: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<QueryImageAccepted>('POST', `/cases/${caseId}/query/images`, { formData: form });
}
export const deleteQueryImage = (caseId: string, imageId: string) =>
  request<void>('DELETE', `/cases/${caseId}/query/images/${imageId}`);
export const runSearch = (caseId: string) =>
  request<TaskAccepted>('POST', `/cases/${caseId}/searches`, { body: {} });
export const getCandidates = (caseId: string) =>
  request<CandidatePage>('GET', `/cases/${caseId}/candidates`, {
    query: { include_below_threshold: true, size: 100 },
  });
export const postDecision = (caseId: string, candidateId: string, verdict: VerdictView) =>
  request<DecisionResponse>('POST', `/cases/${caseId}/decisions`, {
    body: { candidate_id: candidateId, kind: VERDICT_KIND[verdict] },
  });
export const getDecisions = (caseId: string) =>
  request<Page<Decision>>('GET', `/cases/${caseId}/decisions`, { query: { size: 100 } });
export const postRevert = (caseId: string, decisionId: string) =>
  request<RevertResponse>('POST', `/cases/${caseId}/decisions/${decisionId}/revert`);
export const getRoute = (caseId: string) => request<RouteResponse>('GET', `/cases/${caseId}/route`);
export const getScene = (sceneId: string) => request<SceneDetail>('GET', `/scenes/${sceneId}`);

// ---------- 무효화 ----------

function useInvalidateTracking(caseId: string) {
  const qc = useQueryClient();
  return (
    what: { queue?: boolean; route?: boolean; decisions?: boolean; query?: boolean } = {},
  ) => {
    const all = Object.keys(what).length === 0;
    if (all || what.queue) qc.invalidateQueries({ queryKey: queryKeys.tracking.queue(caseId) });
    if (all || what.route) qc.invalidateQueries({ queryKey: queryKeys.tracking.route(caseId) });
    if (all || what.decisions)
      qc.invalidateQueries({ queryKey: queryKeys.tracking.decisions(caseId) });
    if (all || what.query) qc.invalidateQueries({ queryKey: queryKeys.tracking.query(caseId) });
    // 사이드바 사건 카드·사건 목록의 확정·대기 수
    qc.invalidateQueries({ queryKey: queryKeys.cases.all });
  };
}

// ---------- 조회 훅 ----------

export function useQueryConditions(caseId: string) {
  return useQuery({
    queryKey: queryKeys.tracking.query(caseId),
    queryFn: () => getQuery(caseId),
    select: toQueryView,
  });
}

export function useQueue(caseId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tracking.queue(caseId),
    queryFn: () => getCandidates(caseId),
    select: toQueueView,
    enabled,
    refetchInterval: SHARED_POLL_MS,
  });
}

export function useRoute(caseId: string) {
  return useQuery({
    queryKey: queryKeys.tracking.route(caseId),
    queryFn: () => getRoute(caseId),
    select: toRouteView,
    refetchInterval: SHARED_POLL_MS,
  });
}

export function useDecisions(caseId: string) {
  return useQuery({
    queryKey: queryKeys.tracking.decisions(caseId),
    queryFn: () => getDecisions(caseId),
    select: (p) => toDecisionViews(p.items),
    refetchInterval: SHARED_POLL_MS,
  });
}

/** 장면 상세(영상 재생기: 장면 + 인물 박스 궤적) */
export function useSceneDetail(sceneId: string | null) {
  return useQuery({
    queryKey: queryKeys.tracking.scene(sceneId ?? ''),
    queryFn: () => getScene(sceneId!),
    enabled: !!sceneId,
    select: (d) => ({ scene: toSceneView(d.scene), track: toTrackView(d.track) }),
    staleTime: 5 * 60_000,
  });
}

// ---------- 작업 폴링 ----------

/** 이 사건의 후보 검색 작업을 폴링하고, 끝나면 대기열·동선을 다시 받는다 */
export function useSearchTask(caseId: string, onFinish?: (t: TaskView) => void) {
  const taskId = useTrackingStore((s) => s.searchTask[caseId] ?? null);
  const setSearchTask = useTrackingStore((s) => s.setSearchTask);
  const invalidate = useInvalidateTracking(caseId);
  const markSearched = useTrackingStore((s) => s.markSearched);
  const query = useTaskPolling(taskId, (t) => {
    setSearchTask(caseId, null);
    if (t.status === 'done') markSearched(caseId);
    invalidate();
    onFinish?.(t);
  });
  return { taskId, task: taskId ? query.data : undefined };
}

/** 기준 사진 특징 추출 작업 폴링. 끝나면 자동으로 후보 검색을 시작한다 */
export function useEmbedTask(caseId: string, onFinish?: (t: TaskView) => void) {
  const taskId = useTrackingStore((s) => s.embedTask[caseId] ?? null);
  const setEmbedTask = useTrackingStore((s) => s.setEmbedTask);
  const setSearchTask = useTrackingStore((s) => s.setSearchTask);
  const invalidate = useInvalidateTracking(caseId);
  const query = useTaskPolling(taskId, async (t) => {
    setEmbedTask(caseId, null);
    invalidate({ query: true });
    if (t.status === 'done') {
      try {
        const { task_id } = await runSearch(caseId);
        setSearchTask(caseId, task_id);
      } catch {
        // 이미 검색 중 등: 다음 폴링에서 반영
      }
    }
    onFinish?.(t);
  });
  return { taskId, task: taskId ? query.data : undefined };
}

// ---------- 변경 훅 ----------

/** 유사도 기준을 바꾸고 그 자리에서 다시 검색 */
export function useUpdateThreshold(caseId: string) {
  const setSearchTask = useTrackingStore((s) => s.setSearchTask);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: async (threshold: number) => {
      await patchQuery(caseId, { threshold });
      return runSearch(caseId);
    },
    onSuccess: (res) => setSearchTask(caseId, res.task_id),
    onSettled: () => invalidate({ query: true }),
  });
}

export function useRunSearch(caseId: string) {
  const setSearchTask = useTrackingStore((s) => s.setSearchTask);
  return useMutation({
    mutationFn: () => runSearch(caseId),
    onSuccess: (res) => setSearchTask(caseId, res.task_id),
  });
}

export function useUploadQueryImage(caseId: string) {
  const setEmbedTask = useTrackingStore((s) => s.setEmbedTask);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: (file: File) => uploadQueryImage(caseId, file),
    onSuccess: (res) => {
      setEmbedTask(caseId, res.task_id);
      invalidate({ query: true });
    },
  });
}

export function useDeleteQueryImage(caseId: string) {
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: (imageId: string) => deleteQueryImage(caseId, imageId),
    onSuccess: () => invalidate({ query: true }),
  });
}

/**
 * 예/아니오/보류 저장. YES면 재검색 작업이 끝난 뒤 대기열을 다시 받는다
 * (그 전에 바뀐 대기열을 보여주지 않는다).
 */
export function useDecide(caseId: string) {
  const qc = useQueryClient();
  const setSearchTask = useTrackingStore((s) => s.setSearchTask);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: (v: { candidateId: string; verdict: VerdictView }) =>
      postDecision(caseId, v.candidateId, v.verdict),
    onSuccess: (res, v) => {
      // 판단한 후보를 대기열에서 바로 뺀다(다시 받기 전까지 같은 후보가 다시 보이지 않게)
      qc.setQueryData<CandidatePage>(queryKeys.tracking.queue(caseId), (old) =>
        old ? { ...old, items: old.items.filter((c) => c.id !== v.candidateId) } : old,
      );
      if (res.task_id) {
        setSearchTask(caseId, res.task_id);
        invalidate({ decisions: true, route: true });
      } else {
        invalidate();
      }
    },
    onError: () => invalidate(),
  });
}

/** 판단 번복(되돌리기 알림, 결정 기록 탭 모두) */
export function useRevert(caseId: string) {
  const setSearchTask = useTrackingStore((s) => s.setSearchTask);
  const invalidate = useInvalidateTracking(caseId);
  return useMutation({
    mutationFn: (decisionId: string) => postRevert(caseId, decisionId),
    onSuccess: (res) => {
      if (res.task_id) setSearchTask(caseId, res.task_id);
      invalidate();
    },
    onError: () => invalidate(),
  });
}
