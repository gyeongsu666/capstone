import { useMemo } from 'react';
import { Card } from 'antd';
import { useCameras, useDangerZones, useWalkEdges } from '@/api/map';
import { areaView } from '@/api/convert';
import type { AreaLevelPolygons, PriorityZoneView, RouteMapView } from '@/api/view';
import type { S } from '@/api/server';
import { MapFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import {
  CameraLayer,
  DangerZoneLayer,
  KakaoMap,
  LayerToggle,
  LiveAlertMarker,
  MapLegend,
  RouteLayer,
  SearchAreaLayer,
  useLayerToggle,
  WalkEdgeLayer,
  type LayerOption,
} from '@/map';
// 개발 전용 페이지라 시나리오 좌표 계산을 바로 쓴다(동선·범위 API는 7·8단계에서 연결)
import {
  cameraId,
  cameraPos,
  MAP_CENTER,
  RESERVOIR_ENTRANCE,
  routePathFor,
  searchAreaLevels,
} from '@/mocks/scenario/map';
import { toPolygon } from '@/mocks/scenario/geometry';
import { CASE_IDS } from '@/mocks/scenario';

type LayerKey = 'camera' | 'danger' | 'edges' | 'route' | 'area' | 'alert';
const OPTIONS: LayerOption<LayerKey>[] = [
  { key: 'camera', label: '카메라' },
  { key: 'danger', label: '위험 지역' },
  { key: 'edges', label: '도보 경로' },
  { key: 'route', label: '동선' },
  { key: 'area', label: '현재 위치 범위' },
  { key: 'alert', label: '출현 알림' },
];

const route: RouteMapView = {
  stops: ['C1', 'C2', 'C3'].map((code, i) => ({
    order: i + 1,
    location: cameraPos(code),
    status: 'confirmed' as const,
  })),
  path: routePathFor(['C1', 'C2', 'C3']),
  pending: { path: [cameraPos('C3'), cameraPos('C4')], location: cameraPos('C4') },
};

const areaRaw = searchAreaLevels('C3');
const levels: AreaLevelPolygons[] = (
  [
    ['HIGH', 'high'],
    ['MID', 'mid'],
    ['LOW', 'low'],
  ] as const
).map(([key, level]) => ({
  level,
  polygons: areaView(areaRaw[key] as S['AreaGeometry']),
  maxMinutes: 0,
}));
const box = (lat: number, lng: number) =>
  toPolygon([
    { lat: lat + 0.0002, lng: lng - 0.0002 },
    { lat: lat + 0.0002, lng: lng + 0.0002 },
    { lat: lat - 0.0002, lng: lng + 0.0002 },
    { lat: lat - 0.0002, lng: lng - 0.0002 },
  ]);
const priorityZones = [
  {
    rank: 1,
    name: '가까운 건물 사이 통로',
    area: box(MAP_CENTER.lat - 0.0018, MAP_CENTER.lng + 0.0001),
  },
  {
    rank: 2,
    name: '학생회관 앞 광장',
    area: box(MAP_CENTER.lat - 0.0009, MAP_CENTER.lng + 0.0023),
  },
  {
    rank: 3,
    name: '도림제(저수지) 둘레길 입구',
    area: box(RESERVOIR_ENTRANCE.lat, RESERVOIR_ENTRANCE.lng),
  },
].map((z): PriorityZoneView => {
  const polygons = areaView(z.area as S['AreaGeometry']);
  const pts = polygons.flatMap((p) => p[0] ?? []);
  const n = Math.max(1, pts.length);
  return {
    rank: z.rank,
    name: z.name,
    reason: '',
    polygons,
    center: {
      lat: pts.reduce((s, p) => s + p.lat, 0) / n,
      lng: pts.reduce((s, p) => s + p.lng, 0) / n,
    },
  };
});

/** 지도 레이어 확인용(개발 모드에서만 /dev/map) */
export function MapPage() {
  const { data: cameras = [] } = useCameras(CASE_IDS.main);
  const { data: zones = [] } = useDangerZones();
  const { data: edges = [] } = useWalkEdges();
  const { layers, toggle } = useLayerToggle<LayerKey>({
    camera: true,
    danger: true,
    edges: false,
    route: true,
    area: true,
    alert: true,
  });
  const codeById = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.code])), [cameras]);
  const fitTo = useMemo(() => cameras.map((c) => c.location), [cameras]);

  return (
    <>
      <PageHeader title="지도 레이어 확인" summary="개발 모드 전용 · 가짜 서버 + 시나리오 좌표" />
      <MapFrame
        map={
          <KakaoMap
            fitTo={fitTo}
            topLeft={<LayerToggle options={OPTIONS} value={layers} onToggle={toggle} />}
            bottomLeft={
              <MapLegend
                items={[
                  ...(layers.camera
                    ? (['camera', 'cameraNotAnalyzed', 'caseCamera', 'currentCandidate'] as const)
                    : []),
                  ...(layers.edges ? (['walkEdge', 'detour'] as const) : []),
                  ...(layers.route ? (['route', 'routePending'] as const) : []),
                  ...(layers.area ? (['area'] as const) : []),
                  ...(layers.danger ? (['danger'] as const) : []),
                  ...(layers.alert ? (['liveAlert'] as const) : []),
                ]}
              />
            }
          >
            {layers.area && <SearchAreaLayer levels={levels} priorityZones={priorityZones} />}
            {layers.danger && <DangerZoneLayer zones={zones} />}
            {layers.edges && <WalkEdgeLayer edges={edges} cameraCodeById={codeById} />}
            {layers.route && <RouteLayer route={route} />}
            {layers.camera && <CameraLayer cameras={cameras} activeCameraId={cameraId('C4')} />}
            {layers.alert && <LiveAlertMarker position={cameraPos('C10')} label="C10 출현" />}
          </KakaoMap>
        }
        panel={
          <Card size="small" title="확인할 것">
            <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
              <li>카메라: 원(고정) / 네모(P1 사건 영상) / 회색(C12 분석 전)</li>
              <li>C4에 파란 링(지금 확인 중)</li>
              <li>동선 1·2·3 초록 실선, C3→C4 주황 점선 + ?</li>
              <li>
                현재 위치 범위: 길을 따라 퍼진 보라 3단계(동심원 아님), 남쪽이 도림제(저수지)와 겹침
              </li>
              <li>C10 빨간 원 + 퍼지는 링</li>
              <li>범례는 켜진 레이어만</li>
            </ul>
          </Card>
        }
      />
    </>
  );
}
