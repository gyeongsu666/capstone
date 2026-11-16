// 개발 패널이 바꾸는 가짜 서버 동작 설정
const STORAGE_KEY = 'refind-mock-control';

export type ForcedErrorStatus = 401 | 403 | 409 | 500;

interface ControlState {
  /** 300~800ms 응답 지연 */
  delayEnabled: boolean;
  /** "다시 검색"이 끝날 때 새 가짜 후보 1~2개를 만든다(시연용) */
  fakeNewCandidates: boolean;
  /** 다음 /api 요청 하나를 이 상태로 실패시킨다(한 번 쓰면 사라짐) */
  nextError: ForcedErrorStatus | null;
}

const DEFAULTS: ControlState = { delayEnabled: true, fakeNewCandidates: true, nextError: null };

function load(): ControlState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), nextError: null };
  } catch {
    // 무시
  }
  return { ...DEFAULTS };
}

let state = load();
const listeners = new Set<() => void>();

function set(patch: Partial<ControlState>) {
  state = { ...state, ...patch };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      delayEnabled: state.delayEnabled,
      fakeNewCandidates: state.fakeNewCandidates,
    }),
  );
  listeners.forEach((l) => l());
}

export const control = {
  get: () => state,
  setDelayEnabled: (delayEnabled: boolean) => set({ delayEnabled }),
  setFakeNewCandidates: (fakeNewCandidates: boolean) => set({ fakeNewCandidates }),
  setNextError: (nextError: ForcedErrorStatus | null) => set({ nextError }),
  /** 강제 에러를 꺼내 쓰고 비운다 */
  takeNextError() {
    const e = state.nextError;
    if (e !== null) set({ nextError: null });
    return e;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
