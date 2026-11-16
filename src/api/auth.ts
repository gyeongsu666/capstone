import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { queryClient } from '@/api/queryClient';
import { queryKeys } from '@/api/queryKeys';
import type { LoginRequest, LoginResponse, PasswordChangeRequest, User } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { useCaseNavStore } from '@/stores/case';

// ---------- 엔드포인트 ----------

export const login = (body: LoginRequest) =>
  request<LoginResponse>('POST', '/auth/login', { body });

export const logout = () => request<void>('POST', '/auth/logout');

export const getMe = () => request<User>('GET', '/auth/me');

export const changePassword = (body: PasswordChangeRequest) =>
  request<void>('POST', '/auth/password', { body });

// ---------- 세션 ----------

/** 새 세션 시작: 이전 계정의 캐시를 비우고 토큰·사용자 저장 */
export function startSession(token: string, user: User) {
  queryClient.clear();
  useCaseNavStore.getState().setLastCaseId(null);
  useAuthStore.getState().setSession(token, user);
}

function endSession() {
  useAuthStore.getState().clearSession('manual');
  useCaseNavStore.getState().setLastCaseId(null);
  queryClient.clear();
}

// ---------- 훅 ----------

export function useLogin() {
  return useMutation({
    mutationFn: login,
    onSuccess: (res) => startSession(res.access_token, res.user),
  });
}

/** 서버 로그아웃이 실패해도 화면 세션은 지운다 */
export function useLogout() {
  return useMutation({
    mutationFn: logout,
    onSettled: endSession,
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: changePassword,
    onSuccess: async () => {
      const me = await getMe();
      useAuthStore.getState().setUser(me);
    },
  });
}

/** 앱을 열 때 내 정보를 다시 받아 역할 변경 등을 반영. 401이면 client가 세션을 지운다. */
export function useMeSync() {
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);
  const { data } = useQuery({ queryKey: queryKeys.me, queryFn: getMe, enabled: !!token });
  useEffect(() => {
    if (data) setUser(data);
  }, [data, setUser]);
}
