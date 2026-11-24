import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  type TableProps,
} from 'antd';
import { RedoOutlined, UploadOutlined } from '@ant-design/icons';
import { useRetryVideo, useVideoStats, useVideos } from '@/api/admin';
import { isApiError } from '@/api/client';
import { useCameras } from '@/api/map';
import type { AnalysisStatusView, VideoView } from '@/api/view';
import { TableFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import { AnalysisStatusBadge } from '@/components/StatusBadge';
import { PRIMARY, statusColor } from '@/theme';
import { formatDateTime } from '@/utils/format';
import { UploadDrawer } from '@/pages/admin/videos/UploadDrawer';
import { VideoCameraMap } from '@/pages/admin/videos/VideoCameraMap';

/** 선택 상자의 "전체" 항목 값 */
const ALL = '__all__';

const STATUS_CARDS: { key: AnalysisStatusView; label: string; color: string }[] = [
  { key: 'waiting', label: '대기', color: '#475569' },
  { key: 'processing', label: '진행 중', color: PRIMARY },
  { key: 'done', label: '완료', color: statusColor.confirmed },
  { key: 'failed', label: '실패', color: statusColor.danger },
];

const STAGE_LABEL: Record<string, string> = {
  queued: '대기',
  preparing: '준비',
  converting: '변환',
  analyzing: '분석',
  saving: '저장',
};

const fmtDuration = (sec: number | null) => {
  if (sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};

/** 영상 등록·분석 현황: 상태별 개수 카드 + 표(실패가 맨 위, 재처리) (SYS01-004, 005) */
export function VideosPage() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<AnalysisStatusView | undefined>();
  // 지도 노드 id(선택 상자·지도). 목록 조회에는 서버 camera_id로 바꿔 보낸다
  const [cameraId, setCameraId] = useState<string | undefined>();
  // 표에서 누른 영상의 카메라(지도에서 강조)
  const [highlight, setHighlight] = useState<{ videoId: string; cameraId: string } | null>(null);
  // 지도에서 고른 카메라로 등록 폼을 열 때 그 카메라 id
  const [uploading, setUploading] = useState<{ cameraId?: string } | null>(null);
  const { data: cameras = [] } = useCameras();
  const selectedCamera = cameras.find((c) => c.id === cameraId);
  const serverCameraId = selectedCamera
    ? (selectedCamera.cameraId ?? selectedCamera.id)
    : undefined;
  const { items, isLoading, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useVideos({ status, cameraId: serverCameraId });
  const retry = useRetryVideo();
  // 상태 카드·지도: 전체 녹화 영상 현황(R7). 목록 필터와 상관없는 전체 집계
  const { data: stats } = useVideoStats();
  const selectedStats = serverCameraId ? stats?.byCamera[serverCameraId] : undefined;
  const selectCamera = (id: string | undefined) => setCameraId(id);
  // 표의 영상(camera_id) → 지도 노드 id
  const nodeIdOf = (camId: string) => cameras.find((c) => (c.cameraId ?? c.id) === camId)?.id;

  const columns: TableProps<VideoView>['columns'] = [
    {
      title: '영상',
      key: 'video',
      render: (_, v) => (
        <span className="num">
          {v.label} {v.caseId && <Tag>사건 영상</Tag>}
          {v.warnings.length > 0 && (
            <div style={{ fontSize: 12, color: statusColor.pending }}>{v.warnings.join(' · ')}</div>
          )}
        </span>
      ),
    },
    {
      title: '카메라',
      key: 'camera',
      width: 90,
      render: (_, v) => <span className="num">{v.cameraCode}</span>,
    },
    {
      title: '녹화 시작',
      key: 'recorded',
      width: 120,
      render: (_, v) => <span className="num">{formatDateTime(v.recordedAt)}</span>,
    },
    {
      title: '길이',
      key: 'duration',
      width: 100,
      render: (_, v) => <span className="num">{fmtDuration(v.durationSec)}</span>,
    },
    {
      title: '상태·진행률',
      key: 'status',
      width: 280,
      render: (_, v) => (
        <div>
          <Space>
            <AnalysisStatusBadge status={v.status} progress={v.progress} />
            {v.status === 'processing' && STAGE_LABEL[v.stage] && (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                {STAGE_LABEL[v.stage]} 단계
              </span>
            )}
            {v.status === 'failed' && v.errorMessage && (
              <span style={{ fontSize: 12, color: statusColor.danger }}>{v.errorMessage}</span>
            )}
          </Space>
          {v.status === 'processing' && (
            <Progress percent={v.progress} size="small" showInfo={false} />
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 100,
      align: 'right',
      render: (_, v) =>
        v.status === 'failed' ? (
          <Button
            size="small"
            icon={<RedoOutlined />}
            loading={retry.isPending && retry.variables === v.id}
            onClick={() =>
              retry.mutate(v.id, {
                onSuccess: () => message.info(`${v.label} 재처리를 시작했어요.`),
                onError: (e) => message.error(isApiError(e) ? e.detail : '재처리하지 못했어요.'),
              })
            }
          >
            재처리
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="영상 등록·분석"
        summary={stats ? `전체 녹화 영상 ${stats.total}개` : undefined}
        extra={
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploading({})}>
            영상 등록
          </Button>
        }
      />
      <TableFrame>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {STATUS_CARDS.map((s) => (
            <Col span={6} key={s.key}>
              <Card
                size="small"
                hoverable
                onClick={() => setStatus(status === s.key ? undefined : s.key)}
                style={{ borderColor: status === s.key ? s.color : undefined }}
              >
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)' }}>{s.label}</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 700, color: s.color }}>
                  {stats?.byStatus[s.key] ?? '—'}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <Card
            size="small"
            title="카메라 위치별 영상"
            style={{ width: 420, flex: 'none' }}
            styles={{ body: { padding: 0 } }}
          >
            <div style={{ height: 460 }}>
              <VideoCameraMap
                cameras={cameras}
                stats={stats?.byCamera ?? {}}
                selectedCameraId={cameraId}
                highlightedCameraId={highlight ? nodeIdOf(highlight.cameraId) : undefined}
                onSelect={selectCamera}
              />
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #f0f0f0' }}>
              {selectedCamera ? (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div>
                    <b className="num">{selectedCamera.code}</b> {selectedCamera.name}
                    <div className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
                      전체 현황 기준 · 영상 {selectedStats?.total ?? 0}개 · 완료{' '}
                      {selectedStats?.done ?? 0} · 분석 중{' '}
                      {(selectedStats?.processing ?? 0) + (selectedStats?.waiting ?? 0)} · 실패{' '}
                      {selectedStats?.failed ?? 0}
                    </div>
                  </div>
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      icon={<UploadOutlined />}
                      onClick={() => setUploading({ cameraId: selectedCamera.id })}
                    >
                      이 카메라에 영상 등록
                    </Button>
                    <Button size="small" onClick={() => selectCamera(undefined)}>
                      전체 보기
                    </Button>
                  </Space>
                </Space>
              ) : (
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
                  카메라를 누르면 그 카메라 영상만 표에 보여요. 회색은 영상이 없는 카메라예요. 위
                  숫자와 지도는 전체 녹화 영상 현황이에요.
                </span>
              )}
            </div>
          </Card>
          <Card
            style={{ flex: 1, minWidth: 0 }}
            title={
              selectedCamera ? `${selectedCamera.code} ${selectedCamera.name} 영상` : '녹화 영상'
            }
            extra={
              <Space>
                <Select
                  style={{ width: 180 }}
                  value={cameraId ?? ALL}
                  onChange={(v) => selectCamera(v === ALL ? undefined : v)}
                  options={[
                    { value: ALL, label: '전체 카메라' },
                    ...cameras
                      .filter((c) => c.source === 'fixed')
                      .map((c) => ({ value: c.id, label: `${c.code} ${c.name}` })),
                  ]}
                />
                <Select
                  style={{ width: 120 }}
                  value={status ?? ALL}
                  onChange={(v) => setStatus(v === ALL ? undefined : (v as AnalysisStatusView))}
                  options={[
                    { value: ALL, label: '전체 상태' },
                    ...STATUS_CARDS.map((s) => ({ value: s.key, label: s.label })),
                  ]}
                />
              </Space>
            }
          >
            <Table<VideoView>
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={isLoading || (isFetching && !isFetchingNextPage && !items.length)}
              rowClassName={(v) =>
                [
                  v.status === 'failed' ? 'video-row-failed' : '',
                  v.id === highlight?.videoId ? 'video-row-highlight' : '',
                ].join(' ')
              }
              onRow={(v) => ({
                onClick: () =>
                  setHighlight(
                    highlight?.videoId === v.id ? null : { videoId: v.id, cameraId: v.cameraId },
                  ),
                style: { cursor: 'pointer' },
                title: v.caseId
                  ? '사건 영상 카메라는 이 지도에 없어요'
                  : '눌러서 지도에서 카메라 보기',
              })}
              pagination={false}
              footer={
                hasNextPage
                  ? () => (
                      <div style={{ textAlign: 'center' }}>
                        <Button loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                          더 보기
                        </Button>
                      </div>
                    )
                  : undefined
              }
              locale={{ emptyText: '조건에 맞는 영상이 없어요.' }}
            />
          </Card>
        </div>
      </TableFrame>
      <UploadDrawer
        open={!!uploading}
        initialCameraId={uploading?.cameraId}
        onClose={() => setUploading(null)}
      />
    </>
  );
}
