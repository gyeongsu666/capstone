import type { ReactNode } from 'react';
import { Button, Popconfirm, Table, type TableProps } from 'antd';
import { CheckOutlined, CloseOutlined, PauseOutlined, RollbackOutlined } from '@ant-design/icons';
import type { DecisionView, VerdictView } from '@/api/view';
import { statusColor } from '@/theme';
import { formatDateTime, formatTime } from '@/utils/format';

/** 표의 한 줄: 판단 줄, 또는 그 바로 아래에 붙는 번복 줄 */
interface DecisionRow {
  key: string;
  type: 'decision' | 'revert';
  decision: DecisionView;
  at: string;
  byName: string;
}

/** 최신순 판단 목록 → 표 줄. 번복된 판단 바로 아래에 번복 줄을 둔다. */
function toDecisionRows(decisions: DecisionView[]): DecisionRow[] {
  return decisions.flatMap((d) => {
    const row: DecisionRow = {
      key: d.id,
      type: 'decision',
      decision: d,
      at: d.decidedAt,
      byName: d.decidedByName,
    };
    return d.revert
      ? [
          row,
          {
            key: `${d.id}-revert`,
            type: 'revert',
            decision: d,
            at: d.revert.at,
            byName: d.revert.byName,
          },
        ]
      : [row];
  });
}

const verdictLabel: Record<VerdictView, { text: string; icon: ReactNode; color: string }> = {
  yes: { text: '예 (확정)', icon: <CheckOutlined />, color: statusColor.confirmed },
  no: { text: '아니오 (제외)', icon: <CloseOutlined />, color: 'rgba(0,0,0,0.75)' },
  hold: { text: '보류', icon: <PauseOutlined />, color: '#475569' },
};

const revertWarning: Record<VerdictView, string> = {
  yes: "이 장면 뒤의 확정 장면은 '재확인 필요'로 바뀌고, 직전 확정 장면 기준으로 다시 검색해요.",
  no: '이 후보가 대기열로 돌아가요.',
  hold: '이 후보가 대기열로 돌아가요.',
};

interface DecisionLogProps {
  decisions: DecisionView[];
  onRevert: (decisionId: string) => void;
  /** 번복 중인 판단 */
  revertingId?: string | null;
  readOnly?: boolean;
  loading?: boolean;
  /** 오늘이 아닌 기록이 섞이면 날짜도 표시 */
  showDate?: boolean;
  pagination?: TableProps<DecisionRow>['pagination'];
}

/**
 * 결정 기록: 시각, 담당자, 장면, 판단, 번복 버튼.
 * 기록은 지우지 않는다. 번복된 줄은 회색 취소선, 바로 아래에 번복 줄.
 */
export function DecisionLog({
  decisions,
  onRevert,
  revertingId = null,
  readOnly = false,
  loading,
  showDate = false,
  pagination = false,
}: DecisionLogProps) {
  const fmt = showDate ? formatDateTime : formatTime;

  const columns: TableProps<DecisionRow>['columns'] = [
    {
      title: '시각',
      key: 'at',
      width: showDate ? 110 : 70,
      render: (_, r) => <span className="num">{fmt(r.at)}</span>,
    },
    { title: '담당자', key: 'by', width: 90, render: (_, r) => r.byName },
    {
      title: '장면',
      key: 'scene',
      render: (_, r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <img
            src={r.decision.scene.thumbnailUrl}
            alt=""
            width={24}
            height={30}
            style={{ borderRadius: 3, objectFit: 'cover', opacity: r.decision.revert ? 0.5 : 1 }}
          />
          <span className="num">
            {r.decision.scene.cameraCode} {formatTime(r.decision.scene.startAt)}
          </span>
        </span>
      ),
    },
    {
      title: '판단',
      key: 'verdict',
      width: 130,
      render: (_, r) => {
        if (r.type === 'revert') {
          return (
            <span style={{ display: 'inline-flex', gap: 4, color: statusColor.pending }}>
              <RollbackOutlined />
              번복
            </span>
          );
        }
        const v = verdictLabel[r.decision.verdict];
        return (
          <span
            style={{
              display: 'inline-flex',
              gap: 4,
              color: r.decision.revert ? undefined : v.color,
            }}
          >
            {v.icon}
            {v.text}
          </span>
        );
      },
    },
    {
      title: '',
      key: 'action',
      width: 80,
      align: 'right',
      render: (_, r) =>
        r.type === 'decision' && !r.decision.revert && !readOnly ? (
          <Popconfirm
            title="이 판단을 번복할까요?"
            description={<div style={{ maxWidth: 260 }}>{revertWarning[r.decision.verdict]}</div>}
            okText="번복"
            cancelText="취소"
            onConfirm={() => onRevert(r.decision.id)}
          >
            <Button size="small" loading={revertingId === r.decision.id}>
              번복
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Table<DecisionRow>
      size="small"
      rowKey="key"
      columns={columns}
      dataSource={toDecisionRows(decisions)}
      loading={loading}
      pagination={pagination}
      rowClassName={(r) =>
        r.type === 'decision' && r.decision.revert ? 'decision-row-reverted' : ''
      }
      locale={{ emptyText: '아직 판단 기록이 없어요.' }}
    />
  );
}
