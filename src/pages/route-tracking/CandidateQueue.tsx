import { useState } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { CandidateView, QueueView } from '@/api/view';
import { CandidateCard } from '@/components/CandidateCard';
import { statusColor } from '@/theme';
import { formatSimilarity } from '@/utils/format';

interface CandidateQueueProps {
  queue: QueueView;
  threshold: number;
  activeId: string | null;
  onSelect: (c: CandidateView) => void;
  /** 재검색 중이면 흐리게 */
  dimmed?: boolean;
  /** 방금 검색에서 새로 나온 후보 */
  newIds?: string[];
}

/** 후보 대기열: 유사도 순, 기준값 자리에 점선, 기준 미만은 접되 개수는 표시 */
export function CandidateQueue({
  queue,
  threshold,
  activeId,
  onSelect,
  dimmed,
  newIds = [],
}: CandidateQueueProps) {
  const [showBelow, setShowBelow] = useState(false);
  const above = queue.items.filter((c) => !c.belowThreshold);
  const below = queue.items.filter((c) => c.belowThreshold);

  return (
    <div style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 0.2s' }}>
      {above.map((c) => (
        <CandidateCard
          key={c.id}
          candidate={c}
          active={c.id === activeId}
          isNew={newIds.includes(c.id)}
          onClick={() => onSelect(c)}
        />
      ))}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          fontSize: 12,
          color: statusColor.pending,
        }}
        aria-label={`유사도 기준 ${formatSimilarity(threshold)}`}
      >
        <span style={{ flex: 1, borderTop: `1px dashed ${statusColor.pending}` }} />
        <span className="num">기준 {formatSimilarity(threshold)}</span>
        <span style={{ flex: 1, borderTop: `1px dashed ${statusColor.pending}` }} />
      </div>
      {queue.belowThresholdCount > 0 && (
        <button
          type="button"
          onClick={() => setShowBelow((v) => !v)}
          style={{
            all: 'unset',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 12px',
            fontSize: 12,
            color: 'rgba(0,0,0,0.55)',
            cursor: 'pointer',
          }}
          aria-expanded={showBelow}
        >
          {showBelow ? <DownOutlined /> : <RightOutlined />}
          <span className="num">기준 미만 {queue.belowThresholdCount}개</span>
        </button>
      )}
      {showBelow &&
        below.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            active={c.id === activeId}
            isNew={newIds.includes(c.id)}
            onClick={() => onSelect(c)}
          />
        ))}
    </div>
  );
}
