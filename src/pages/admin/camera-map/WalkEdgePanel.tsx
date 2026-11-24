import { useState } from 'react';
import {
  App,
  Button,
  Card,
  InputNumber,
  Popover,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useCorrectWalkEdge } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { WalkEdgeView } from '@/api/view';
import { statusColor } from '@/theme';

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

function CorrectionEditor({ edge, onClose }: { edge: WalkEdgeView; onClose: () => void }) {
  const { message } = App.useApp();
  const correct = useCorrectWalkEdge();
  const [dist, setDist] = useState<number | null>(edge.distanceM);
  const [min, setMin] = useState<number | null>(edge.minutes);
  const save = () =>
    dist &&
    min &&
    correct.mutate(
      { id: edge.id, version: edge.version, distanceM: dist, minutes: min },
      {
        onSuccess: () => {
          message.success('보정값을 저장했어요.');
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
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        저장하면 직접 고친 값으로 표시되고, "다시 계산"을 해도 바뀌지 않아요.
      </Typography.Text>
      <Button
        size="small"
        type="primary"
        block
        loading={correct.isPending}
        disabled={!dist || !min}
        onClick={save}
      >
        저장
      </Button>
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
    (a, b) => Number(b.detourSuspected) - Number(a.detourSuspected) || Number(a.id) - Number(b.id),
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
      title: '거리 · 시간',
      key: 'value',
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
              {fmtDist(e.distanceM)} · {e.minutes}분
            </span>
          </Button>
        </Popover>
      ),
    },
    {
      title: '값',
      key: 'source',
      render: (_, e) =>
        e.source === 'manual' ? (
          <Tag color="blue">직접 수정</Tag>
        ) : e.detourSuspected || e.needsManual ? (
          <Tag color="orange">보정 필요</Tag>
        ) : (
          <Tag>도보 API</Tag>
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
