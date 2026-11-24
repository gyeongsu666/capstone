import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { request } from '@/api/client';
import { fetchAll, idServer, PAGE_LIMIT, pointServer } from '@/api/convert';
import { queryKeys } from '@/api/queryKeys';
import type { S, ServerCase, ServerCaseCreateRequest, ServerCasePage } from '@/api/server';
import {
  fromServerCase,
  fromServerVideo,
  type CloseReasonView,
  type LatLngView,
  type WalkSpeedPresetView,
} from '@/api/view';

// ---------- 엔드포인트 ----------

export const getCases = (params: {
  status?: 'open' | 'closed';
  query?: string;
  cursor?: string | null;
  limit?: number;
}) => request<ServerCasePage>('GET', '/cases', { query: params });

export const getCase = (caseId: string) => request<ServerCase>('GET', `/cases/${idServer(caseId)}`);

export const createCase = (body: ServerCaseCreateRequest) =>
  request<ServerCase>('POST', '/cases', { body });

export const closeCase = (caseId: string, body: S['CaseCloseRequest']) =>
  request<ServerCase>('POST', `/cases/${idServer(caseId)}/close`, { body });

export const addAssignee = (caseId: string, userId: string) =>
  request<S['AssigneeListResponse']>('POST', `/cases/${idServer(caseId)}/assignees`, {
    body: { user_id: idServer(userId) } satisfies S['AssigneeAddRequest'],
  });

export const removeAssignee = (caseId: string, userId: string) =>
  request<S['AssigneeListResponse']>(
    'DELETE',
    `/cases/${idServer(caseId)}/assignees/${idServer(userId)}`,
  );

export const getCaseVideos = (caseId: string) =>
  request<S['VideoPage']>('GET', `/cases/${idServer(caseId)}/videos`, {
    query: { limit: PAGE_LIMIT },
  });

export interface CaseVideoInput {
  file: File;
  /** 카메라 이름(선택, 예: 편의점 블랙박스) */
  name: string;
  location: LatLngView;
  directionDeg: number;
  recordedAt: string;
}

/** 사건 영상 추가: 사건 전용 카메라와 영상을 함께 만든다(화각 입력 없음, 요청서 3.7) */
export function addCaseVideo(caseId: string, v: CaseVideoInput) {
  const form = new FormData();
  form.append('file', v.file);
  form.append('longitude', String(v.location.lng));
  form.append('latitude', String(v.location.lat));
  form.append('direction_deg', String(v.directionDeg));
  form.append('recorded_start_at', v.recordedAt);
  if (v.name.trim()) form.append('camera_name', v.name.trim());
  return request<S['VideoAccepted']>('POST', `/cases/${idServer(caseId)}/videos`, {
    formData: form,
  });
}

// ---------- 훅 ----------

/** 사건 상세(서버 모양). 사이드바 사건 카드·사건 화면 접근 확인용 */
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
    select: fromServerCase,
    // 동선 추적에서는 공동 담당자의 판단으로 바뀐 확정·대기 수를 반영
    refetchInterval: options.poll ? 5000 : false,
  });
}

/** 사건 목록(cursor "더 보기"). 받은 페이지를 이어 붙여 돌려준다. */
export function useCaseList(params: { closed: boolean; q: string }) {
  const query = {
    status: params.closed ? 'closed' : 'open',
    query: params.q || undefined,
  } as const;
  const result = useInfiniteQuery({
    queryKey: queryKeys.cases.list(query),
    queryFn: ({ pageParam }) => getCases({ ...query, cursor: pageParam, limit: 30 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
    placeholderData: keepPreviousData,
  });
  const items = result.data?.pages.flatMap((p) => p.items.map(fromServerCase)) ?? [];
  return { ...result, items };
}

/** 사건 전체(이용 기록 필터 등 선택 목록용). 끝까지 받는다. */
export function useAllCases() {
  return useQuery({
    queryKey: [...queryKeys.cases.all, 'all'],
    queryFn: () => fetchAll<ServerCase>('/cases', {}),
    select: (list) => list.map(fromServerCase),
    staleTime: 60_000,
  });
}

export interface CaseCreateInput {
  title: string;
  personName: string;
  age: number | null;
  personType: WalkSpeedPresetView;
  description: string;
  missingAt: string;
  lastSeenPlace: { name: string; location: LatLngView };
  memberIds: string[];
}

/**
 * 사건 등록 → 공동 담당자는 /assignees로 따로 추가.
 * 배정이 일부 실패해도 사건은 다시 만들지 않고, 실패한 사람만 돌려준다(화면이 다시 시도).
 */
export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: CaseCreateInput) => {
      const c = await createCase({
        title: v.title,
        person_type: v.personType,
        appearance: v.description,
        last_seen_at: v.missingAt,
        last_seen_location: pointServer(v.lastSeenPlace.location),
        person_name: v.personName,
        person_age: v.age,
        last_seen_place_name: v.lastSeenPlace.name || null,
      });
      const caseId = String(c.case_id);
      const results = await Promise.allSettled(v.memberIds.map((id) => addAssignee(caseId, id)));
      const failedMemberIds = v.memberIds.filter((_, i) => results[i].status === 'rejected');
      return { caseData: c, failedMemberIds };
    },
    onSuccess: ({ caseData }) => {
      qc.invalidateQueries({ queryKey: queryKeys.cases.all });
      qc.setQueryData(queryKeys.cases.detail(String(caseData.case_id)), caseData);
    },
  });
}

export function useCloseCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { reason: CloseReasonView; note: string; foundAt?: string; version: number }) =>
      closeCase(caseId, {
        outcome: v.reason,
        reason: v.note,
        found_at: v.reason === 'found' ? (v.foundAt ?? null) : undefined,
        expected_version: v.version,
      }),
    onSuccess: (c) => {
      qc.setQueryData(queryKeys.cases.detail(caseId), c);
      qc.invalidateQueries({ queryKey: queryKeys.cases.all });
    },
    onError: () => qc.invalidateQueries({ queryKey: queryKeys.cases.detail(caseId) }),
  });
}

/** 공동 담당자 바꾸기: 지금 목록과 비교해 추가·제거 API를 하나씩 부른다 */
export function useSetCaseMembers(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { current: string[]; next: string[] }) => {
      const add = v.next.filter((id) => !v.current.includes(id));
      const remove = v.current.filter((id) => !v.next.includes(id));
      for (const id of add) await addAssignee(caseId, id);
      for (const id of remove) await removeAssignee(caseId, id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.cases.all }),
  });
}

export function useCaseVideos(caseId: string, options: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.cases.videos(caseId),
    queryFn: () => getCaseVideos(caseId),
    select: (p) => p.items.map(fromServerVideo),
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
