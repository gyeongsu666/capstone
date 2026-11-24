import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Badge, Button, Card, List, Spin, Tag, type BadgeProps } from 'antd';
import { NodeIndexOutlined, ReloadOutlined, WarningFilled } from '@ant-design/icons';
import { useCaseView } from '@/api/cases';
import { isApiError } from '@/api/client';
import { useCameras, useDangerZones } from '@/api/map';
import {
  areaUnavailableReason,
  useAlerts,
  useCaseSceneDetail,
  useDecideAlert,
  usePastAlerts,
  useSearchArea,
  useSetWatch,
  useWatch,
} from '@/api/search';
import { useRoute, useSceneDetail } from '@/api/tracking';
import type { AlertView, AreaLevelView, WatchStatusView } from '@/api/view';
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
import { findCamera, toRouteMap } from '@/pages/route-tracking/routeMap';
import { areaLevelColor, statusColor } from '@/theme';
import { requestNotificationPermission } from '@/utils/alertSignals';
import { formatSimilarity, formatTime, severityLabel } from '@/utils/format';

const LEVEL_LABEL: Record<AreaLevelView, string> = { high: '높음', mid: '중간', low: '낮음' };

/** 감시 상태 6가지(서버 WatchState.status) */
const WATCH_STATUS: Record<WatchStatusView, { text: string; badge: BadgeProps['status'] }> = {
  starting: { text: '시작 중', badge: 'processing' },
  watching: { text: '감시 중', badge: 'processing' },
  degraded: { text: '일부 카메라 장애', badge: 'warning' },
  stopped: { text: '꺼짐', badge: 'default' },
  blocked: { text: '시작할 수 없음', badge: 'error' },
  unknown: { text: '상태 알 수 없음', badge: 'default' },
};

type LayerKey = 'area' | 'danger' | 'route' | 'camera';
const OPTIONS: LayerOption<LayerKey>[] = [
  { key: 'area', label: '현재 위치 범위' },
  { key: 'danger', label: '위험 지역' },
  { key: 'route', label: '동선' },
  { key: 'camera', label: '카메라' },
];

/** 재생 중인 장면: 동선 장면(트랙렛) 또는 출현 알림 장면 */
type Playing = { kind: 'tracklet'; id: string } | { kind: 'case'; id: string } | null;

/**
 * 현재 위치 수색·실시간 감시: 보라 3단계 범위 + 위험 지역 겹침 + 우선 수색 구역 + 출현 알림.
 * 범위는 조회할 때 서버가 계산한다(재계산 API 없음). 화면을 열 때와 3분마다, "새로고침"으로 다시 받는다.
 */
export function SearchAreaPage() {
  const { caseId = '' } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const { data: caseView } = useCaseView(caseId);
  const {
    data: area,
    error: areaError,
    isLoading: areaLoading,
    isFetching: areaFetching,
    refetch: refetchArea,
  } = useSearchArea(caseId);
  const { data: route } = useRoute(caseId);
  const { data: cameras = [] } = useCameras(caseId);
  const { data: zones = [] } = useDangerZones();
  const { data: watch } = useWatch(caseId);
  const { data: alerts = [] } = useAlerts(caseId);
  const { data: pastAlerts = [] } = usePastAlerts(caseId);
  const setWatch = useSetWatch(caseId);
  const decideAlert = useDecideAlert(caseId);
  const { layers, toggle } = useLayerToggle<LayerKey>({
    area: true,
    danger: true,
    route: true,
    camera: true,
  });
  const [playing, setPlaying] = useState<Playing>(null);
  const { data: trackletDetail } = useSceneDetail(playing?.kind === 'tracklet' ? playing.id : null);
  const { data: caseSceneDetail } = useCaseSceneDetail(
    caseId,
    playing?.kind === 'case' ? playing.id : null,
  );
  const playingDetail = playing?.kind === 'tracklet' ? trackletDetail : caseSceneDetail;

  const readOnly = !!caseView?.closed;
  const unavailable = areaUnavailableReason(areaError);

  const routeMap = useMemo(() => toRouteMap(route, cameras), [route, cameras]);
  // 기준이 된 확정 장면(없으면 사건의 마지막 목격 위치·시각 기준)
  const basisScene = area?.basisDecisionId
    ? route?.scenes.find((s) => s.decisionId === area.basisDecisionId)?.scene
    : undefined;
  const basisLabel = basisScene
    ? `${basisScene.cameraCode} ${formatTime(basisScene.startAt)}`
    : `${caseView?.lastSeenPlace.name ?? '마지막 목격 장소'} ${area ? formatTime(area.basisObservedAt) : ''}`;

  const fitTo = useMemo(() => {
    const low = area?.levels.find((l) => l.level === 'low');
    const pts = low?.polygons.flatMap((p) => p[0] ?? []) ?? [];
    return pts.length ? pts : cameras.map((c) => c.location);
  }, [area, cameras]);

  const onRespond = (a: AlertView, yes: boolean) =>
    decideAlert.mutate(
      { alertId: a.id, version: a.version, yes },
      {
        onSuccess: () => {
          if (yes) message.success(`${a.cameraCode} 출현을 확정했어요. 동선과 범위가 바뀌어요.`);
          else message.info('아니라고 응답했어요.');
        },
        onError: (e) => {
          if (isApiError(e, 'ALERT_ALREADY_DECIDED')) message.warning(e.detail);
          else if (isApiError(e, 'VERSION_CONFLICT'))
            message.warning('알림이 바뀌었어요. 다시 불러왔으니 확인 후 다시 눌러 주세요.');
          else message.error(isApiError(e) ? e.detail : '응답을 저장하지 못했어요.');
        },
      },
    );

  const onToggleWatch = () => {
    if (!watch) return;
    const turnOn = !watch.enabled;
    // 사용자 동작 안에서 브라우저 알림 권한을 묻는다(권한 창을 기다리지 않고 감시는 바로 시작)
    if (turnOn) void requestNotificationPermission();
    setWatch.mutate(turnOn, {
      onSuccess: () =>
        message.success(turnOn ? '실시간 감시를 시작했어요.' : '실시간 감시를 멈췄어요.'),
      onError: (e) =>
        message.error(
          isApiError(e, 'VERSION_CONFLICT')
            ? '사건이 바뀌었어요. 다시 불러왔으니 한 번 더 눌러 주세요.'
            : isApiError(e)
              ? e.detail
              : '감시 상태를 바꾸지 못했어요.',
        ),
    });
  };

  const header = (
    <PageHeader
      title="현재 위치 수색"
      summary={
        area
          ? `기준 시각 ${formatTime(area.asOf)} · 마지막 목격 ${basisLabel} (${area.elapsedMinutes}분 경과)`
          : undefined
      }
      extra={
        <>
          {!unavailable && (
            <Button
              icon={<ReloadOutlined />}
              loading={areaFetching}
              onClick={() => void refetchArea()}
            >
              새로고침
            </Button>
          )}
          <CaseManageMenu caseId={caseId} />
        </>
      }
    />
  );

  if (unavailable) {
    return (
      <>
        {header}
        <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <EmptyState
            icon={<NodeIndexOutlined />}
            message={unavailable}
            actionLabel="동선 추적으로"
            onAction={() => navigate(`/cases/${caseId}/tracking`)}
          />
        </div>
      </>
    );
  }

  const watchStatus = watch ? WATCH_STATUS[watch.status] : null;

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
                  ...(alerts.length ? (['liveAlert'] as const) : []),
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
            {alerts.map((a) => {
              const pos = findCamera(cameras, a.cameraId)?.location;
              return pos ? (
                <LiveAlertMarker key={a.id} position={pos} label={`${a.cameraCode} 출현`} />
              ) : null;
            })}
          </KakaoMap>
        }
        panel={
          <>
            {alerts.map((a) => (
              <LiveAlertCard
                key={a.id}
                alert={a}
                onRespond={readOnly ? undefined : (k) => onRespond(a, k === 'yes')}
                responding={
                  decideAlert.isPending && decideAlert.variables?.alertId === a.id
                    ? decideAlert.variables.yes
                      ? 'yes'
                      : 'no'
                    : null
                }
                onPlay={() => setPlaying({ kind: 'case', id: a.sceneId })}
              />
            ))}

            <Card size="small" title="마지막 목격">
              {areaLoading || !area ? (
                <Spin />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {basisScene && (
                    <SceneThumbnail
                      scene={basisScene}
                      status="confirmed"
                      onClick={() => setPlaying({ kind: 'tracklet', id: basisScene.id })}
                    />
                  )}
                  <div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>
                      {area.elapsedMinutes}분 경과
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                      {basisLabel} 이후 · 보행 {area.walkingSpeedMps} m/s
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {area?.warnings.map((w) => (
              <Alert key={w.code} type="info" showIcon message={w.message} />
            ))}

            {area && area.dangerOverlaps.length > 0 && (
              <Alert
                type="error"
                showIcon
                icon={<WarningFilled />}
                message={`가능 범위가 위험 지역(${area.dangerOverlaps.map((o) => o.name).join(', ')})과 겹쳐요`}
                description={area.dangerOverlaps
                  .map(
                    (o) =>
                      `${o.name}(위험도 ${severityLabel[o.severity]}): 가능성 ${LEVEL_LABEL[o.level]} 단계와 겹침`,
                  )
                  .join(' · ')}
              />
            )}

            {area && (
              <Card size="small" title="우선 수색 구역" styles={{ body: { padding: 0 } }}>
                <List
                  size="small"
                  dataSource={area.priorityZones}
                  locale={{ emptyText: '우선 수색 구역이 없어요.' }}
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
                          {z.reason && (
                            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                              {z.reason}
                            </div>
                          )}
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
              extra={watchStatus && <Badge status={watchStatus.badge} text={watchStatus.text} />}
            >
              {watch?.enabled ? (
                <div className="num" style={{ fontSize: 13, marginBottom: 12 }}>
                  카메라 {watch.watchingCount}/{watch.cameras.length}대 감시 중 ·{' '}
                  {formatTime(watch.updatedAt)}부터
                  {watch.cameras.some(
                    (c) => c.status !== 'watching' && c.status !== 'starting',
                  ) && (
                    <div style={{ fontSize: 12, color: statusColor.pending, marginTop: 4 }}>
                      {watch.cameras
                        .filter((c) => c.status !== 'watching' && c.status !== 'starting')
                        .map((c) => {
                          const cam = findCamera(cameras, c.cameraId);
                          return `${cam?.code ?? c.cameraId} ${c.reason ?? c.status}`;
                        })
                        .join(' · ')}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>
                    나타나면 이 화면 맨 위와 사이드바, 알림음, 브라우저 알림으로 알려요.
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, marginBottom: 12, color: 'rgba(0,0,0,0.65)' }}>
                  기준 대상의 특징으로 카메라를 실시간 감시해요. 담당자 전원에게 알림이 가요.
                </div>
              )}
              <Button
                block
                type={watch?.enabled ? 'default' : 'primary'}
                danger={watch?.enabled}
                disabled={readOnly || !watch}
                loading={setWatch.isPending}
                onClick={onToggleWatch}
              >
                {watch?.enabled ? '감시 중지' : '실시간 감시 시작'}
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
      <VideoPlayerModal
        scene={playing ? (playingDetail?.scene ?? null) : null}
        track={playingDetail?.track}
        onClose={() => setPlaying(null)}
      />
    </>
  );
}
