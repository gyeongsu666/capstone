import { Outlet } from 'react-router-dom';
import { Layout } from 'antd';
import { useMeSync } from '@/api/auth';
import { Sidebar } from '@/app/layout/Sidebar';
import { useAlertNotifier } from '@/app/layout/useAlertNotifier';
import { UndoToastHost } from '@/components/UndoToast';
import { COLLAPSE_BREAKPOINT } from '@/theme';
import { useWindowWidth } from '@/utils/useWindowWidth';

/** 로그인 뒤 공통 틀: 사이드바 + 본문(각 화면이 PageHeader와 본문 틀을 직접 그림) */
export function AppLayout() {
  const width = useWindowWidth();
  useMeSync();
  // 출현 알림 숫자 폴링 + 새 알림이면 알림음·브라우저 알림
  const unread = useAlertNotifier();
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar
        collapsed={width < COLLAPSE_BREAKPOINT}
        alertCount={unread?.count ?? 0}
        alertCaseIds={unread?.byCase.filter((x) => x.count > 0).map((x) => x.caseId)}
      />
      <Layout.Content
        style={{ height: '100vh', display: 'flex', flexDirection: 'column', minWidth: 0 }}
      >
        <Outlet />
      </Layout.Content>
      <UndoToastHost />
    </Layout>
  );
}
