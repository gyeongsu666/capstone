import { useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined, RollbackOutlined } from '@ant-design/icons';
import { UNDO_TOAST_MS, useUndoToastStore } from '@/stores/undoToast';

/**
 * 되돌리기 알림: 화면 아래 가운데 8초. 한 번에 하나, 새 판단이 앞 알림을 대신한다.
 * 띄우기: useUndoToastStore.getState().show('C4 15:09 확정함', () => revert(id))
 */
export function UndoToastHost() {
  const current = useUndoToastStore((s) => s.current);
  const hide = useUndoToastStore((s) => s.hide);

  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(hide, UNDO_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [current, hide]);

  if (!current) return null;

  return (
    <div
      key={current.id}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 1100,
        minWidth: 320,
        background: '#1f2937',
        color: '#fff',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 10px 16px' }}
      >
        <span className="num" style={{ flex: 1 }}>
          {current.message}
        </span>
        <Button
          size="small"
          icon={<RollbackOutlined />}
          onClick={() => {
            current.onUndo();
            hide();
          }}
        >
          되돌리기
        </Button>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={hide}
          aria-label="닫기"
          style={{ color: '#9ca3af' }}
        />
      </div>
      {/* 남은 시간 막대 */}
      <div
        style={{
          height: 3,
          background: '#60a5fa',
          transformOrigin: 'left',
          animation: `refind-undo-countdown ${UNDO_TOAST_MS}ms linear forwards`,
        }}
      />
    </div>
  );
}
