import type { CandidateView, QueueView } from '@/api/view';
import { CandidateCard } from '@/components/CandidateCard';
import { statusColor } from '@/theme';
import { formatSimilarity } from '@/utils/format';

interface CandidateQueueProps {
  queue: QueueView;
  threshold: number;
  activeId: string | null;
  onSelect: (c: CandidateView) => void;
  /** 재검색 중이거나 검색이 낡았으면 흐리게 */
  dimmed?: boolean;
  /** 방금 검색에서 새로 나온 후보 */
  newIds?: string[];
}

/**
 * 후보 대기열: 유사도 순(보류는 맨 뒤). 서버는 유사도 기준 이상인 후보만 준다.
 * 맨 아래 점선은 지금 기준값(이보다 낮은 후보는 기준을 낮춰 다시 검색해야 보인다).
 */
export function CandidateQueue({
  queue,
  threshold,
  activeId,
  onSelect,
  dimmed,
  newIds = [],
}: CandidateQueueProps) {
  return (
    <div style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 0.2s' }}>
      {queue.items.map((c) => (
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
    </div>
  );
}
