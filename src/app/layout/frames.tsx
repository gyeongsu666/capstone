import type { ReactNode } from 'react';
import { PANEL_WIDTH } from '@/theme';

/** 지도형 본문: 가운데 지도 + 오른쪽 작업 패널(360px) */
export function MapFrame({ map, panel }: { map: ReactNode; panel: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16, padding: 16 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#e9edf2',
          position: 'relative',
        }}
      >
        {map}
      </div>
      <aside
        style={{
          width: PANEL_WIDTH,
          flex: 'none',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {panel}
      </aside>
    </div>
  );
}

/** 표형 본문: 표·폼을 전체 폭으로 */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24 }}>{children}</div>;
}
