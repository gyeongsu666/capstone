import type { CSSProperties, ReactNode } from 'react';
import { Button } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

interface EmptyStateProps {
  /** 할 일 한 문장. 예: "기준 사진을 올리면 후보 검색을 시작해요" */
  message: ReactNode;
  /** 버튼 하나 */
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
}

/** 빈 화면 안내: 할 일 한 문장 + 버튼 하나 */
export function EmptyState({
  message,
  actionLabel,
  onAction,
  actionIcon,
  icon,
  style,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '40px 24px',
        textAlign: 'center',
        color: 'rgba(0,0,0,0.65)',
        ...style,
      }}
    >
      <span style={{ fontSize: 36, color: '#bfc6d1' }}>{icon ?? <InboxOutlined />}</span>
      <div style={{ fontSize: 14 }}>{message}</div>
      {actionLabel && onAction && (
        <Button type="primary" icon={actionIcon} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
