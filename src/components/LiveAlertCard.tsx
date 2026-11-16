import { Button, Space } from 'antd';
import type { AlertView } from '@/api/view';
import { statusColor } from '@/theme';
import { formatAgo, formatSimilarity, formatTime } from '@/utils/format';
import { useNow } from '@/utils/useNow';

interface LiveAlertCardProps {
  alert: AlertView;
  onRespond?: (kind: 'yes' | 'no') => void;
  /** 응답 중인 버튼 */
  responding?: 'yes' | 'no' | null;
  /** 썸네일을 누르면 영상 재생 */
  onPlay?: () => void;
}

/** 실시간 출현 알림: 오른쪽 패널 맨 위 빨간 테두리 카드 */
export function LiveAlertCard({ alert: a, onRespond, responding, onPlay }: LiveAlertCardProps) {
  const now = useNow(15_000);
  const answered = a.status !== 'new';

  return (
    <div
      role="alert"
      style={{
        border: `2px solid ${statusColor.danger}`,
        borderRadius: 8,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: statusColor.dangerBg,
          color: statusColor.danger,
          fontWeight: 600,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: statusColor.danger,
            animation: answered ? undefined : 'refind-pulse 1.2s ease-in-out infinite',
          }}
        />
        실시간 출현 알림
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
        <button
          type="button"
          onClick={onPlay}
          title="눌러서 영상 재생"
          style={{ all: 'unset', cursor: onPlay ? 'pointer' : 'default', flex: 'none' }}
        >
          <img
            src={a.thumbnailUrl}
            alt=""
            width={48}
            height={60}
            style={{ borderRadius: 4, objectFit: 'cover', display: 'block' }}
          />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="num" style={{ fontWeight: 600 }}>
            {a.cameraCode} · {formatAgo(a.createdAt, now)}
          </div>
          <div className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
            {formatTime(a.seenAt)} 출현 · 유사도 {formatSimilarity(a.similarity)}
          </div>
          {answered && (
            <div style={{ fontSize: 12, marginTop: 2 }}>
              {a.respondedByName ?? '담당자'}님이{' '}
              {a.status === 'confirmed' ? '맞다고 확인함' : '아니라고 응답함'}
            </div>
          )}
        </div>
        {!answered && onRespond && (
          <Space direction="vertical" size={4}>
            <Button
              type="primary"
              danger
              size="small"
              loading={responding === 'yes'}
              disabled={!!responding}
              onClick={() => onRespond('yes')}
            >
              맞아요
            </Button>
            <Button
              size="small"
              loading={responding === 'no'}
              disabled={!!responding}
              onClick={() => onRespond('no')}
            >
              아니요
            </Button>
          </Space>
        )}
      </div>
    </div>
  );
}
