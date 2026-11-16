import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/api/types';

/** 로그인 화면에 보여줄 로그아웃 사유 */
export type LogoutReason = 'expired' | 'manual' | null;

interface AuthState {
  token: string | null;
  user: User | null;
  logoutReason: LogoutReason;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clearSession: (reason?: LogoutReason) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      logoutReason: null,
      setSession: (token, user) => set({ token, user, logoutReason: null }),
      setUser: (user) => set({ user }),
      clearSession: (reason = 'manual') => set({ token: null, user: null, logoutReason: reason }),
    }),
    {
      name: 'refind-auth',
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
);

export const useIsAdmin = () => useAuthStore((s) => s.user?.role === 'ADMIN');
