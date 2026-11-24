// 현재 위치 범위 · 실시간 감시 · 출현 알림 (openapi.json + 요청서 R2)
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCase } from '@/api/cases';
import { isApiError, request } from '@/api/client';
import { idServer, idView, PAGE_LIMIT } from '@/api/convert';
import { queryKeys } from '@/api/queryKeys';
import type { S, ServerCase, ServerPendingCount } from '@/api/server';
import {
  fromServerAlert,
  fromServerCaseScene,
  fromServerSearchArea,
  fromServerWatch,
} from '@/api/view';

/** 출현 알림·미처리 수 폴링 간격(요청서 5장) */
const ALERT_POLL_MS = 2500;
/** 감시 상태 폴링 간격 */
const WATCH_POLL_MS = 5000;
/** 현재 위치 범위: 화면을 열 때와 이 간격마다 지금 시각 기준으로 다시 받는다(서버가 조회할 때 계산) */
const AREA_REFRESH_MS = 3 * 60_000;

const cid = (caseId: string) => idServer(caseId);

// ---------- 엔드포인트 ----------

export const getSearchArea = (caseId: string, asOf?: string) =>
  request<S['SearchArea']>('GET', `/cases/${cid(caseId)}/search-area`, {
    query: { as_of: asOf },
  });
export const getWatch = (caseId: string) =>
  request<S['WatchState']>('GET', `/cases/${cid(caseId)}/watch`);
export const putWatch = (caseId: string, body: S['WatchPut']) =>
  request<S['WatchState']>('PUT', `/cases/${cid(caseId)}/watch`, { body });
export const getAlerts = (caseId: string, status?: S['Alert']['status']) =>
  request<S['AlertPage']>('GET', `/cases/${cid(caseId)}/alerts`, {
    query: { status, limit: PAGE_LIMIT },
  });
export const getPendingCount = () => request<ServerPendingCount>('GET', '/alerts/pending-count');
export const postAlertDecision = (
  caseId: string,
  alertId: string,
  body: S['AlertDecisionRequest'],
) =>
  request<S['AlertDecisionResponse']>('POST', `/cases/${cid(caseId)}/alerts/${alertId}/decision`, {
    body,
  });
export const getCaseScene = (caseId: string, sceneId: string) =>
  request<S['CaseScene']>('GET', `/cases/${cid(caseId)}/scenes/${sceneId}`);

// ---------- 훅 ----------

/** 현재 위치 범위를 계산할 수 없는 경우(기준 위치 없음·경로 계산 불가·설정 미입력) */
export const areaUnavailableReason = (e: unknown): string | null => {
  if (isApiError(e, 'ORIGIN_MISSING')) return '기준 위치가 없어 현재 위치 범위를 계산할 수 없어요.';
  if (isApiError(e, 'ROUTE_UNAVAILABLE'))
    return '도보 경로를 계산할 수 없어 범위를 그릴 수 없어요.';
  if (isApiError(e, 'SETTINGS_NOT_CONFIGURED'))
    return '관리자가 시스템 설정(보행 속도·범위 비율)을 먼저 입력해야 해요.';
  return null;
};

/** 현재 위치 범위. 조회할 때 서버가 계산하므로 "새로고침" = 다시 조회 */
export function useSearchArea(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.area(caseId),
    queryFn: () => getSearchArea(caseId),
    select: fromServerSearchArea,
    refetchInterval: AREA_REFRESH_MS,
    retry: (n, e) => !areaUnavailableReason(e) && n < 2,
  });
}

export function useWatch(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.watch(caseId),
    queryFn: () => getWatch(caseId),
    select: fromServerWatch,
    refetchInterval: WATCH_POLL_MS,
  });
}

/** 감시 시작·중지. 사건 버전(expected_case_version)을 함께 보낸다 */
export function useSetWatch(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const c = await qc.fetchQuery({
        queryKey: queryKeys.cases.detail(caseId),
        queryFn: () => getCase(caseId),
        staleTime: 0,
      });
      return putWatch(caseId, { enabled, expected_case_version: c.version });
    },
    onSuccess: (w) => {
      qc.setQueryData(queryKeys.search.watch(caseId), w);
      qc.setQueryData<ServerCase>(queryKeys.cases.detail(caseId), (old) =>
        old ? { ...old, version: old.version + 1, watch_enabled: w.enabled } : old,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.cases.detail(caseId) }),
  });
}

/** 확인을 기다리는 출현 알림(pending, 최신순). 2.5초마다 첫 페이지를 다시 받는다 */
export function useAlerts(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.alerts(caseId),
    queryFn: () => getAlerts(caseId, 'pending'),
    select: (p) => p.items.map(fromServerAlert),
    refetchInterval: ALERT_POLL_MS,
  });
}

/** 지난 출현 알림(확인·거절된 것). 최근 한 페이지만 */
export function usePastAlerts(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.pastAlerts(caseId),
    queryFn: () => getAlerts(caseId),
    select: (p) => p.items.filter((a) => a.status !== 'pending').map(fromServerAlert),
    refetchInterval: 10_000,
  });
}

/** 사이드바 알림 숫자: 진행 중 사건의 미처리 알림(R2). 로그인 상태에서 모든 화면 폴링 */
export function usePendingCount(enabled = true) {
  return useQuery({
    queryKey: queryKeys.search.pending,
    queryFn: getPendingCount,
    enabled,
    select: (r) => ({
      count: r.count,
      byCase: r.by_case.map((x) => ({ caseId: idView(x.case_id), count: x.count })),
    }),
    refetchInterval: ALERT_POLL_MS,
  });
}

/** 알림 예/아니오. 예면 확정 목격으로 동선에 들어가고 범위·검색이 바뀐다 */
export function useDecideAlert(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { alertId: string; version: number; yes: boolean }) =>
      postAlertDecision(caseId, v.alertId, {
        decision: v.yes ? 'confirmed' : 'rejected',
        expected_version: v.version,
      }),
    // 알림·집계·사건·동선·검색 유효성을 다시 받는다(요청서 3.6)
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.search.alerts(caseId) });
      qc.invalidateQueries({ queryKey: queryKeys.search.pastAlerts(caseId) });
      qc.invalidateQueries({ queryKey: queryKeys.search.pending });
      qc.invalidateQueries({ queryKey: queryKeys.search.area(caseId) });
      qc.invalidateQueries({ queryKey: ['tracking', caseId] });
      qc.invalidateQueries({ queryKey: queryKeys.cases.all });
    },
  });
}

/** 사건 장면 상세(alert:{id} 등) → 재생할 장면 */
export function useCaseSceneDetail(caseId: string, sceneId: string | null) {
  return useQuery({
    queryKey: queryKeys.tracking.caseScene(caseId, sceneId ?? ''),
    queryFn: () => getCaseScene(caseId, sceneId!),
    enabled: !!sceneId,
    select: fromServerCaseScene,
    staleTime: 5 * 60_000,
  });
}
