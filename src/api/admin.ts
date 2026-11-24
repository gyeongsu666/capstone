import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { idServer, pointServer, polygonServer } from '@/api/convert';
import type { S, ServerSystemSettings, ServerSystemSettingsPatch } from '@/api/server';
import type {
  AuditLog,
  Page,
  PendingDeletion,
  ResetPasswordResponse,
  Retention,
  TaskAccepted,
  User,
  UserCreateResponse,
  VideoAccepted,
  VideoPage,
} from '@/api/types';
import {
  fromServerSettingsForm,
  toAuditActionServer,
  toAuditLogView,
  toPageView,
  toPendingDeletionView,
  toRetentionView,
  toRoleServer,
  toUserView,
  toVideoPageView,
  type AuditActionView,
  type DangerKindView,
  type LatLngView,
  type PersonTypeView,
  type RetentionView,
  type RoleView,
  type SettingsFormView,
  type SeverityView,
} from '@/api/view';

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
