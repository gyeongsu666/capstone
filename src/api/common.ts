import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { PAGE_LIMIT } from '@/api/convert';
import { queryKeys } from '@/api/queryKeys';
import type { S, ServerSystemSettings } from '@/api/server';
import {
  fromServerSettings,
  fromServerTask,
  fromServerUserSummary,
  type TaskView,
} from '@/api/view';

// ---------- 엔드포인트 ----------

export const getTask = (taskId: string) => request<S['Task']>('GET', `/tasks/${taskId}`);
export const getSettings = () => request<ServerSystemSettings>('GET', '/settings');
/** 공동 담당 추가용 계정 검색(활성 계정의 이름·아이디·역할만) */
export const getUserDirectory = (query?: string) =>
  request<S['UserDirectoryPage']>('GET', '/users/directory', {
    query: { query, limit: PAGE_LIMIT },
  });

// ---------- 훅 ----------

/** 시스템 설정(보행 속도, 유사도 기본값 등) */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: getSettings,
    select: fromServerSettings,
    staleTime: 5 * 60_000,
  });
}

/** 담당자 선택용 계정 검색(활성 계정만) */
export function useUsersBrief(q = '') {
  return useQuery({
    queryKey: queryKeys.usersBrief(q),
    queryFn: () => getUserDirectory(q || undefined),
    select: (page) => page.items.map(fromServerUserSummary),
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
    select: fromServerTask,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'done' || s === 'failed' ? false : 2500;
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
