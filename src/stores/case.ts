import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 마지막으로 들어간 사건. 사이드바의 동선 추적·현재 위치 수색 메뉴가 이 사건으로 이동한다. */
interface CaseNavState {
  lastCaseId: string | null;
  setLastCaseId: (id: string | null) => void;
}

export const useCaseNavStore = create<CaseNavState>()(
  persist(
    (set) => ({
      lastCaseId: null,
      setLastCaseId: (lastCaseId) => set({ lastCaseId }),
    }),
    { name: 'refind-case-nav' },
  ),
);
