import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Settings, Task, UserBrief } from '@/api/types';
import { toPersonView, toSettingsView, toTaskView, type TaskView } from '@/api/view';

// ---------- 엔드포인트 ----------

export const getTask = (taskId: string) => request<Task>('GET', `/tasks/${taskId}`);
export const getSettings = () => request<Settings>('GET', '/settings');
export const getUsersBrief = (q?: string) =>
  request<UserBrief[]>('GET', '/users/brief', { query: { q } });

// ---------- 훅 ----------

/** 시스템 설정(보행 속도, 유사도 기본값 등) */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: getSettings,
    select: toSettingsView,
    staleTime: 5 * 60_000,
  });
}

/** 담당자 선택용 계정 검색(활성 계정만) */
export function useUsersBrief(q = '') {
  return useQuery({
    queryKey: queryKeys.usersBrief(q),
    queryFn: () => getUsersBrief(q || undefined),
    select: (list) => list.map(toPersonView),
    staleTime: 60_000,
  });
}

/**
 * 오래 걸리는 작업 폴링: 2.5초마다 GET /tasks/{id}, 끝나면 멈추고 onFinish 호출.
 * onFinish에서 관련 쿼리를 무효화한다.
 */
export function useTaskPolling(
  taskId: string | null | undefined,
  onFinish?: (task: TaskView) => void,
) {
  const query = useQuery({
    queryKey: queryKeys.task(taskId ?? ''),
    queryFn: () => getTask(taskId!),
    enabled: !!taskId,
    select: toTaskView,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'SUCCESS' || s === 'FAILURE' ? false : 2500;
    },
  });

  const finished = useRef<string | null>(null);
  const callback = useRef(onFinish);
  useEffect(() => {
    callback.current = onFinish;
  });
  useEffect(() => {
    const t = query.data;
    if (!t || (t.status !== 'done' && t.status !== 'failed') || finished.current === t.id) return;
    finished.current = t.id;
    callback.current?.(t);
  }, [query.data]);

  return query;
}
