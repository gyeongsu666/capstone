import { useState } from 'react';
import { Button, Dropdown, Tag, type MenuProps } from 'antd';
import {
  DownOutlined,
  LockOutlined,
  StopOutlined,
  TeamOutlined,
  VideoCameraAddOutlined,
} from '@ant-design/icons';
import { useCaseView } from '@/api/cases';
import { CaseVideoModal } from '@/pages/cases/manage/CaseVideoModal';
import { CloseCaseModal } from '@/pages/cases/manage/CloseCaseModal';
import { MembersModal } from '@/pages/cases/manage/MembersModal';
import { useAuthStore } from '@/stores/auth';

type Dialog = 'video' | 'members' | 'close' | null;

/** 사건 안 헤더의 "사건 관리" 메뉴: 사건 영상 추가 · 담당자 변경 · 사건 종료 (사용자도 가능) */
export function CaseManageMenu({ caseId }: { caseId: string }) {
  const { data: c } = useCaseView(caseId);
  const me = useAuthStore((s) => s.user);
  const [dialog, setDialog] = useState<Dialog>(null);

  if (!c) return null;

  if (c.closed) {
    return (
      <Tag icon={<LockOutlined />} style={{ margin: 0 }}>
        종료된 사건 · 읽기 전용
      </Tag>
    );
  }

  const canEditMembers = me?.role === 'ADMIN' || me?.id === c.createdBy.id;
  const items: MenuProps['items'] = [
    { key: 'video', icon: <VideoCameraAddOutlined />, label: '사건 영상 추가' },
    {
      key: 'members',
      icon: <TeamOutlined />,
      label: canEditMembers ? '담당자 변경' : '담당자 변경 (등록자·관리자만)',
      disabled: !canEditMembers,
    },
    { type: 'divider' },
    { key: 'close', icon: <StopOutlined />, label: '사건 종료', danger: true },
  ];

  return (
    <>
      <Dropdown
        menu={{ items, onClick: ({ key }) => setDialog(key as Dialog) }}
        trigger={['click']}
      >
        <Button>
          사건 관리 <DownOutlined />
        </Button>
      </Dropdown>
      {dialog === 'video' && <CaseVideoModal caseData={c} open onClose={() => setDialog(null)} />}
      {dialog === 'members' && <MembersModal caseData={c} open onClose={() => setDialog(null)} />}
      {dialog === 'close' && <CloseCaseModal caseData={c} open onClose={() => setDialog(null)} />}
    </>
  );
}
