import { useState } from 'react';
import { App, Button, Card, InputNumber, Popover, Space, Table, Tag, type TableProps } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useCorrectWalkEdge } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { WalkEdgeView } from '@/api/view';
import { statusColor } from '@/theme';

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

function CorrectionEditor({ edge, onClose }: { edge: WalkEdgeView; onClose: () => void }) {
  const { message } = App.useApp();
  const correct = useCorrectWalkEdge();
  const [dist, setDist] = useState<number | null>(edge.correctedDistanceM ?? edge.apiDistanceM);
  const [min, setMin] = useState<number | null>(edge.correctedMinutes ?? edge.apiMinutes);
  const save = (distanceM: number | null, minutes: number | null, text: string) =>
    correct.mutate(
      { id: edge.id, distanceM, minutes },
      {
        onSuccess: () => {
          message.success(text);
          onClose();
        },
        onError: (e) => message.error(isApiError(e) ? e.detail : '저장하지 못했어요.'),
      },
    );
  return (
    <Space direction="vertical" size={8} style={{ width: 220 }}>
      <Space>
        <InputNumber min={1} value={dist} onChange={setDist} suffix="m" style={{ width: 110 }} />
        <InputNumber min={1} value={min} onChange={setMin} suffix="분" style={{ width: 90 }} />
      </Space>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button
          size="small"
          disabled={edge.correctedMinutes === null}
          onClick={() => save(null, null, '보정을 해제했어요.')}
        >
          보정 해제
        </Button>
        <Button
          size="small"
          type="primary"
          loading={correct.isPending}
          disabled={!dist || !min}
          onClick={() => save(dist, min, '보정값을 저장했어요.')}
        >
          저장
        </Button>
      </Space>
    </Space>
  );
}

interface WalkEdgePanelProps {
  edges: WalkEdgeView[];
  codeById: Record<string, string>;
  selectedId: string | null;
  onSelect: (edge: WalkEdgeView) => void;
}

/** 도보 경로 보정: 우회 의심 구간을 먼저, 구간마다 거리·시간을 직접 고친다 */
export function WalkEdgePanel({ edges, codeById, selectedId, onSelect }: WalkEdgePanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const sorted = [...edges].sort(
    (a, b) => Number(b.detourSuspected) - Number(a.detourSuspected) || a.id.localeCompare(b.id),
  );
  const detourCount = edges.filter((e) => e.detourSuspected).length;

  const columns: TableProps<WalkEdgeView>['columns'] = [
    {
      title: '구간',
      key: 'edge',
      render: (_, e) => (
        <span className="num" style={{ whiteSpace: 'nowrap' }}>
          {e.detourSuspected && (
            <WarningOutlined style={{ color: statusColor.pending, marginRight: 4 }} />
          )}
          {codeById[e.fromCameraId] ?? '?'} → {codeById[e.toCameraId] ?? '?'}
        </span>
      ),
    },
    {
      title: 'API',
      key: 'api',
      render: (_, e) => (
        <span className="num" style={{ whiteSpace: 'nowrap' }}>
          {fmtDist(e.apiDistanceM)} · {e.apiMinutes}분
        </span>
      ),
    },
    {
      title: '보정값',
      key: 'corrected',
      render: (_, e) => (
        <Popover
          trigger="click"
          open={editing === e.id}
          onOpenChange={(o) => setEditing(o ? e.id : null)}
          title={`${codeById[e.fromCameraId]} → ${codeById[e.toCameraId]} 보정`}
          content={<CorrectionEditor edge={e} onClose={() => setEditing(null)} />}
        >
          <Button size="small" onClick={(ev) => ev.stopPropagation()}>
            <span className="num">
              {e.correctedMinutes !== null && e.correctedDistanceM !== null
                ? `${fmtDist(e.correctedDistanceM)} · ${e.correctedMinutes}분`
                : '—'}
            </span>
          </Button>
        </Popover>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <span>
          도보 경로 보정 {detourCount > 0 && <Tag color="orange">우회 의심 {detourCount}건</Tag>}
        </span>
      }
      styles={{ body: { padding: 0 } }}
    >
      <Table<WalkEdgeView>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={sorted}
        pagination={{ pageSize: 6, size: 'small', hideOnSinglePage: true }}
        onRow={(e) => ({
          onClick: () => onSelect(e),
          style: { cursor: 'pointer', background: e.id === selectedId ? '#e6f0ff' : undefined },
        })}
      />
    </Card>
  );
}
