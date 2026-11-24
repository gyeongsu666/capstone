import { useMemo } from 'react';
import { useCameras, useDangerZones } from '@/api/map';
import type { CandidateView, RouteView } from '@/api/view';
import {
  CameraLayer,
  DangerZoneLayer,
  KakaoMap,
  LayerToggle,
  MapLegend,
  RouteLayer,
  useLayerToggle,
  type LayerOption,
} from '@/map';
import { findCamera, toRouteMap } from '@/pages/route-tracking/routeMap';

type LayerKey = 'camera' | 'route' | 'danger';
const OPTIONS: LayerOption<LayerKey>[] = [
  { key: 'camera', label: '카메라' },
  { key: 'route', label: '동선' },
  { key: 'danger', label: '위험 지역' },
];

interface TrackingMapProps {
  caseId: string;
  route: RouteView | undefined;
  /** 지금 확인 중인 후보(마지막 확정 지점에서 주황 점선) */
  pending?: CandidateView | null;
  /** 지금 확인 중인 후보의 카메라(파란 링). 장면의 camera_id */
  activeCameraId: string | null;
  /** 미니맵: 레이어 토글·범례 없이 작게 */
  mini?: boolean;
}

/** 동선 추적 지도(검토 모드 미니맵, 지도 모드 큰 지도) */
export function TrackingMap({
  caseId,
  route,
  pending = null,
  activeCameraId,
  mini = false,
}: TrackingMapProps) {
  const { data: cameras = [] } = useCameras(caseId);
  const { data: zones = [] } = useDangerZones();
  const { layers, toggle } = useLayerToggle<LayerKey>({ camera: true, route: true, danger: true });
  const routeMap = useMemo(() => toRouteMap(route, cameras, pending), [route, cameras, pending]);
  // 카메라 레이어는 지도 노드 id로 표시한다
  const activeNodeId = findCamera(cameras, activeCameraId)?.id ?? null;

  // 미니맵은 마지막 확정 지점과 지금 후보 카메라가 함께 보이게, 큰 지도는 전체 카메라
  const fitTo = useMemo(() => {
    if (!mini) return cameras.map((c) => c.location);
    const active = findCamera(cameras, activeCameraId)?.location;
    const last = routeMap.stops.at(-1)?.location;
    const pts = [last, active].filter((p): p is NonNullable<typeof p> => !!p);
    return pts.length ? pts : cameras.map((c) => c.location);
  }, [mini, cameras, activeCameraId, routeMap]);

  return (
    <KakaoMap
      fitTo={fitTo}
      level={mini ? 4 : 5}
      topLeft={
        mini ? undefined : <LayerToggle options={OPTIONS} value={layers} onToggle={toggle} />
      }
      bottomLeft={
        mini ? undefined : (
          <MapLegend
            items={[
              ...(layers.camera ? (['camera', 'caseCamera', 'currentCandidate'] as const) : []),
              ...(layers.route ? (['route', 'routePending'] as const) : []),
              ...(layers.danger ? (['danger'] as const) : []),
            ]}
          />
        )
      }
    >
      {(mini || layers.danger) && <DangerZoneLayer zones={zones} />}
      {(mini || layers.route) && <RouteLayer route={routeMap} />}
      {(mini || layers.camera) && (
        <CameraLayer cameras={cameras} activeCameraId={activeNodeId} showSectors={!mini} />
      )}
    </KakaoMap>
  );
}
