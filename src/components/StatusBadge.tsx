import type { ReactNode } from 'react';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  MinusCircleOutlined,
  PauseCircleOutlined,
  RollbackOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import type { AnalysisStatusView, CandidateStatusView } from '@/api/view';
import { PRIMARY, statusColor } from '@/theme';

interface BadgeStyle {
  label: string;
  color: string;
  bg: string;
  icon: ReactNode;
  strike?: boolean;
}

function Badge({ s, small }: { s: BadgeStyle; small?: boolean }) {
  return (
    <span
      className="num"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: small ? '0 6px' : '1px 8px',
        borderRadius: 4,
        fontSize: 12,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
        color: s.color,
        background: s.bg,
        textDecoration: s.strike ? 'line-through' : undefined,
      }}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

/** 장면 상태. reverted = 번복된 기록 */
export type SceneBadgeStatus = CandidateStatusView | 'reverted';

const sceneStyles: Record<SceneBadgeStatus, BadgeStyle> = {
  confirmed: {
    label: '확정',
    color: statusColor.confirmed,
    bg: statusColor.confirmedBg,
    icon: <CheckCircleFilled />,
  },
  pending: {
    label: '확인 대기',
    color: statusColor.pending,
    bg: statusColor.pendingBg,
    icon: <ClockCircleOutlined />,
  },
  needs_recheck: {
    label: '재확인 필요',
    color: statusColor.pending,
    bg: statusColor.pendingBg,
    icon: <ExclamationCircleFilled />,
  },
  held: {
    label: '보류',
    color: '#475569',
    bg: '#e2e8f0',
    icon: <PauseCircleOutlined />,
  },
  rejected: {
    label: '제외',
    color: statusColor.excluded,
    bg: statusColor.excludedBg,
    icon: <MinusCircleOutlined />,
    strike: true,
  },
  reverted: {
    label: '번복됨',
    color: statusColor.excluded,
    bg: statusColor.excludedBg,
    icon: <RollbackOutlined />,
    strike: true,
  },
};

/** 상태 배지(장면): 확정, 확인 대기, 재확인 필요, 보류, 제외, 번복됨 */
export function SceneStatusBadge({ status, small }: { status: SceneBadgeStatus; small?: boolean }) {
  return <Badge s={sceneStyles[status]} small={small} />;
}

/** 상태 배지(분석): 대기, 진행 중 n%, 완료, 실패 */
export function AnalysisStatusBadge({
  status,
  progress,
  small,
}: {
  status: AnalysisStatusView;
  progress?: number;
  small?: boolean;
}) {
  const styles: Record<AnalysisStatusView, BadgeStyle> = {
    waiting: {
      label: '대기',
      color: '#475569',
      bg: '#e2e8f0',
      icon: <ClockCircleOutlined />,
    },
    processing: {
      label: `진행 중 ${progress ?? 0}%`,
      color: PRIMARY,
      bg: '#e6f0ff',
      icon: <SyncOutlined spin />,
    },
    done: {
      label: '완료',
      color: statusColor.confirmed,
      bg: statusColor.confirmedBg,
      icon: <CheckCircleFilled />,
    },
    failed: {
      label: '실패',
      color: statusColor.danger,
      bg: statusColor.dangerBg,
      icon: <CloseCircleFilled />,
    },
  };
  return <Badge s={styles[status]} small={small} />;
}
