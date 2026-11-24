import { useQuery } from '@tanstack/react-query';
import { fetchAll } from '@/api/convert';
import { queryKeys } from '@/api/queryKeys';
import type { S } from '@/api/server';
import {
  fromServerCamera,
  fromServerDangerZone,
  fromServerWalkEdge,
  type CameraView,
} from '@/api/view';

// ---------- 엔드포인트 ----------

/** 카메라·보조 지점. caseId를 주면 그 사건 전용 카메라(사건 영상)도 포함 */
export const getCameras = (caseId?: string) =>
  fetchAll<S['Camera']>('/cameras', { case_id: caseId });

export const getDangerZones = () => fetchAll<S['DangerZone']>('/danger-zones');

export const getWalkEdges = () => fetchAll<S['WalkEdge']>('/walk-graph');

/**
 * 카메라 목록(화면용). 서버 카메라에는 사건 전용 여부가 없어서,
 * caseId가 있으면 전역 목록과 비교해 전역에 없는 카메라를 사건 영상 카메라로 본다.
 */
async function loadCameras(caseId?: string): Promise<CameraView[]> {
  if (!caseId) return (await getCameras()).map((c) => fromServerCamera(c, 'fixed'));
  const [global, withCase] = await Promise.all([getCameras(), getCameras(caseId)]);
  const globalIds = new Set(global.map((c) => c.node_id));
  return withCase.map((c) => fromServerCamera(c, globalIds.has(c.node_id) ? 'fixed' : 'case'));
}

// ---------- 훅 (화면용 타입으로 변환해서 돌려준다) ----------

/** 카메라 목록. caseId를 주면 그 사건의 사건 영상 카메라도 포함 */
export function useCameras(caseId?: string) {
  return useQuery({
    queryKey: queryKeys.map.cameras(caseId),
    queryFn: () => loadCameras(caseId),
    staleTime: 60_000,
  });
}

export function useDangerZones() {
  return useQuery({
    queryKey: queryKeys.map.dangerZones,
    queryFn: getDangerZones,
    select: (list) => list.map(fromServerDangerZone),
    staleTime: 60_000,
  });
}

/** 도보 구간(관리자). 경로선이 없는 구간은 카메라 위치로 곧게 그린다. */
export function useWalkEdges(enabled = true) {
  return useQuery({
    queryKey: queryKeys.map.walkEdges,
    queryFn: async () => {
      const [edges, cameras] = await Promise.all([getWalkEdges(), loadCameras()]);
      const nodes = new Map(cameras.map((c) => [c.id, c]));
      return edges.map((e) => fromServerWalkEdge(e, nodes));
    },
    enabled,
    staleTime: 60_000,
  });
}
