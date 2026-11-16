import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type {
  AuditLog,
  Camera,
  DangerZone,
  Page,
  PendingDeletion,
  ResetPasswordResponse,
  Retention,
  Settings,
  TaskAccepted,
  TargetType,
  User,
  UserCreateResponse,
  VideoAccepted,
  VideoPage,
  WalkEdge,
} from '@/api/types';
import {
  toAuditActionServer,
  toAuditLogView,
  toPageView,
  toPendingDeletionView,
  toRetentionView,
  toRoleServer,
  toSettingsFormView,
  toUserView,
  toVideoPageView,
  type AuditActionView,
  type LatLngView,
  type RetentionView,
  type RoleView,
  type SettingsFormView,
} from '@/api/view';

// ---------- 카메라·도보 경로·위험 지역 ----------

export interface CameraInput {
  code: string;
  name: string;
  location: LatLngView;
  directionDeg: number;
  fovDeg: number;
}

const cameraBody = (v: Partial<CameraInput>) => ({
  code: v.code,
  name: v.name,
  location: v.location,
  direction_deg: v.directionDeg,
  fov_deg: v.fovDeg,
});

/** 다각형(화면) → GeoJSON Polygon([lng, lat], 닫힌 고리) */
export function toGeoJsonPolygon(poly: LatLngView[]) {
  const ring = poly.map((p) => [p.lng, p.lat]);
  if (ring.length) ring.push([...ring[0]]);
  return { type: 'Polygon' as const, coordinates: [ring] };
}

function useInvalidateMap() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['map'] });
}

export function useCreateCamera() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (v: CameraInput) => request<Camera>('POST', '/cameras', { body: cameraBody(v) }),
    onSuccess: invalidate,
  });
}

export function useUpdateCamera() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: ({ id, ...v }: Partial<CameraInput> & { id: string }) =>
      request<Camera>('PATCH', `/cameras/${id}`, { body: cameraBody(v) }),
    onSuccess: invalidate,
  });
}

export function useDeleteCamera() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (id: string) => request<void>('DELETE', `/cameras/${id}`),
    onSuccess: invalidate,
  });
}

export function useRecalculateWalkEdges() {
  return useMutation({
    mutationFn: () => request<TaskAccepted>('POST', '/walk-edges/recalculate'),
  });
}

export function useCorrectWalkEdge() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (v: { id: string; distanceM: number | null; minutes: number | null }) =>
      request<WalkEdge>('PATCH', `/walk-edges/${v.id}`, {
        body: { corrected_distance_m: v.distanceM, corrected_minutes: v.minutes },
      }),
    onSuccess: invalidate,
  });
}

export interface DangerZoneInput {
  name: string;
  /** 실종자: 하천·공사장 / 범죄자: 인파 밀집 */
  targetType: 'missing' | 'criminal';
  polygon: LatLngView[];
}

const targetType = (t: DangerZoneInput['targetType']): TargetType =>
  t === 'missing' ? 'MISSING' : 'CRIMINAL';

export function useCreateDangerZone() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (v: DangerZoneInput) =>
      request<DangerZone>('POST', '/danger-zones', {
        body: {
          name: v.name,
          target_type: targetType(v.targetType),
          area: toGeoJsonPolygon(v.polygon),
        },
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteDangerZone() {
  const invalidate = useInvalidateMap();
  return useMutation({
    mutationFn: (id: string) => request<void>('DELETE', `/danger-zones/${id}`),
    onSuccess: invalidate,
  });
}

// ---------- 녹화 영상 ----------

export function useVideos(params: {
  status?: string;
  cameraId?: string;
  page: number;
  size: number;
}) {
  const query = {
    status: params.status || undefined,
    camera_id: params.cameraId || undefined,
    page: params.page,
    size: params.size,
  };
  return useQuery({
    queryKey: queryKeys.admin.videos(query),
    queryFn: () => request<VideoPage>('GET', '/videos', { query }),
    select: toVideoPageView,
    placeholderData: keepPreviousData,
    // 분석 중인 영상이 있으면 진행률을 2.5초마다 다시 받는다
    refetchInterval: (q) => {
      const s = q.state.data?.summary;
      return s && s.waiting + s.processing > 0 ? 2500 : false;
    },
  });
}

export function useUploadVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { cameraId: string; file: File; recordedAt: string }) => {
      const form = new FormData();
      form.append('camera_id', v.cameraId);
      form.append('file', v.file);
      form.append('recorded_at', v.recordedAt);
      return request<VideoAccepted>('POST', '/videos', { formData: form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.videosAll });
      qc.invalidateQueries({ queryKey: ['map'] });
    },
  });
}

export function useRetryVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<TaskAccepted>('POST', `/videos/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.videosAll }),
  });
}

// ---------- 시스템 설정 ----------

export function useSettingsForm() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => request<Settings>('GET', '/settings'),
    select: toSettingsFormView,
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Omit<SettingsFormView, 'updatedAt' | 'updatedByName'>) =>
      request<Settings>('PUT', '/settings', {
        body: {
          walk_speed_mps: {
            ADULT: v.walkSpeedMps.adult,
            CHILD: v.walkSpeedMps.child,
            ELDERLY: v.walkSpeedMps.elderly,
          },
          similarity_threshold_default: v.similarityThresholdDefault,
          confirm_request_threshold: v.confirmRequestThreshold,
          filter_margin_minutes: v.filterMarginMinutes,
          out_of_filter_threshold: v.outOfFilterThreshold,
          area_level_bounds: v.areaLevelBounds,
        },
      }),
    onSuccess: (s) => qc.setQueryData(queryKeys.settings, s),
  });
}

// ---------- 계정 ----------

export function useUsers(params: { q: string; role?: RoleView; active?: boolean; page: number }) {
  const query = {
    q: params.q || undefined,
    role: params.role ? toRoleServer(params.role) : undefined,
    active: params.active,
    page: params.page,
    size: 20,
  };
  return useQuery({
    queryKey: queryKeys.admin.users(query),
    queryFn: () => request<Page<User>>('GET', '/users', { query }),
    select: (p) => toPageView(p, toUserView),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.usersAll });
    qc.invalidateQueries({ queryKey: ['users', 'brief'] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (v: { username: string; name: string; role: RoleView }) =>
      request<UserCreateResponse>('POST', '/users', {
        body: { username: v.username, name: v.name, role: toRoleServer(v.role) },
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (v: { id: string; role?: RoleView; active?: boolean }) =>
      request<User>('PATCH', `/users/${v.id}`, {
        body: { role: v.role ? toRoleServer(v.role) : undefined, active: v.active },
      }),
    onSuccess: invalidate,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      request<ResetPasswordResponse>('POST', `/users/${id}/reset-password`),
  });
}

// ---------- 이용 기록 ----------

export interface AuditFilter {
  from?: string;
  to?: string;
  userId?: string;
  caseId?: string;
  action?: AuditActionView;
  page: number;
}

export function useAuditLogs(f: AuditFilter) {
  const query = {
    from: f.from,
    to: f.to,
    user_id: f.userId,
    case_id: f.caseId,
    action: f.action ? toAuditActionServer(f.action) : undefined,
    page: f.page,
    size: 20,
  };
  return useQuery({
    queryKey: queryKeys.admin.audit(query),
    queryFn: () => request<Page<AuditLog>>('GET', '/audit-logs', { query }),
    select: (p) => toPageView(p, toAuditLogView),
    placeholderData: keepPreviousData,
  });
}

// ---------- 데이터 보관 ----------

export function useRetention() {
  return useQuery({
    queryKey: queryKeys.admin.retention,
    queryFn: () => request<Retention>('GET', '/retention'),
    select: toRetentionView,
  });
}

export function useSaveRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: RetentionView) =>
      request<Retention>('PUT', '/retention', {
        body: { closed_case_days: v.closedCaseDays, raw_video_days: v.rawVideoDays },
      }),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.admin.retention, r);
      qc.invalidateQueries({ queryKey: queryKeys.admin.pendingDeletionsAll });
    },
  });
}

export function usePendingDeletions(page: number) {
  return useQuery({
    queryKey: queryKeys.admin.pendingDeletions(page),
    queryFn: () =>
      request<Page<PendingDeletion>>('GET', '/retention/pending-deletions', {
        query: { page, size: 10 },
      }),
    select: (p) => toPageView(p, toPendingDeletionView),
    placeholderData: keepPreviousData,
  });
}
