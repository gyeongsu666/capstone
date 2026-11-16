import { create } from 'zustand';
import type { CandidateView } from '@/api/view';

export type TrackingMode = 'review' | 'map';

interface TrackingState {
  /** 검토(기본) / 지도 */
  mode: TrackingMode;
  /** 대기열에서 고른 후보. 없거나 대기열에서 빠지면 맨 위 후보 */
  selectedCandidateId: string | null;
  /** 지금 확인 영역에 보이는 후보(공동 담당자가 먼저 판단했을 때 그대로 보여주기 위해 기억) */
  focused: CandidateView | null;
  /** 내가 방금 판단한 후보(공동 담당자 판단 안내에서 뺀다) */
  myDecidedIds: string[];
  /** 사건별 진행 중인 후보 검색 작업 */
  searchTask: Record<string, string | null>;
  /** 이번에 후보 검색을 끝낸 사건(검색했는데 후보가 없는 경우 안내용) */
  searchedCases: string[];
  /** 사건별 진행 중인 기준 사진 특징 추출 작업 */
  embedTask: Record<string, string | null>;
  setMode: (mode: TrackingMode) => void;
  select: (candidateId: string | null) => void;
  setFocused: (c: CandidateView | null) => void;
  addMyDecided: (candidateId: string) => void;
  setSearchTask: (caseId: string, taskId: string | null) => void;
  setEmbedTask: (caseId: string, taskId: string | null) => void;
  markSearched: (caseId: string) => void;
}

/** 동선 추적 화면 상태 */
export const useTrackingStore = create<TrackingState>((set) => ({
  mode: 'review',
  selectedCandidateId: null,
  focused: null,
  myDecidedIds: [],
  searchTask: {},
  embedTask: {},
  searchedCases: [],
  setMode: (mode) => set({ mode }),
  select: (selectedCandidateId) => set({ selectedCandidateId }),
  setFocused: (focused) => set({ focused }),
  addMyDecided: (id) => set((s) => ({ myDecidedIds: [...s.myDecidedIds.slice(-50), id] })),
  setSearchTask: (caseId, taskId) =>
    set((s) => ({ searchTask: { ...s.searchTask, [caseId]: taskId } })),
  setEmbedTask: (caseId, taskId) =>
    set((s) => ({ embedTask: { ...s.embedTask, [caseId]: taskId } })),
  markSearched: (caseId) =>
    set((s) => ({
      searchedCases: s.searchedCases.includes(caseId)
        ? s.searchedCases
        : [...s.searchedCases, caseId],
    })),
}));
