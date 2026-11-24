import { useState, type ReactNode } from 'react';
import { Button, Input, Popover, Space, Table, Tag, type TableProps } from 'antd';
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
  yes: "이 장면 뒤의 확정 장면은 '재확인 필요'로 바뀌어요. 번복한 뒤 다시 검색하세요.",
  no: '다시 검색하면 이 후보가 대기열에 다시 나와요.',
  hold: '이 후보가 대기열로 돌아가요.',
};

/** 번복 사유 입력(결정 기록 탭에서는 사유가 필수, 요청서 R3) */
function RevertForm({
  decision,
  onRevert,
  loading,
}: {
  decision: DecisionView;
  onRevert: (reason: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setReason('');
      }}
      title="이 판단을 번복할까요?"
      content={
        <Space direction="vertical" style={{ width: 280 }}>
          <div style={{ fontSize: 13 }}>{revertWarning[decision.verdict]}</div>
          <Input.TextArea
            rows={2}
            autoFocus
            placeholder="번복 사유 (필수, 예: 옷 색이 달라요)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              size="small"
              type="primary"
              disabled={!reason.trim()}
              loading={loading}
              onClick={() => {
                onRevert(reason.trim());
                setOpen(false);
                setReason('');
              }}
            >
              번복
            </Button>
          </Space>
        </Space>
      }
    >
      <Button size="small" loading={loading}>
        번복
      </Button>
    </Popover>
  );
}

interface DecisionLogProps {
  decisions: DecisionView[];
  onRevert: (decision: DecisionView, reason: string) => void;
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
      render: (_, r) => {
        const sc = r.decision.scene;
        // 장면 정보는 화면이 아는 경우만(서버 기록에는 없음). 모르면 찍힌 시각만 보여 준다
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {sc && (
              <img
                src={sc.thumbnailUrl}
                alt=""
                width={24}
                height={30}
                style={{
                  borderRadius: 3,
                  objectFit: 'cover',
                  opacity: r.decision.revert ? 0.5 : 1,
                }}
              />
            )}
            <span className="num">
              {sc ? `${sc.cameraCode} ` : r.decision.source === 'alert' ? '출현 알림 ' : '장면 '}
              {formatTime(sc?.startAt ?? r.decision.observedAt)}
            </span>
            {r.type === 'decision' && r.decision.needsRecheck && (
              <Tag color="orange" style={{ margin: 0 }}>
                재확인 필요
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      title: '판단',
      key: 'verdict',
      width: 200,
      render: (_, r) => {
        if (r.type === 'revert') {
          return (
            <span style={{ display: 'inline-flex', gap: 4, color: statusColor.pending }}>
              <RollbackOutlined />
              번복
              {r.decision.revert?.reason && (
                <span style={{ color: 'rgba(0,0,0,0.55)' }}>· {r.decision.revert.reason}</span>
              )}
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
          <RevertForm
            decision={r.decision}
            loading={revertingId === r.decision.id}
            onRevert={(reason) => onRevert(r.decision, reason)}
          />
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
