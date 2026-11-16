import type { ReactNode } from 'react';
import { Space } from 'antd';

interface PageHeaderProps {
  title: ReactNode;
  /** 제목 옆 한 줄 요약 */
  summary?: ReactNode;
  /** 오른쪽 주요 버튼 */
  extra?: ReactNode;
}

export const HEADER_HEIGHT = 56;

/** 헤더: 화면 제목 + 한 줄 요약, 주요 버튼은 오른쪽 */
export function PageHeader({ title, summary, extra }: PageHeaderProps) {
  return (
    <header
      style={{
        height: HEADER_HEIGHT,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 24px',
        background: '#fff',
        borderBottom: '1px solid #e8ebf0',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</h1>
      {summary && (
        <div
          className="num"
          style={{
            color: 'rgba(0,0,0,0.55)',
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {summary}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {extra && <Space>{extra}</Space>}
    </header>
  );
}
