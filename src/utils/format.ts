import dayjs from 'dayjs';
import type {
  CloseReasonView,
  DangerKindView,
  SeverityView,
  WalkSpeedPresetView,
} from '@/api/view/types';

/** 24시간제 `15:02` */
export const formatTime = (t: string) => dayjs(t).format('HH:mm');

/** `10/19 15:02` */
export const formatDateTime = (t: string) => dayjs(t).format('MM/DD HH:mm');

/** 유사도 `0.71` */
export const formatSimilarity = (v: number) => v.toFixed(2);

/** 경과 분 → "32분 경과", "1시간 20분 경과" */
export function formatElapsedMinutes(minutes: number) {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}분 경과`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h}시간 ${rest}분 경과` : `${h}시간 경과`;
  const d = Math.floor(h / 24);
  return `${d}일 ${h % 24}시간 경과`;
}

/** 시각 → 지금까지 경과 */
export const formatElapsedSince = (t: string, now: number = Date.now()) =>
  formatElapsedMinutes((now - dayjs(t).valueOf()) / 60000);

/** "방금 전", "3분 전", "2시간 전" */
export function formatAgo(t: string, now: number = Date.now()) {
  const m = Math.floor((now - dayjs(t).valueOf()) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return formatDateTime(t);
}

export const roleViewLabel: Record<'admin' | 'user', string> = {
  admin: '관리자',
  user: '수색 담당자',
};

/** 화면용 값 라벨 */
export const closeReasonLabel: Record<CloseReasonView, string> = {
  found: '발견',
  unresolved: '미해결(수색 중단)',
  other: '기타',
};

export const walkSpeedViewLabel: Record<WalkSpeedPresetView, string> = {
  adult: '성인',
  child: '어린이',
  elderly: '노인',
  other: '기타',
};

/** 위험 지역 종류(백엔드 kind) */
export const dangerKindLabel: Record<DangerKindView, string> = {
  water: '하천·저수지',
  steep_slope: '급경사·산',
  road: '큰 도로',
  construction: '공사장',
  other: '기타',
};

/** 위험도(백엔드 severity) */
export const severityLabel: Record<SeverityView, string> = {
  low: '낮음',
  medium: '중간',
  high: '높음',
};
