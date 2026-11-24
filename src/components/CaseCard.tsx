import type { CSSProperties } from 'react';
import type { CaseCardView } from '@/api/view';
import { layoutColor } from '@/theme';
import { formatDateTime, formatElapsedSince } from '@/utils/format';
import { useNow } from '@/utils/useNow';

interface CaseCardProps {
  caseData: CaseCardView;
  style?: CSSProperties;
}

/** 사건 카드: 사건 번호, 실종자, 실종 시각, 보행 속도, 경과 시간 (사이드바용, 어두운 바탕) */
export function CaseCard({ caseData: c, style }: CaseCardProps) {
  const now = useNow();
  const person = c.age !== null ? `${c.personName} (${c.age}세)` : c.personName;

  return (
    <div
      style={{
        background: layoutColor.siderCardBg,
        borderRadius: 8,
        padding: '12px 14px',
        color: layoutColor.siderText,
        fontSize: 13,
        lineHeight: 1.6,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={c.title}
        >
          {c.title}
        </span>
        {c.closed && (
          <span
            style={{
              fontSize: 12,
              padding: '0 6px',
              borderRadius: 4,
              background: '#3a4560',
              color: layoutColor.siderText,
            }}
          >
            종료{c.closeReasonLabel ? ` · ${c.closeReasonLabel}` : ''}
          </span>
        )}
      </div>
      <div
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={`${person} · ${c.description}`}
      >
        {person} · {c.description}
      </div>
      <div className="num">실종 {formatDateTime(c.missingAt)}</div>
      <div>보행 속도: {c.walkSpeedLabel}</div>
      {!c.closed && (
        <div className="num" style={{ color: '#fff' }}>
          {formatElapsedSince(c.missingAt, now)}
        </div>
      )}
    </div>
  );
}
