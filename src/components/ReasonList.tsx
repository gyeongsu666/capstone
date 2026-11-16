import type { ReactNode } from 'react';
import {
  ArrowDownOutlined,
  CheckOutlined,
  EyeInvisibleOutlined,
  InfoCircleOutlined,
  UsergroupAddOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ReasonView, ReasonViewKind } from '@/api/view';
import { statusColor } from '@/theme';

/** 근거는 아이콘 + 글자를 함께 (색만으로 구분하지 않는다) */
const reasonStyle: Record<ReasonViewKind, { icon: ReactNode; color: string }> = {
  route_ok: { icon: <CheckOutlined />, color: statusColor.confirmed },
  time_short: { icon: <ArrowDownOutlined />, color: statusColor.danger },
  direction_mismatch: { icon: <ArrowDownOutlined />, color: statusColor.danger },
  out_of_filter: { icon: <WarningOutlined />, color: statusColor.pending },
  low_quality: { icon: <EyeInvisibleOutlined />, color: statusColor.excluded },
  overlap: { icon: <UsergroupAddOutlined />, color: statusColor.pending },
  info: { icon: <InfoCircleOutlined />, color: 'rgba(0,0,0,0.6)' },
};

export function ReasonItem({ reason, size = 12 }: { reason: ReasonView; size?: number }) {
  const s = reasonStyle[reason.kind];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: s.color,
        fontSize: size,
        lineHeight: 1.5,
      }}
    >
      {s.icon}
      <span>{reason.text}</span>
    </span>
  );
}

/** 근거 목록. inline이면 한 줄에 이어서, 아니면 한 줄에 하나 */
export function ReasonList({
  reasons,
  max,
  inline,
  size,
}: {
  reasons: ReasonView[];
  max?: number;
  inline?: boolean;
  size?: number;
}) {
  const shown = max ? reasons.slice(0, max) : reasons;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        flexWrap: inline ? 'wrap' : undefined,
        gap: inline ? '0 10px' : 2,
      }}
    >
      {shown.map((r, i) => (
        <ReasonItem key={`${r.kind}-${i}`} reason={r} size={size} />
      ))}
    </div>
  );
}
