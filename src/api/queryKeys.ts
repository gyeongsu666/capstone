// TanStack Query 키. 무효화할 때도 이 함수들을 쓴다.
export const queryKeys = {
  me: ['auth', 'me'] as const,
  settings: ['settings'] as const,
  usersBrief: (q: string) => ['users', 'brief', q] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  cases: {
    all: ['cases'] as const,
    list: (params: object) => ['cases', 'list', params] as const,
    detail: (caseId: string) => ['cases', 'detail', caseId] as const,
    videos: (caseId: string) => ['cases', 'videos', caseId] as const,
  },
  tracking: {
    search: (caseId: string, searchId: string) => ['tracking', caseId, 'search', searchId] as const,
    /** 후보는 검색(search_id)마다 따로 캐시한다 */
    queue: (caseId: string, searchId?: string | null) =>
      searchId
        ? (['tracking', caseId, 'queue', searchId] as const)
        : (['tracking', caseId, 'queue'] as const),
    route: (caseId: string) => ['tracking', caseId, 'route'] as const,
    decisions: (caseId: string) => ['tracking', caseId, 'decisions'] as const,
    tracklet: (trackletId: string) => ['tracking', 'tracklet', trackletId] as const,
    caseScene: (caseId: string, sceneId: string) =>
      ['tracking', caseId, 'case-scene', sceneId] as const,
  },
  search: {
    area: (caseId: string) => ['search', caseId, 'area'] as const,
    watch: (caseId: string) => ['search', caseId, 'watch'] as const,
    alerts: (caseId: string) => ['search', caseId, 'alerts'] as const,
    pastAlerts: (caseId: string) => ['search', caseId, 'alerts', 'past'] as const,
    /** 미처리 출현 알림 수(R2) */
    pending: ['alerts', 'pending'] as const,
  },
  admin: {
    videosAll: ['admin', 'videos'] as const,
    videos: (params: object) => ['admin', 'videos', params] as const,
    videoStats: ['admin', 'videos', 'stats'] as const,
    usersAll: ['admin', 'users'] as const,
    users: (params: object) => ['admin', 'users', params] as const,
    audit: (params: object) => ['admin', 'audit', params] as const,
    retention: ['admin', 'retention'] as const,
    pendingDeletionsAll: ['admin', 'pending-deletions'] as const,
  },
  map: {
    cameras: (caseId?: string) => ['map', 'cameras', caseId ?? null] as const,
    dangerZones: ['map', 'danger-zones'] as const,
    walkEdges: ['map', 'walk-edges'] as const,
  },
};
