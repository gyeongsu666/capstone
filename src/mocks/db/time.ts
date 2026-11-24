import type { DateTime } from '@/mocks/db/legacyTypes';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** epoch ms → "2026-10-19T15:02:00+09:00" */
export function toKst(ms: number): DateTime {
  return new Date(ms + KST_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+09:00');
}

/** 지금 시각(KST 문자열) */
export const nowKst = () => toKst(Date.now());

/** 기준 시각 R에서 분 단위로 떨어진 시각. 예: atR(R, -80) = 실종 시각 */
export const atR = (r: number, minutes: number) => toKst(r + minutes * 60_000);
