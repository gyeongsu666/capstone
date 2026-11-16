import { useQuery } from '@tanstack/react-query';
import { request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Camera, DangerZone, WalkEdge } from '@/api/types';
import { toCameraView, toDangerZoneView, toWalkEdgeView } from '@/api/view';

// ---------- 엔드포인트 ----------

export const getCameras = (caseId?: string) =>
  request<Camera[]>('GET', '/cameras', { query: { case_id: caseId } });

export const getDangerZones = () => request<DangerZone[]>('GET', '/danger-zones');

export const getWalkEdges = (detourOnly?: boolean) =>
  request<WalkEdge[]>('GET', '/walk-edges', { query: { detour_only: detourOnly } });

// ---------- 훅 (화면용 타입으로 변환해서 돌려준다) ----------

/** 카메라 목록. caseId를 주면 그 사건의 사건 영상 카메라도 포함 */
export function useCameras(caseId?: string) {
  return useQuery({
    queryKey: queryKeys.map.cameras(caseId),
    queryFn: () => getCameras(caseId),
    select: (list) => list.map(toCameraView),
    staleTime: 60_000,
  });
}

export function useDangerZones() {
  return useQuery({
    queryKey: queryKeys.map.dangerZones,
    queryFn: getDangerZones,
    select: (list) => list.map(toDangerZoneView),
    staleTime: 60_000,
  });
}

/** 도보 구간(관리자) */
export function useWalkEdges(enabled = true) {
  return useQuery({
    queryKey: queryKeys.map.walkEdges,
    queryFn: () => getWalkEdges(),
    select: (list) => list.map(toWalkEdgeView),
    enabled,
    staleTime: 60_000,
  });
}
