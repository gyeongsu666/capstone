import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, request } from '@/api/client';
import { queryClient } from '@/api/queryClient';
import { queryKeys } from '@/api/queryKeys';
import type {
  MessageResponse,
  ServerLoginRequest,
  ServerLoginResponse,
  ServerMeResponse,
  ServerPasswordChangeRequest,
  ServerPasswordChangeResponse,
} from '@/api/server';
import { fromServerUser } from '@/api/view';
import { useAuthStore } from '@/stores/auth';
import { useCaseNavStore } from '@/stores/case';

// 인증: 세션 쿠키 refind_session(HttpOnly, 서버가 붙임) + 변경 요청마다 X-CSRF-Token.
// 프론트는 쿠키를 다루지 않는다. 로그인 여부는 GET /auth/me 성공 여부로 판단한다.

// ---------- 엔드포인트 ----------

export const login = (body: ServerLoginRequest) =>
  request<ServerLoginResponse>('POST', '/auth/login', { body });

export const logout = () => request<MessageResponse>('POST', '/auth/logout');

/** R4(요청): 응답에 csrf_token을 넣어 달라고 요청함 */
export const getMe = () => request<ServerMeResponse>('GET', '/auth/me');

export const changePassword = (body: ServerPasswordChangeRequest) =>
  request<ServerPasswordChangeResponse>('POST', '/auth/password', { body });

// ---------- 세션 ----------

/** 새 세션 시작: 이전 계정의 캐시를 비우고 사용자·CSRF 토큰 저장 */
function startSession(res: ServerLoginResponse) {
  queryClient.clear();
  useCaseNavStore.getState().setLastCaseId(null);
  useAuthStore.getState().setSession(fromServerUser(res.user), res.csrf_token);
}

function endSession() {
  useAuthStore.getState().clearSession('manual');
  useCaseNavStore.getState().setLastCaseId(null);
  queryClient.clear();
}

/**
 * 앱을 열 때 한 번: 세션 쿠키가 살아 있으면 로그인 상태로 시작한다.
 * 401이면 로그인 안 함, 그 밖의 실패(서버 꺼짐 등)도 로그인 화면에서 다시 시도하게 한다.
 */
export async function bootstrapSession() {
  try {
    const me = await getMe();
    useAuthStore.getState().setSession(fromServerUser(me.user), me.csrf_token);
  } catch (e) {
    const expired = e instanceof ApiError && e.code === 'SESSION_EXPIRED';
    useAuthStore.getState().clearSession(expired ? 'expired' : null);
  }
}

// ---------- 훅 ----------

export function useLogin() {
  return useMutation({ mutationFn: login, onSuccess: startSession });
}

/** 서버 로그아웃이 실패해도 화면 세션은 지운다 */
export function useLogout() {
  return useMutation({ mutationFn: logout, onSettled: endSession });
}

/** 비밀번호를 바꾸면 서버가 세션을 회전한다: 새 CSRF 토큰과 사용자(must_change_password=false) */
export function useChangePassword() {
  return useMutation({
    mutationFn: changePassword,
    onSuccess: (res) =>
      useAuthStore.getState().setSession(fromServerUser(res.user), res.csrf_token),
  });
}

/** 로그인 뒤 화면을 열 때 내 정보를 다시 받아 역할 변경 등을 반영. 401이면 client가 세션을 지운다. */
export function useMeSync() {
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  const { data } = useQuery({ queryKey: queryKeys.me, queryFn: getMe, enabled: authenticated });
  useEffect(() => {
    if (data) useAuthStore.getState().setSession(fromServerUser(data.user), data.csrf_token);
  }, [data]);
}
