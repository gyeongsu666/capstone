import { create } from 'zustand';
import type { UserView } from '@/api/view/types';

/** 로그인 화면에 보여줄 로그아웃 사유 */
export type LogoutReason = 'expired' | 'manual' | null;

/** unknown: 앱을 열고 /auth/me 응답을 기다리는 중 */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: UserView | null;
  /** 변경 요청의 X-CSRF-Token. 세션 쿠키(HttpOnly)와 달리 메모리에만 둔다. */
  csrfToken: string | null;
  logoutReason: LogoutReason;
  setSession: (user: UserView, csrfToken: string) => void;
  setUser: (user: UserView) => void;
  clearSession: (reason?: LogoutReason) => void;
}

// 로그인 상태는 서버 세션 쿠키가 기준이라 저장소에 남기지 않는다(새로고침하면 /auth/me로 다시 확인).
// 예전 토큰 저장 방식의 값이 남아 있으면 지운다.
localStorage.removeItem('refind-auth');

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'unknown',
  user: null,
  csrfToken: null,
  logoutReason: null,
  setSession: (user, csrfToken) =>
    set({ status: 'authenticated', user, csrfToken, logoutReason: null }),
  setUser: (user) => set({ user }),
  clearSession: (reason = 'manual') =>
    set({ status: 'anonymous', user: null, csrfToken: null, logoutReason: reason }),
}));

export const useIsAdmin = () => useAuthStore((s) => s.user?.role === 'admin');
