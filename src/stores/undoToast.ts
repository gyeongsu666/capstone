import { create } from 'zustand';

export const UNDO_TOAST_MS = 8000;

interface UndoToastItem {
  id: number;
  message: string;
  onUndo: () => void;
}

interface UndoToastState {
  current: UndoToastItem | null;
  /** 새 알림이 앞 알림을 대신한다(한 번에 하나) */
  show: (message: string, onUndo: () => void) => void;
  hide: () => void;
}

let seq = 0;

/** 되돌리기 알림: 판단 직후 8초 */
export const useUndoToastStore = create<UndoToastState>((set) => ({
  current: null,
  show: (message, onUndo) => set({ current: { id: ++seq, message, onUndo } }),
  hide: () => set({ current: null }),
}));
