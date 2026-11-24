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
  /**
   * 사건별로 지금 보고 있는 검색(search_id). 없으면 사건의 최근 검색(latest_search)을 쓴다.
   * 공동 담당자가 새 검색을 만들어도 판단 중인 화면을 바로 바꾸지 않는다.
   */
  searchId: Record<string, string | null>;
  /** 사건별 진행 중인 기준 사진 특징 추출 작업 */
  embedTask: Record<string, string | null>;
  setMode: (mode: TrackingMode) => void;
  select: (candidateId: string | null) => void;
  setFocused: (c: CandidateView | null) => void;
  addMyDecided: (candidateId: string) => void;
  setSearchId: (caseId: string, searchId: string | null) => void;
  setEmbedTask: (caseId: string, taskId: string | null) => void;
}

/** 동선 추적 화면 상태 */
export const useTrackingStore = create<TrackingState>((set) => ({
  mode: 'review',
  selectedCandidateId: null,
  focused: null,
  myDecidedIds: [],
  searchId: {},
  embedTask: {},
  setMode: (mode) => set({ mode }),
  select: (selectedCandidateId) => set({ selectedCandidateId }),
  setFocused: (focused) => set({ focused }),
  addMyDecided: (id) => set((s) => ({ myDecidedIds: [...s.myDecidedIds.slice(-50), id] })),
  setSearchId: (caseId, searchId) =>
    set((s) => ({ searchId: { ...s.searchId, [caseId]: searchId } })),
  setEmbedTask: (caseId, taskId) =>
    set((s) => ({ embedTask: { ...s.embedTask, [caseId]: taskId } })),
}));
