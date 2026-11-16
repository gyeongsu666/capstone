import { useCallback, useMemo, useState } from 'react';
import { App, Button } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { CustomOverlayMap, Polygon, Polyline } from 'react-kakao-maps-sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useRecalculateWalkEdges } from '@/api/admin';
import { isApiError } from '@/api/client';
import { useTaskPolling } from '@/api/common';
import { useCameras, useDangerZones, useWalkEdges } from '@/api/map';
import type { CameraView, LatLngView, WalkEdgeView } from '@/api/view';
import { MapFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import {
  CameraLayer,
  DangerZoneLayer,
  KakaoMap,
  LayerToggle,
  MapLegend,
  useLayerToggle,
  WalkEdgeLayer,
  type LayerOption,
} from '@/map';
import { sector } from '@/map/geo';
import { CameraPanel } from '@/pages/admin/camera-map/CameraPanel';
import { DangerZonePanel } from '@/pages/admin/camera-map/DangerZonePanel';
import { VideoStatusPanel } from '@/pages/admin/camera-map/VideoStatusPanel';
import { WalkEdgePanel } from '@/pages/admin/camera-map/WalkEdgePanel';
import { draftToPolygon, type ZoneDraft } from '@/pages/admin/camera-map/zoneDraft';
import { PRIMARY, statusColor } from '@/theme';

type LayerKey = 'camera' | 'danger' | 'edges';
const LAYER_OPTIONS: LayerOption<LayerKey>[] = [
  { key: 'camera', label: '카메라' },
  { key: 'danger', label: '위험 지역' },
  { key: 'edges', label: '경로 보기' },
];

/** 카메라 패널: 닫힘 / 새 카메라 / 선택한 카메라 */
type CameraEdit = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; camera: CameraView };

/** 카메라·지도 설정: 카메라 등록·수정, 도보 경로 계산·보정, 위험 지역 (SYS01-001~003) */
export function CameraMapPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data: cameras = [] } = useCameras();
  const { data: zones = [] } = useDangerZones();
  const { data: edges = [] } = useWalkEdges();
  const { layers, toggle } = useLayerToggle<LayerKey>({ camera: true, danger: true, edges: true });

  const [cameraEdit, setCameraEdit] = useState<CameraEdit>({ mode: 'none' });
  const [picking, setPicking] = useState(false);
  const [draftLocation, setDraftLocation] = useState<LatLngView | null>(null);
  const [preview, setPreview] = useState<{ directionDeg: number; fovDeg: number } | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [zoneDraft, setZoneDraft] = useState<ZoneDraft | null>(null);
  const [recalcTask, setRecalcTask] = useState<string | null>(null);

  const recalc = useRecalculateWalkEdges();
  const recalcQuery = useTaskPolling(recalcTask, (t) => {
    setRecalcTask(null);
    qc.invalidateQueries({ queryKey: ['map'] });
    if (t.status === 'done') message.success('도보 경로를 다시 계산했어요.');
    else message.error('도보 경로를 계산하지 못했어요.');
  });

  const codeById = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.code])), [cameras]);
  const fitTo = useMemo(
    () => [...cameras.map((c) => c.location), ...edges.flatMap((e) => e.path)],
    [cameras, edges],
  );
  const draftPolygon = useMemo(() => draftToPolygon(zoneDraft), [zoneDraft]);
  const editingCamera = cameraEdit.mode === 'edit' ? cameraEdit.camera : null;
  const onPreview = useCallback((p: { directionDeg: number; fovDeg: number }) => setPreview(p), []);

  const closeCameraPanel = () => {
    setCameraEdit({ mode: 'none' });
    setPicking(false);
    setDraftLocation(null);
    setPreview(null);
  };

  const onMapClick = (pos: LatLngView) => {
    if (zoneDraft) {
      setZoneDraft(
        zoneDraft.shape === 'polygon'
          ? { ...zoneDraft, points: [...zoneDraft.points, pos] }
          : { ...zoneDraft, center: pos },
      );
      return;
    }
    if (picking) {
      setDraftLocation(pos);
      setPicking(false);
    }
  };

  // 등록·수정 중인 카메라 위치(촬영 방향 미리보기)
  const previewLocation = draftLocation ?? editingCamera?.location ?? null;
  const recalcRunning = !!recalcTask;
  const fixedCount = cameras.filter((c) => c.source === 'fixed').length;

  return (
    <>
      <PageHeader
        title="카메라·지도 설정"
        summary={`카메라 ${fixedCount}대 · 경로 ${edges.length}쌍 · 위험 지역 ${zones.length}곳`}
        extra={
          <>
            <Button
              icon={<ReloadOutlined />}
              loading={recalcRunning || recalc.isPending}
              onClick={() =>
                recalc.mutate(undefined, {
                  onSuccess: (r) => setRecalcTask(r.task_id),
                  onError: (e) =>
                    message.error(isApiError(e) ? e.detail : '다시 계산하지 못했어요.'),
                })
              }
            >
              {recalcRunning
                ? `계산 중 ${recalcQuery.data?.progress ?? 0}%`
                : '도보 경로 다시 계산'}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setZoneDraft(null);
                setCameraEdit({ mode: 'new' });
                setDraftLocation(null);
                setPicking(true);
              }}
            >
              카메라 추가
            </Button>
          </>
        }
      />
      <MapFrame
        map={
          <KakaoMap
            fitTo={fitTo}
            onClick={onMapClick}
            topLeft={<LayerToggle options={LAYER_OPTIONS} value={layers} onToggle={toggle} />}
            bottomLeft={
              picking || zoneDraft ? (
                <span
                  style={{
                    padding: '4px 10px',
                    background: PRIMARY,
                    color: '#fff',
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                >
                  {zoneDraft
                    ? '지도를 눌러 위험 지역을 그리세요'
                    : '지도를 눌러 카메라 위치를 찍으세요'}
                </span>
              ) : (
                <MapLegend
                  items={[
                    ...(layers.camera ? (['camera', 'cameraNotAnalyzed', 'sector'] as const) : []),
                    ...(layers.edges ? (['walkEdge', 'detour'] as const) : []),
                    ...(layers.danger ? (['danger'] as const) : []),
                  ]}
                />
              )
            }
          >
            {layers.danger && <DangerZoneLayer zones={zones} />}
            {layers.edges && (
              <WalkEdgeLayer
                edges={edges}
                cameraCodeById={codeById}
                selectedEdgeId={selectedEdge}
                onSelect={(e: WalkEdgeView) => setSelectedEdge(e.id)}
              />
            )}
            {layers.camera && (
              <CameraLayer
                cameras={cameras}
                selectedCameraId={editingCamera?.id}
                onSelect={(c) => {
                  if (picking || zoneDraft) return;
                  setCameraEdit({ mode: 'edit', camera: c });
                  setDraftLocation(null);
                }}
              />
            )}
            {cameraEdit.mode !== 'none' && previewLocation && preview && (
              <Polygon
                path={sector(previewLocation, preview.directionDeg, preview.fovDeg, 60)}
                strokeWeight={1}
                strokeColor={PRIMARY}
                fillColor={PRIMARY}
                fillOpacity={0.35}
                zIndex={8}
              />
            )}
            {cameraEdit.mode !== 'none' && draftLocation && (
              <CustomOverlayMap position={draftLocation} zIndex={60}>
                <span
                  style={{
                    display: 'block',
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: PRIMARY,
                    border: '3px solid #fff',
                    boxShadow: `0 0 0 2px ${PRIMARY}`,
                  }}
                />
              </CustomOverlayMap>
            )}
            {draftPolygon.length >= 3 && (
              <Polygon
                path={draftPolygon}
                strokeWeight={2}
                strokeColor={statusColor.danger}
                strokeStyle="dash"
                fillColor={statusColor.danger}
                fillOpacity={0.15}
                zIndex={9}
              />
            )}
            {zoneDraft?.shape === 'polygon' && zoneDraft.points.length === 2 && (
              <Polyline path={zoneDraft.points} strokeColor={statusColor.danger} strokeWeight={2} />
            )}
            {zoneDraft?.shape === 'polygon' &&
              zoneDraft.points.map((p, i) => (
                <CustomOverlayMap key={i} position={p} zIndex={61}>
                  <span
                    style={{
                      display: 'block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#fff',
                      border: `2px solid ${statusColor.danger}`,
                    }}
                  />
                </CustomOverlayMap>
              ))}
          </KakaoMap>
        }
        panel={
          <>
            {cameraEdit.mode !== 'none' && (
              <CameraPanel
                key={editingCamera?.id ?? 'new'}
                camera={editingCamera}
                draftLocation={draftLocation}
                picking={picking}
                onPickLocation={() => setPicking((p) => !p)}
                onDone={closeCameraPanel}
                onPreview={onPreview}
              />
            )}
            <WalkEdgePanel
              edges={edges}
              codeById={codeById}
              selectedId={selectedEdge}
              onSelect={(e) => setSelectedEdge(e.id)}
            />
            <DangerZonePanel
              zones={zones}
              draft={zoneDraft}
              onDraftChange={(d) => {
                if (d) closeCameraPanel();
                setZoneDraft(d);
              }}
              draftPolygon={draftPolygon}
            />
            <VideoStatusPanel />
          </>
        }
      />
    </>
  );
}
