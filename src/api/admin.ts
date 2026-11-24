import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { isApiError, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { fetchAll, idServer, pointServer, polygonServer } from '@/api/convert';
import type {
  S,
  ServerSystemSettings,
  ServerSystemSettingsPatch,
  ServerVideoStats,
} from '@/api/server';
import {
  fromServerAudit,
  fromServerDeletionCandidate,
  fromServerRetention,
  fromServerSettingsForm,
  fromServerUser,
  fromServerVideo,
  fromServerVideoStats,
  type AnalysisStatusView,
  type DangerKindView,
  type LatLngView,
  type PersonTypeView,
  type RetentionView,
  type RoleView,
  type SettingsFormView,
  type SeverityView,
} from '@/api/view';

const VIDEO_STATUS_SERVER = {
  waiting: 'queued',
  processing: 'running',
  done: 'done',
  failed: 'failed',
} as const;

// ---------- 카메라·도보 경로·위험 지역 ----------

export interface CameraInput {
  /** 짧은 코드(C3). 서버에는 이름 앞에 붙여 "C3 학생회관"으로 보낸다 */
  code: string;
  name: string;
  location: LatLngView;
  directionDeg: number;
  fovDeg: number;
}

const cameraName = (code: string | undefined, name: string | undefined) =>
  [code?.trim().toUpperCase(), name?.trim()].filter(Boolean).join(' ') || undefined;

/** 다각형(화면) → GeoJSON Polygon([lng, lat], 닫힌 고리) */
export const toGeoJsonPolygon = polygonServer;

function useInvalidateMap() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['map'] });
}

export function useCreateCamera() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (v: CameraInput) =>
      request<S['CameraCreated']>('POST', '/cameras', {
        body: {
          kind: 'camera',
          name: cameraName(v.code, v.name)!,
          location: pointServer(v.location),
          direction_deg: v.directionDeg,
          field_of_view_deg: v.fovDeg,
        } satisfies S['CameraCreateRequest'],
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateCamera() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: ({ id, version, ...v }: Partial<CameraInput> & { id: string; version: number }) =>
      request<S['Camera']>('PATCH', `/cameras/${idServer(id)}`, {
        body: {
          name:
            v.code !== undefined || v.name !== undefined ? cameraName(v.code, v.name) : undefined,
          location: v.location ? pointServer(v.location) : undefined,
          direction_deg: v.directionDeg,
          field_of_view_deg: v.fovDeg,
          expected_version: version,
        } satisfies S['CameraPatch'],
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteCamera() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (id: string) => request<S['DeletedResponse']>('DELETE', `/cameras/${idServer(id)}`),
    onSuccess: invalidate,
  });
}

/** 도보 경로 다시 계산(수동 보정한 구간은 건드리지 않음) */
export function useRecalculateWalkEdges() {
  return useMutation({
    mutationFn: () =>
      request<S['TaskAccepted']>('POST', '/walk-graph/recalculations', {
        body: { include_manual: false } satisfies S['WalkRecalculateRequest'],
      }),
  });
}

/** 구간 거리·시간 직접 수정(source=manual로 저장) */
export function useCorrectWalkEdge() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (v: { id: string; version: number; distanceM: number; minutes: number }) =>
      request<S['WalkEdge']>('PATCH', `/walk-graph/${idServer(v.id)}`, {
        body: {
          distance_m: v.distanceM,
          duration_s: v.minutes * 60,
          expected_version: v.version,
        } satisfies S['WalkEdgePatch'],
      }),
    onSuccess: invalidate,
  });
}

export interface DangerZoneInput {
  name: string;
  kind: DangerKindView;
  severity: SeverityView;
  description?: string;
  polygon: LatLngView[];
}

export function useCreateDangerZone() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (v: DangerZoneInput) =>
      request<S['DangerZone']>('POST', '/danger-zones', {
        body: {
          name: v.name,
          kind: v.kind,
          severity: v.severity,
          description: v.description,
          geometry: polygonServer(v.polygon),
        } satisfies S['DangerZoneCreateRequest'],
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteDangerZone() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (id: string) =>
      request<S['DeletedResponse']>('DELETE', `/danger-zones/${idServer(id)}`),
    onSuccess: invalidate,
  });
}

/** 녹화 영상 목록(cursor "더 보기"). 분석 중인 영상이 있으면 2.5초마다 다시 받는다 */
export function useVideos(params: { status?: AnalysisStatusView; cameraId?: string }) {
  const query = {
    scope: 'global',
    status: params.status ? VIDEO_STATUS_SERVER[params.status] : undefined,
    camera_id: params.cameraId ? idServer(params.cameraId) : undefined,
  } as const;
  const result = useInfiniteQuery({
    queryKey: queryKeys.admin.videos(query),
    queryFn: ({ pageParam }) =>
      request<S['VideoPage']>('GET', '/videos', {
        query: { ...query, cursor: pageParam, limit: 30 },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      q.state.data?.pages.some((p) =>
        p.items.some((v) => v.analysis.status === 'queued' || v.analysis.status === 'running'),
      )
        ? 2500
        : false,
  });
  const items = result.data?.pages.flatMap((p) => p.items.map(fromServerVideo)) ?? [];
  return { ...result, items };
}

/**
 * 전역 녹화 영상 전체 현황(R7). 목록의 일부 페이지가 아니라 전체 집계.
 * 분석 중이면 2.5초, 아니면 30초마다(요청서 R7).
 */
export function useVideoStats(enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.videoStats,
    queryFn: () => request<ServerVideoStats>('GET', '/videos/stats'),
    select: fromServerVideoStats,
    enabled,
    refetchInterval: (q) => {
      const s = q.state.data?.by_status;
      return s && s.queued + s.running > 0 ? 2500 : 30_000;
    },
  });
}

function useInvalidateVideos() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.videosAll });
    qc.invalidateQueries({ queryKey: queryKeys.admin.videoStats });
  };
}

/** 녹화 영상 등록(전역 카메라). cameraId는 서버 camera_id */
export function useUploadVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: (v: { cameraId: string; file: File; recordedAt: string }) => {
      const form = new FormData();
      form.append('file', v.file);
      form.append('camera_id', String(idServer(v.cameraId)));
      form.append('recorded_start_at', v.recordedAt);
      return request<S['VideoAccepted']>('POST', '/videos', { formData: form });
    },
    onSuccess: invalidate,
  });
}

/** 실패한 영상 분석 재처리(새 task_id) */
export function useRetryVideo() {
  const invalidate = useInvalidateVideos();
  return useMutation({
    mutationFn: (id: string) =>
      request<S['VideoAccepted']>('POST', `/videos/${idServer(id)}/analysis`, {
        body: {} satisfies S['VideoRetryRequest'],
      }),
    onSuccess: invalidate,
  });
}

// ---------- 시스템 설정 ----------

export function useSettingsForm() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => request<ServerSystemSettings>('GET', '/settings'),
    select: fromServerSettingsForm,
  });
}

export type SettingsFormInput = Omit<SettingsFormView, 'updatedAt'>;

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SettingsFormInput) =>
      request<ServerSystemSettings>('PATCH', '/settings', {
        body: {
          walking_speed_presets: (
            Object.entries(v.walkSpeeds) as [
              PersonTypeView,
              SettingsFormInput['walkSpeeds']['adult'],
            ][]
          )
            .filter(([, p]) => p.speedMps !== null && p.maxSpeedMps !== null)
            .map(([t, p]) => ({
              person_type: t,
              speed_mps: p.speedMps!,
              max_speed_mps: p.maxSpeedMps!,
            })),
          default_similarity_threshold: v.similarityThresholdDefault ?? undefined,
          alert_high_threshold: v.alertHighThreshold ?? undefined,
          // R5: 비우면 null을 보내 예외 기준을 해제한다
          out_of_filter_threshold: v.outOfFilterThreshold ?? null,
          area_level_ratios: [v.areaLevelRatios.high, v.areaLevelRatios.mid, 1],
          area_buffer_m: v.areaBufferM ?? undefined,
          max_upload_bytes: v.maxUploadMb === null ? undefined : v.maxUploadMb * 1_000_000,
          expected_version: v.version,
        } satisfies ServerSystemSettingsPatch,
      }),
    onSuccess: (s) => qc.setQueryData(queryKeys.settings, s),
    // 버전 충돌: 최신 값을 다시 받는다(폼은 새 값으로 바뀌고, 사용자가 다시 저장한다)
    onError: (e) => {
      if (isApiError(e, 'VERSION_CONFLICT'))
        void qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

// ---------- 계정 ----------

/** 계정 목록(cursor "더 보기") */
export function useUsers(params: { q: string; role?: RoleView; active?: boolean }) {
  const query = { query: params.q || undefined, role: params.role, active: params.active };
  const result = useInfiniteQuery({
    queryKey: queryKeys.admin.users(query),
    queryFn: ({ pageParam }) =>
      request<S['UserPage']>('GET', '/users', {
        query: { ...query, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    placeholderData: keepPreviousData,
  });
  const items = result.data?.pages.flatMap((p) => p.items.map(fromServerUser)) ?? [];
  return { ...result, items };
}

/** 계정 전체(이용 기록 필터의 사용자 선택용) */
export function useAllUsers() {
  return useQuery({
    queryKey: [...queryKeys.admin.usersAll, 'all'],
    queryFn: () => fetchAll<S['User']>('/users'),
    select: (list) => list.map(fromServerUser),
    staleTime: 60_000,
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.usersAll });
    qc.invalidateQueries({ queryKey: ['users', 'brief'] });
  };
}

/** 계정 만들기: 서버가 임시 비밀번호를 만들어 이 응답에서 한 번만 준다 */
export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (v: { username: string; name: string; role: RoleView }) =>
      request<S['TemporaryPasswordResponse']>('POST', '/users', {
        body: { username: v.username, display_name: v.name, role: v.role },
      }),
    onSuccess: invalidate,
  });
}

/** 역할 변경(마지막 관리자는 바꿀 수 없음). 대상의 세션은 서버가 끊는다 */
export function useChangeRole() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (v: { id: string; role: RoleView; version: number }) =>
      request<S['User']>('PATCH', `/users/${idServer(v.id)}/role`, {
        body: { role: v.role, expected_version: v.version },
      }),
    onSettled: invalidate,
  });
}

/** 비활성화(되돌리는 기능 없음, D06). 사유 필수 */
export function useDeactivateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (v: { id: string; reason: string; version: number }) =>
      request<S['User']>('POST', `/users/${idServer(v.id)}/deactivate`, {
        body: { reason: v.reason, expected_version: v.version },
      }),
    onSettled: invalidate,
  });
}

/** 비밀번호 초기화: 새 임시 비밀번호(한 번만 표시). 사유 필수 */
export function useResetPassword() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (v: { id: string; reason: string; version: number }) =>
      request<S['TemporaryPasswordResponse']>('POST', `/users/${idServer(v.id)}/password-reset`, {
        body: { reason: v.reason, expected_version: v.version },
      }),
    onSettled: invalidate,
  });
}

// ---------- 이용 기록 ----------

export interface AuditFilter {
  from?: string;
  to?: string;
  userId?: string;
  caseId?: string;
  action?: string;
}

/** 이용 기록(최신순, cursor "더 보기") */
export function useAuditLogs(f: AuditFilter) {
  const query = {
    from: f.from,
    to: f.to,
    user_id: f.userId ? idServer(f.userId) : undefined,
    case_id: f.caseId ? idServer(f.caseId) : undefined,
    action: f.action,
  };
  const result = useInfiniteQuery({
    queryKey: queryKeys.admin.audit(query),
    queryFn: ({ pageParam }) =>
      request<S['AuditPage']>('GET', '/audit-logs', {
        query: { ...query, cursor: pageParam, limit: 50 },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    placeholderData: keepPreviousData,
  });
  const items = result.data?.pages.flatMap((p) => p.items.map(fromServerAudit)) ?? [];
  return { ...result, items };
}

// ---------- 데이터 보관 ----------

export function useRetention() {
  return useQuery({
    queryKey: queryKeys.admin.retention,
    queryFn: () => request<S['RetentionPolicy']>('GET', '/retention-policy'),
    select: fromServerRetention,
  });
}

export type RetentionInput = Pick<
  RetentionView,
  'videoDays' | 'closedCaseDays' | 'alertDays' | 'auditDays' | 'version'
> & { applyToExisting: boolean };

/** 보관 기간 저장. 이 요청으로 지우지는 않는다(D02) */
export function useSaveRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: RetentionInput) =>
      request<S['RetentionPolicy']>('PATCH', '/retention-policy', {
        body: {
          video_retention_days: v.videoDays,
          closed_case_retention_days: v.closedCaseDays,
          alert_retention_days: v.alertDays,
          audit_retention_days: v.auditDays,
          apply_to_existing: v.applyToExisting,
          expected_version: v.version,
        } satisfies S['RetentionPatch'],
      }),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.admin.retention, r);
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingDeletionsAll });
    },
    onError: (e) => {
      if (isApiError(e, 'VERSION_CONFLICT'))
        void qc.invalidateQueries({ queryKey: queryKeys.admin.retention });
    },
  });
}

/** 삭제 예정·보호 대상(조회만, cursor "더 보기") */
export function useDeletionCandidates() {
  const result = useInfiniteQuery({
    queryKey: queryKeys.admin.pendingDeletionsAll,
    queryFn: ({ pageParam }) =>
      request<S['DeletionCandidatePage']>('GET', '/deletion-candidates', {
        query: { cursor: pageParam, limit: 30 },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
  });
  const items = result.data?.pages.flatMap((p) => p.items.map(fromServerDeletionCandidate)) ?? [];
  return { ...result, items };
}
