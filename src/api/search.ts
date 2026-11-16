import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type {
  Alert,
  AlertResponseResult,
  SearchArea,
  TaskAccepted,
  UnreadCount,
  WatchState,
} from '@/api/types';
import { toAlertView, toSearchAreaView, toWatchView } from '@/api/view';

/** 출현 알림 폴링 간격(2~3초) */
const ALERT_POLL_MS = 2500;

// ---------- 엔드포인트 ----------

export const getSearchArea = (caseId: string) =>
  request<SearchArea>('GET', `/cases/${caseId}/search-area`);
export const recalculateSearchArea = (caseId: string) =>
  request<TaskAccepted>('POST', `/cases/${caseId}/search-area/recalculate`);
export const getWatch = (caseId: string) => request<WatchState>('GET', `/cases/${caseId}/watch`);
export const putWatch = (caseId: string, on: boolean) =>
  request<WatchState>('PUT', `/cases/${caseId}/watch`, { body: { status: on ? 'ON' : 'OFF' } });
export const getAlerts = (caseId: string) => request<Alert[]>('GET', `/cases/${caseId}/alerts`);
export const getUnreadCount = () => request<UnreadCount>('GET', '/alerts/unread-count');
export const respondAlert = (caseId: string, alertId: string, yes: boolean) =>
  request<AlertResponseResult>('POST', `/cases/${caseId}/alerts/${alertId}/response`, {
    body: { kind: yes ? 'YES' : 'NO' },
  });

// ---------- 훅 ----------

/** 현재 위치 범위(마지막 계산 결과). 확정 장면이 없으면 NO_CONFIRMED_SCENE 에러 */
export function useSearchArea(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.area(caseId),
    queryFn: () => getSearchArea(caseId),
    select: toSearchAreaView,
  });
}

export const isNoConfirmedScene = (e: unknown) => isApiError(e, 'NO_CONFIRMED_SCENE');

export function useRecalculateSearchArea(caseId: string) {
  return useMutation({ mutationFn: () => recalculateSearchArea(caseId) });
}

export function useWatch(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.watch(caseId),
    queryFn: () => getWatch(caseId),
    select: toWatchView,
    refetchInterval: 5000,
  });
}

export function useSetWatch(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => putWatch(caseId, on),
    onSuccess: (w) => qc.setQueryData(queryKeys.search.watch(caseId), w),
  });
}

/** 출현 알림(최신순). 2.5초마다 폴링 */
export function useAlerts(caseId: string) {
  return useQuery({
    queryKey: queryKeys.search.alerts(caseId),
    queryFn: () => getAlerts(caseId),
    select: (list) => list.map(toAlertView),
    refetchInterval: ALERT_POLL_MS,
  });
}

/** 사이드바 알림 숫자(모든 화면에서 폴링) */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: queryKeys.search.unread,
    queryFn: getUnreadCount,
    enabled,
    refetchInterval: ALERT_POLL_MS,
  });
}

/** 알림 예/아니오. YES면 확정 기록이 생기고 동선·범위가 바뀐다 */
export function useRespondAlert(caseId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.search.alerts(caseId) });
    qc.invalidateQueries({ queryKey: queryKeys.search.unread });
    qc.invalidateQueries({ queryKey: queryKeys.search.area(caseId) });
    qc.invalidateQueries({ queryKey: queryKeys.tracking.route(caseId) });
    qc.invalidateQueries({ queryKey: queryKeys.tracking.decisions(caseId) });
    qc.invalidateQueries({ queryKey: queryKeys.cases.all });
  };
  return useMutation({
    mutationFn: (v: { alertId: string; yes: boolean }) => respondAlert(caseId, v.alertId, v.yes),
    onSettled: invalidate,
  });
}
