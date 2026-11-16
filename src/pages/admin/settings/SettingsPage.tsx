import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Card, Tabs } from 'antd';
import { TableFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import { AccountsTab } from '@/pages/admin/settings/AccountsTab';
import { AuditTab } from '@/pages/admin/settings/AuditTab';
import { RetentionTab } from '@/pages/admin/settings/RetentionTab';
import { SystemSettingsTab } from '@/pages/admin/settings/SystemSettingsTab';

const SETTINGS_TABS: { key: string; label: string; content: ReactNode }[] = [
  { key: 'system', label: '시스템 설정', content: <SystemSettingsTab /> },
  { key: 'accounts', label: '계정', content: <AccountsTab /> },
  { key: 'audit', label: '이용 기록', content: <AuditTab /> },
  { key: 'retention', label: '데이터 보관', content: <RetentionTab /> },
];

/** 설정 / 계정 / 이용 기록 / 데이터 보관: 탭 4개짜리 한 화면. 사이드바 메뉴가 각 탭으로 바로 연결. */
export function SettingsPage() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  if (!SETTINGS_TABS.some((t) => t.key === tab))
    return <Navigate to="/admin/settings/system" replace />;

  return (
    <>
      <PageHeader title="설정 · 계정 · 이용 기록" />
      <TableFrame>
        <Card>
          <Tabs
            activeKey={tab}
            onChange={(key) => navigate(`/admin/settings/${key}`)}
            destroyOnHidden
            items={SETTINGS_TABS.map((t) => ({ key: t.key, label: t.label, children: t.content }))}
          />
        </Card>
      </TableFrame>
    </>
  );
}
