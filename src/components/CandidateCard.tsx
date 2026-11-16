import { Tooltip } from 'antd';
import type { CandidateView } from '@/api/view';
import { ReasonList } from '@/components/ReasonList';
import { SceneStatusBadge } from '@/components/StatusBadge';
import { PRIMARY, statusColor } from '@/theme';
import { formatSimilarity, formatTime } from '@/utils/format';

interface CandidateCardProps {
  candidate: CandidateView;
  /** 지금 확인 중인 후보(파랑 강조) */
  active?: boolean;
  /** 방금 검색에서 새로 나온 후보 */
  isNew?: boolean;
  onClick?: () => void;
}

/** 후보 카드: 썸네일, 카메라·시각, 오른쪽 끝 유사도, 근거(아이콘 + 글자). 후보 대기열의 한 줄. */
export function CandidateCard({ candidate: c, active, isNew, onClick }: CandidateCardProps) {
  const muted = c.belowThreshold || c.status === 'rejected';
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-current={active || undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        minHeight: 40,
        cursor: onClick ? 'pointer' : undefined,
        background: active ? '#e6f0ff' : undefined,
        boxShadow: active ? `inset 3px 0 0 ${PRIMARY}` : undefined,
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <img
        src={c.scene.thumbnailUrl}
        alt=""
        width={36}
        height={45}
        style={{ borderRadius: 4, objectFit: 'cover', flex: 'none', opacity: muted ? 0.6 : 1 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>
            {c.scene.cameraCode} {formatTime(c.scene.startAt)}
          </span>
          {isNew && <span style={{ fontSize: 12, color: PRIMARY, fontWeight: 600 }}>새 후보</span>}
          {c.status !== 'pending' && <SceneStatusBadge status={c.status} small />}
          {c.outOfFilter && (
            <Tooltip title="도보 범위 밖이지만 유사도가 높아 올라온 후보예요">
              <span style={{ fontSize: 12, color: statusColor.pending }}>필터 밖</span>
            </Tooltip>
          )}
        </div>
        <ReasonList reasons={c.reasons} max={2} inline />
      </div>
      <span
        className="num"
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: muted ? statusColor.excluded : active ? PRIMARY : 'rgba(0,0,0,0.85)',
        }}
      >
        {formatSimilarity(c.similarity)}
      </span>
    </div>
  );
}
