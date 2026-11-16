import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Badge, Button, Card, List, Spin, Tag } from 'antd';
import { NodeIndexOutlined, ReloadOutlined, WarningFilled } from '@ant-design/icons';
import { useCaseView } from '@/api/cases';
import { isApiError } from '@/api/client';
import { useTaskPolling } from '@/api/common';
import { useCameras, useDangerZones } from '@/api/map';
import { queryKeys } from '@/api/queryKeys';
import {
  isNoConfirmedScene,
  useAlerts,
  useRecalculateSearchArea,
  useRespondAlert,
  useSearchArea,
  useSetWatch,
  useWatch,
} from '@/api/search';
import { useRoute } from '@/api/tracking';
import type { AreaLevelView, SceneView } from '@/api/view';
import { MapFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LiveAlertCard } from '@/components/LiveAlertCard';
import { SceneThumbnail } from '@/components/SceneThumbnail';
import { VideoPlayerModal } from '@/components/VideoPlayer';
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
  type LayerOption,
} from '@/map';
import { CaseManageMenu } from '@/pages/cases/manage/CaseManageMenu';
import { toRouteMap } from '@/pages/route-tracking/routeMap';
import { areaLevelColor, statusColor } from '@/theme';
import { requestNotificationPermission } from '@/utils/alertSignals';
import { formatElapsedSince, formatSimilarity, formatTime } from '@/utils/format';
import { useNow } from '@/utils/useNow';
import { useQueryClient } from '@tanstack/react-query';

/** 화면을 열 때와 이 간격마다 현재 시각 기준으로 다시 계산 */
const RECALC_INTERVAL_MS = 3 * 60_000;

const LEVEL_LABEL: Record<AreaLevelView, string> = { high: '높음', mid: '중간', low: '낮음' };

type LayerKey = 'area' | 'danger' | 'route' | 'camera';
const OPTIONS: LayerOption<LayerKey>[] = [
  { key: 'area', label: '현재 위치 범위' },
  { key: 'danger', label: '위험 지역' },
  { key: 'route', label: '동선' },
  { key: 'camera', label: '카메라' },
];

/** 현재 위치 수색·실시간 감시: 보라 3단계 범위 + 위험 지역 겹침 + 우선 수색 구역 + 출현 알림 */
export function SearchAreaPage() {
  const { caseId = '' } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const now = useNow();

  const { data: caseView } = useCaseView(caseId);
  const { data: area, error: areaError, isLoading: areaLoading } = useSearchArea(caseId);
  const { data: route } = useRoute(caseId);
  const { data: cameras = [] } = useCameras(caseId);
  const { data: zones = [] } = useDangerZones();
  const { data: watch } = useWatch(caseId);
  const { data: alerts = [] } = useAlerts(caseId);
  const recalc = useRecalculateSearchArea(caseId);
  const setWatch = useSetWatch(caseId);
  const respond = useRespondAlert(caseId);
  const { layers, toggle } = useLayerToggle<LayerKey>({
    area: true,
    danger: true,
    route: true,
    camera: true,
  });
  const [areaTask, setAreaTask] = useState<string | null>(null);
  const [playing, setPlaying] = useState<SceneView | null>(null);

  const readOnly = !!caseView?.closed;
  const noScene = isNoConfirmedScene(areaError);

  const areaTaskQuery = useTaskPolling(areaTask, (t) => {
    setAreaTask(null);
    qc.invalidateQueries({ queryKey: queryKeys.search.area(caseId) });
    if (t.status === 'failed') message.error('현재 위치 범위를 계산하지 못했어요.');
  });

  const startRecalc = recalc.mutate;
  const canRecalc = !noScene && !areaLoading;
  // 화면을 열 때와 3분마다 지금 시각 기준으로 다시 계산
  useEffect(() => {
    if (!canRecalc) return;
    const run = () => startRecalc(undefined, { onSuccess: (r) => setAreaTask(r.task_id) });
    run();
    const id = window.setInterval(run, RECALC_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [caseId, canRecalc, startRecalc]);

  const newAlerts = alerts.filter((a) => a.status === 'new');
  const pastAlerts = alerts.filter((a) => a.status !== 'new');
  const routeMap = useMemo(
    () => ({ ...toRouteMap(route, cameras), pending: null }),
    [route, cameras],
  );
  const camLoc = (id: string | undefined) => cameras.find((c) => c.id === id)?.location;

  const fitTo = useMemo(() => {
    const low = area?.levels.find((l) => l.level === 'low');
    const pts = low?.polygons.flatMap((p) => p[0] ?? []) ?? [];
    return pts.length ? pts : cameras.map((c) => c.location);
  }, [area, cameras]);

  const onRespond = (alertId: string, yes: boolean) =>
    respond.mutate(
      { alertId, yes },
      {
        onSuccess: (res) => {
          if (yes) {
            message.success(
              `${res.alert.scene.camera_code} 출현을 확정했어요. 동선과 범위를 다시 계산해요.`,
            );
            if (res.task_id) setAreaTask(res.task_id);
          } else {
            message.info('아니라고 응답했어요.');
          }
        },
        onError: (e) => {
          if (isApiError(e, 'ALREADY_RESPONDED')) message.warning(e.detail);
          else message.error(isApiError(e) ? e.detail : '응답을 저장하지 못했어요.');
        },
      },
    );

  const onToggleWatch = () => {
    if (!watch) return;
    const turnOn = !watch.on;
    // 사용자 동작 안에서 브라우저 알림 권한을 묻는다
    // 권한 창을 기다리지 않고 감시는 바로 시작
    if (turnOn) void requestNotificationPermission();
    setWatch.mutate(turnOn, {
      onSuccess: () =>
        message.success(turnOn ? '실시간 감시를 시작했어요.' : '실시간 감시를 멈췄어요.'),
      onError: (e) => message.error(isApiError(e) ? e.detail : '감시 상태를 바꾸지 못했어요.'),
    });
  };

  const computing = !!areaTask;

  const header = (
    <PageHeader
      title="현재 위치 수색"
      summary={
        area
          ? `계산 기준 ${formatTime(area.computedAt)} · 마지막 목격 ${area.baseScene.cameraCode} ${formatTime(area.baseScene.startAt)} (${formatElapsedSince(area.baseScene.startAt, now)})`
          : undefined
      }
      extra={
        <>
          {!noScene && (
            <Button
              icon={<ReloadOutlined />}
              loading={computing || recalc.isPending}
              onClick={() => startRecalc(undefined, { onSuccess: (r) => setAreaTask(r.task_id) })}
            >
              {computing ? `계산 중 ${areaTaskQuery.data?.progress ?? 0}%` : '새로 계산'}
            </Button>
          )}
          <CaseManageMenu caseId={caseId} />
        </>
      }
    />
  );

  if (noScene) {
    return (
      <>
        {header}
        <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <EmptyState
            icon={<NodeIndexOutlined />}
            message="확정된 장면이 없어 현재 위치 범위를 계산할 수 없어요. 동선 추적에서 장면을 확정하세요"
            actionLabel="동선 추적으로"
            onAction={() => navigate(`/cases/${caseId}/tracking`)}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <MapFrame
        map={
          <KakaoMap
            fitTo={fitTo}
            topLeft={<LayerToggle options={OPTIONS} value={layers} onToggle={toggle} />}
            bottomLeft={
              <MapLegend
                items={[
                  ...(layers.area ? (['area'] as const) : []),
                  ...(layers.danger ? (['danger'] as const) : []),
                  ...(layers.route ? (['route'] as const) : []),
                  ...(layers.camera ? (['camera'] as const) : []),
                  ...(newAlerts.length ? (['liveAlert'] as const) : []),
                ]}
              />
            }
          >
            {layers.area && area && (
              <SearchAreaLayer levels={area.levels} priorityZones={area.priorityZones} />
            )}
            {layers.danger && <DangerZoneLayer zones={zones} />}
            {layers.route && <RouteLayer route={routeMap} />}
            {layers.camera && <CameraLayer cameras={cameras} showSectors={false} />}
            {newAlerts.map((a) => {
              const pos = camLoc(a.scene?.cameraId);
              return pos ? (
                <LiveAlertMarker key={a.id} position={pos} label={`${a.cameraCode} 출현`} />
              ) : null;
            })}
          </KakaoMap>
        }
        panel={
          <>
            {newAlerts.map((a) => (
              <LiveAlertCard
                key={a.id}
                alert={a}
                onRespond={readOnly ? undefined : (k) => onRespond(a.id, k === 'yes')}
                responding={
                  respond.isPending && respond.variables?.alertId === a.id
                    ? respond.variables.yes
                      ? 'yes'
                      : 'no'
                    : null
                }
                onPlay={a.scene ? () => setPlaying(a.scene) : undefined}
              />
            ))}

            <Card size="small" title="마지막 목격 장면">
              {areaLoading || !area ? (
                <Spin />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <SceneThumbnail
                    scene={area.baseScene}
                    status="confirmed"
                    onClick={() => setPlaying(area.baseScene)}
                  />
                  <div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>
                      {formatElapsedSince(area.baseScene.startAt, now)}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                      {area.baseScene.cameraCode} {formatTime(area.baseScene.startAt)} 이후
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {area && area.dangerOverlaps.length > 0 && (
              <Alert
                type="error"
                showIcon
                icon={<WarningFilled />}
                message={`가능 범위가 위험 지역(${area.dangerOverlaps.map((o) => o.name).join(', ')})과 겹쳐요`}
                description={area.dangerOverlaps
                  .map((o) => `${o.name}: 가능성 ${LEVEL_LABEL[o.level]} 단계와 겹침`)
                  .join(' · ')}
              />
            )}

            {area && (
              <Card size="small" title="우선 수색 구역" styles={{ body: { padding: 0 } }}>
                <List
                  size="small"
                  dataSource={area.priorityZones}
                  renderItem={(z) => (
                    <List.Item>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span
                          className="num"
                          style={{
                            flex: 'none',
                            display: 'grid',
                            placeItems: 'center',
                            width: 22,
                            height: 22,
                            borderRadius: 4,
                            border: `2px solid ${areaLevelColor.HIGH}`,
                            color: areaLevelColor.HIGH,
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {z.rank}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{z.name}</div>
                          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{z.reason}</div>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            )}

            <Card
              size="small"
              title="실시간 감시"
              extra={
                watch && (
                  <Badge
                    status={watch.on ? 'processing' : 'default'}
                    text={watch.on ? '감시 중' : '꺼짐'}
                  />
                )
              }
            >
              {watch?.on ? (
                <div className="num" style={{ fontSize: 13, marginBottom: 12 }}>
                  카메라 {watch.cameraCount}대 감시 중
                  {watch.startedAt &&
                    ` · ${formatTime(watch.startedAt)}부터${watch.startedByName ? ` (${watch.startedByName})` : ''}`}
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>
                    나타나면 이 화면 맨 위와 사이드바, 알림음, 브라우저 알림으로 알려요.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, marginBottom: 12, color: 'rgba(0,0,0,0.65)' }}>
                  확정된 실종자 특징으로 카메라를 실시간 감시해요. 담당자 전원에게 알림이 가요.
                </div>
              )}
              <Button
                block
                type={watch?.on ? 'default' : 'primary'}
                danger={watch?.on}
                disabled={readOnly || !watch}
                loading={setWatch.isPending}
                onClick={onToggleWatch}
              >
                {watch?.on ? '감시 중지' : '실시간 감시 시작'}
              </Button>
              {readOnly && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 8 }}>
                  종료된 사건이라 감시할 수 없어요.
                </div>
              )}
            </Card>

            {pastAlerts.length > 0 && (
              <Card size="small" title="지난 출현 알림" styles={{ body: { padding: 0 } }}>
                <List
                  size="small"
                  dataSource={pastAlerts}
                  renderItem={(a) => (
                    <List.Item
                      extra={
                        a.status === 'confirmed' ? (
                          <Tag color="green">맞음</Tag>
                        ) : (
                          <Tag
                            style={{ textDecoration: 'line-through', color: statusColor.excluded }}
                          >
                            아님
                          </Tag>
                        )
                      }
                    >
                      <span className="num" style={{ fontSize: 13 }}>
                        {a.cameraCode} {formatTime(a.seenAt)} · {formatSimilarity(a.similarity)} ·{' '}
                        {a.respondedByName}
                      </span>
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </>
        }
      />
      <VideoPlayerModal scene={playing} onClose={() => setPlaying(null)} />
    </>
  );
}
