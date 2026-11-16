// 색 규칙: docs/design.md "색", "지도 표현 규칙"
// 강조색은 Antd 기본 primary 파랑 하나. 역할마다 색을 바꾸지 않는다.

export const PRIMARY = '#1677ff';

/** 상태 색 */
export const statusColor = {
  /** 확정 */
  confirmed: '#16a34a',
  confirmedBg: '#dcfce7',
  /** 확인 대기·재확인 필요 */
  pending: '#d97706',
  pendingBg: '#fef3c7',
  /** 제외·번복 (회색 + 취소선) */
  excluded: '#8c8c8c',
  excludedBg: '#f0f0f0',
  /** 위험·실패·실시간 알림 */
  danger: '#dc2626',
  dangerBg: '#fee2e2',
} as const;

/** 현재 위치 범위 3단계: 보라 진하기 */
export const areaLevelColor = {
  HIGH: '#6d28d9',
  MID: '#8b5cf6',
  LOW: '#c4b5fd',
} as const;

/** 지도 요소 색 */
export const mapColor = {
  camera: PRIMARY,
  cameraNotAnalyzed: '#9ca3af',
  walkEdge: '#9ca3af',
  detour: statusColor.pending,
  dangerZone: statusColor.danger,
  route: statusColor.confirmed,
  routePending: statusColor.pending,
  currentCandidateRing: PRIMARY,
  liveAlert: statusColor.danger,
} as const;

/** 레이아웃 색 */
export const layoutColor = {
  siderBg: '#151c2c',
  siderItemHoverBg: '#1f2940',
  siderItemSelectedBg: '#243049',
  siderText: '#c9d1e0',
  siderTextMuted: '#7d8aa3',
  siderCardBg: '#1f2940',
  pageBg: '#f3f5f8',
} as const;
