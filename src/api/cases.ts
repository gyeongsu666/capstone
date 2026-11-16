import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type {
  Case,
  CaseCreateRequest,
  CaseStatus,
  CaseVideo,
  CaseVideoAccepted,
  Page,
  UserBrief,
} from '@/api/types';
import {
  toCaseVideoView,
  toCaseView,
  toCloseReasonServer,
  toPageView,
  toWalkSpeedServer,
  type CloseReasonView,
  type LatLngView,
  type WalkSpeedPresetView,
} from '@/api/view';

// ---------- 엔드포인트 ----------

export const getCases = (params: {
  status?: CaseStatus;
  q?: string;
  page?: number;
  size?: number;
}) => request<Page<Case>>('GET', '/cases', { query: params });

export const getCase = (caseId: string) => request<Case>('GET', `/cases/${caseId}`);

export const createCase = (body: CaseCreateRequest) => request<Case>('POST', '/cases', { body });

export const closeCase = (caseId: string, reason: CloseReasonView, note?: string) =>
  request<Case>('POST', `/cases/${caseId}/close`, {
    body: { reason: toCloseReasonServer(reason), note: note || undefined },
  });

export const setCaseMembers = (caseId: string, memberIds: string[]) =>
  request<UserBrief[]>('PUT', `/cases/${caseId}/members`, { body: { member_ids: memberIds } });

export const getCaseVideos = (caseId: string) =>
  request<CaseVideo[]>('GET', `/cases/${caseId}/videos`);

export interface CaseVideoInput {
  file: File;
  name: string;
  location: LatLngView;
  directionDeg: number;
  fovDeg?: number;
  recordedAt: string;
}

export function addCaseVideo(caseId: string, v: CaseVideoInput) {
  const form = new FormData();
  form.append('file', v.file);
  form.append('name', v.name);
  form.append('lat', String(v.location.lat));
  form.append('lng', String(v.location.lng));
  form.append('direction_deg', String(v.directionDeg));
  if (v.fovDeg !== undefined) form.append('fov_deg', String(v.fovDeg));
  form.append('recorded_at', v.recordedAt);
  return request<CaseVideoAccepted>('POST', `/cases/${caseId}/videos`, { formData: form });
}

// ---------- 훅 ----------

/** 사건 상세(서버 모양). 화면은 useCaseView를 쓴다. */
export function useCase(caseId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.cases.detail(caseId ?? ''),
    queryFn: () => getCase(caseId!),
    enabled: !!caseId,
  });
}

/** 사건 상세(화면용) */
export function useCaseView(caseId: string | undefined, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.cases.detail(caseId ?? ''),
    queryFn: () => getCase(caseId!),
    enabled: !!caseId,
    select: toCaseView,
    // 동선 추적에서는 공동 담당자의 판단으로 바뀐 확정·대기 수를 반영
    refetchInterval: options.poll ? 5000 : false,
  });
}

export function useCaseList(params: { closed: boolean; q: string; page: number; size: number }) {
  const query = {
    status: (params.closed ? 'CLOSED' : 'OPEN') as CaseStatus,
    q: params.q || undefined,
    page: params.page,
    size: params.size,
  };
  return useQuery({
    queryKey: queryKeys.cases.list(query),
    queryFn: () => getCases(query),
    select: (p) => toPageView(p, toCaseView),
    placeholderData: keepPreviousData,
  });
}

export interface CaseCreateInput {
  personName: string;
  age: number;
  description: string;
  missingAt: string;
  lastSeenPlace: { name: string; location: LatLngView };
  walkSpeed: WalkSpeedPresetView;
  memberIds: string[];
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CaseCreateInput) =>
      createCase({
        missing_person: { name: v.personName, age: v.age, description: v.description },
        missing_at: v.missingAt,
        last_seen_place: v.lastSeenPlace,
        walk_speed_preset: toWalkSpeedServer(v.walkSpeed),
        member_ids: v.memberIds,
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.all });
      qc.setQueryData(queryKeys.cases.detail(c.id), c);
    },
  });
}

export function useCloseCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { reason: CloseReasonView; note?: string }) =>
      closeCase(caseId, v.reason, v.note),
    onSuccess: (c) => {
      qc.setQueryData(queryKeys.cases.detail(caseId), c);
      qc.invalidateQueries({ queryKey: queryKeys.cases.all });
    },
  });
}

export function useSetCaseMembers(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberIds: string[]) => setCaseMembers(caseId, memberIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.cases.all }),
  });
}

export function useCaseVideos(caseId: string, options: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.cases.videos(caseId),
    queryFn: () => getCaseVideos(caseId),
    select: (list) => list.map(toCaseVideoView),
    enabled: options.enabled ?? true,
    refetchInterval: options.poll ? 2500 : false,
  });
}

export function useAddCaseVideo(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CaseVideoInput) => addCaseVideo(caseId, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.videos(caseId) });
      qc.invalidateQueries({ queryKey: queryKeys.map.cameras(caseId) });
    },
  });
}
