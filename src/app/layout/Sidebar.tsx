import type { ReactNode } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { Badge, Button, Layout, Menu, Tooltip, type MenuProps } from 'antd';
import {
  AimOutlined,
  EnvironmentOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  TeamOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useLogout } from '@/api/auth';
import { useCase } from '@/api/cases';
import { toCaseCardView } from '@/api/view';
import { CaseCard } from '@/components/CaseCard';
import { useAuthStore } from '@/stores/auth';
import { useCaseNavStore } from '@/stores/case';
import { layoutColor, SIDER_COLLAPSED_WIDTH, SIDER_WIDTH } from '@/theme';
import { roleLabel } from '@/utils/format';

type MenuItem = Required<MenuProps>['items'][number];

interface SidebarProps {
  collapsed: boolean;
  /** 현재 위치 수색 메뉴의 알림 숫자(맡은 사건 전체) */
  alertCount?: number;
  /** 새 알림이 있는 사건 */
  alertCaseIds?: string[];
}

export function Sidebar({ collapsed, alertCount = 0, alertCaseIds = [] }: SidebarProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const lastCaseId = useCaseNavStore((s) => s.lastCaseId);
  const logoutMutation = useLogout();

  const caseMatch = useMatch('/cases/:caseId/*');
  const routeCaseId = caseMatch?.params.caseId;
  const caseId = routeCaseId ?? lastCaseId;
  const { data: caseData } = useCase(routeCaseId);

  const isAdmin = user?.role === 'ADMIN';

  // 동선 추적·현재 위치 수색은 사건 안의 화면. 지금 사건(없으면 마지막 사건)으로 이동한다.
  // 현재 위치 수색은 지금 사건에 알림이 없고 다른 사건에 있으면 그 사건으로 간다
  const alertTarget =
    caseId && alertCaseIds.includes(caseId) ? caseId : (alertCaseIds[0] ?? caseId);

  const caseItem = (
    path: string,
    label: string,
    icon: ReactNode,
    extra?: ReactNode,
    target: string | null = caseId,
  ): MenuItem => ({
    key: target ? `/cases/${target}/${path}` : `disabled:${path}`,
    icon,
    disabled: !target,
    label: target ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {label}
        {extra}
      </span>
    ) : (
      <Tooltip title="사건 목록에서 사건을 먼저 고르세요" placement="right">
        {label}
      </Tooltip>
    ),
  });

  const alertBadge =
    alertCount > 0 ? <Badge count={alertCount} size="small" style={{ boxShadow: 'none' }} /> : null;

  const searchItems: MenuItem[] = [
    {
      key: '/cases',
      icon: <FolderOpenOutlined />,
      label: isAdmin ? (
        <span>
          사건 목록{' '}
          <span style={{ color: layoutColor.siderTextMuted, fontSize: 12 }}>· 전체 사건</span>
        </span>
      ) : (
        '사건 목록'
      ),
    },
    caseItem('tracking', '동선 추적', <NodeIndexOutlined />),
    caseItem(
      'search-area',
      '현재 위치 수색',
      collapsed && alertCount > 0 ? (
        <Badge dot>
          <AimOutlined />
        </Badge>
      ) : (
        <AimOutlined />
      ),
      alertBadge,
      alertTarget,
    ),
  ];

  const groupedItems: MenuItem[] = isAdmin
    ? [
        {
          type: 'group',
          label: '환경 설정',
          children: [
            { key: '/admin/camera-map', icon: <EnvironmentOutlined />, label: '카메라·지도 설정' },
            { key: '/admin/videos', icon: <VideoCameraOutlined />, label: '영상 등록·분석' },
          ],
        },
        {
          type: 'group',
          label: '운영',
          children: [
            { key: '/admin/settings/system', icon: <SettingOutlined />, label: '시스템 설정' },
            { key: '/admin/settings/accounts', icon: <TeamOutlined />, label: '계정·권한' },
            { key: '/admin/settings/audit', icon: <FileSearchOutlined />, label: '이용 기록' },
          ],
        },
        { type: 'group', label: '수색 (사용자 기능)', children: searchItems },
      ]
    : searchItems;

  // 접힌 사이드바에서는 묶음 제목 대신 구분선
  const items: MenuItem[] = collapsed
    ? groupedItems.flatMap((item, i) =>
        item && 'type' in item && item.type === 'group'
          ? [...(i > 0 ? [{ type: 'divider' as const }] : []), ...(item.children ?? [])]
          : [item],
      )
    : groupedItems;

  // 데이터 보관 탭은 사이드바 메뉴가 없으므로 시스템 설정을 선택 표시
  const selectedKey = pathname.startsWith('/admin/settings/retention')
    ? '/admin/settings/system'
    : pathname.replace(/\/$/, '');

  // 세션이 지워지면 RequireAuth가 로그인 화면으로 보낸다
  const logout = () => logoutMutation.mutate();

  return (
    <Layout.Sider
      className="app-sider"
      width={SIDER_WIDTH}
      collapsedWidth={SIDER_COLLAPSED_WIDTH}
      collapsed={collapsed}
      trigger={null}
      style={{ height: '100vh', position: 'sticky', top: 0, left: 0 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          style={{
            padding: collapsed ? '20px 0 12px' : '20px 20px 12px',
            textAlign: collapsed ? 'center' : 'left',
          }}
        >
          <div style={{ color: '#fff', fontSize: collapsed ? 14 : 20, fontWeight: 700 }}>
            {collapsed ? 'RF' : 'ReFind'}
          </div>
          {!collapsed && user && (
            <span
              style={{
                display: 'inline-block',
                marginTop: 6,
                padding: '1px 8px',
                borderRadius: 10,
                fontSize: 12,
                background: 'rgba(22,119,255,0.18)',
                color: '#8fb8ff',
              }}
            >
              {roleLabel[user.role]}
            </span>
          )}
        </div>

        {!collapsed && caseData && (
          <CaseCard caseData={toCaseCardView(caseData)} style={{ margin: '4px 12px 12px' }} />
        )}

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={items}
            onClick={({ key }) => {
              if (!key.startsWith('disabled:')) navigate(key);
            }}
          />
        </div>

        <div
          style={{
            borderTop: '1px solid #26304a',
            padding: collapsed ? '12px 0' : '12px 16px 12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            color: layoutColor.siderText,
          }}
        >
          {!collapsed && (
            <span
              style={{
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user?.name}
              <span style={{ color: layoutColor.siderTextMuted }}> ({user?.username})</span>
            </span>
          )}
          <Tooltip title="로그아웃" placement="right">
            <Button
              type="text"
              size="small"
              icon={<LogoutOutlined />}
              onClick={logout}
              loading={logoutMutation.isPending}
              style={{ color: layoutColor.siderText }}
              aria-label="로그아웃"
            />
          </Tooltip>
        </div>
      </div>
    </Layout.Sider>
  );
}
