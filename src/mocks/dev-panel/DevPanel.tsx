import { useState, useSyncExternalStore } from 'react';
import { Button, Card, Divider, Popconfirm, Radio, Space, Switch, Typography } from 'antd';
import { BugOutlined, CloseOutlined } from '@ant-design/icons';
import { startSession } from '@/api/auth';
import { control, type ForcedErrorStatus } from '@/mocks/control';
import { addAudit, createSession, db, findUserByUsername, toUser } from '@/mocks/db';
import { useAuthStore } from '@/stores/auth';

const ACCOUNTS = [
  { username: 'admin', label: 'admin · 관리자' },
  { username: 'user1', label: 'user1 · 김수색' },
  { username: 'user2', label: 'user2 · 이수색' },
] as const;

const ERRORS: ForcedErrorStatus[] = [401, 403, 409, 500];

/** 가짜 서버로 바로 로그인(비밀번호를 바꿨어도 전환 가능) */
function switchAccount(username: string) {
  const user = findUserByUsername(username);
  if (!user) return;
  const token = createSession(user.id);
  addAudit(user.id, 'LOGIN', '로그인 (개발 패널 전환)');
  db.save();
  startSession(token, toUser(user));
  window.location.assign('/cases');
}

function resetData() {
  const username = useAuthStore.getState().user?.username;
  db.reset();
  const user = username ? findUserByUsername(username) : undefined;
  if (user) {
    startSession(createSession(user.id), toUser(user));
    db.save();
  } else {
    useAuthStore.getState().clearSession('manual');
  }
  window.location.reload();
}

/** 개발 패널: 데이터 초기화, 지연 끄기, 다음 요청 강제 에러, 계정 빠른 전환 (개발 모드 + MSW에서만) */
export default function DevPanel() {
  const [open, setOpen] = useState(false);
  const ctl = useSyncExternalStore(control.subscribe, control.get);
  const currentUsername = useAuthStore((s) => s.user?.username);

  if (!open) {
    return (
      <Button
        size="small"
        icon={<BugOutlined />}
        onClick={() => setOpen(true)}
        // 왼쪽 아래(사이드바 사용자 줄 위): 오른쪽 아래의 폼 버튼·되돌리기 알림과 겹치지 않게
        style={{ position: 'fixed', left: 8, bottom: 56, zIndex: 2000, opacity: 0.85 }}
      >
        DEV{ctl.nextError ? ` · ${ctl.nextError}` : ''}
      </Button>
    );
  }

  return (
    <Card
      size="small"
      title={
        <span>
          <BugOutlined /> 개발 패널 (가짜 서버)
        </span>
      }
      extra={
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={() => setOpen(false)}
          aria-label="닫기"
        />
      }
      style={{
        position: 'fixed',
        left: 8,
        bottom: 56,
        zIndex: 2000,
        width: 280,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        계정 빠른 전환
      </Typography.Text>
      <Space direction="vertical" style={{ width: '100%', marginTop: 4 }} size={4}>
        {ACCOUNTS.map((a) => (
          <Button
            key={a.username}
            size="small"
            block
            type={currentUsername === a.username ? 'primary' : 'default'}
            onClick={() => switchAccount(a.username)}
          >
            {a.label}
          </Button>
        ))}
      </Space>

      <Divider style={{ margin: '12px 0' }} />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        다음 요청 강제 에러 (한 번)
      </Typography.Text>
      <div style={{ marginTop: 4 }}>
        <Radio.Group
          size="small"
          optionType="button"
          value={ctl.nextError ?? 0}
          onChange={(e) => {
            const v = e.target.value as ForcedErrorStatus | 0;
            control.setNextError(v === 0 ? null : v);
          }}
          options={[
            { label: '없음', value: 0 },
            ...ERRORS.map((s) => ({ label: String(s), value: s })),
          ]}
        />
      </div>

      <Divider style={{ margin: '12px 0' }} />

      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13 }}>응답 지연 300~800ms</span>
        <Switch
          size="small"
          checked={ctl.delayEnabled}
          onChange={(v) => control.setDelayEnabled(v)}
        />
      </Space>

      <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 13 }}>다시 검색하면 새 후보 1~2개</span>
        <Switch
          size="small"
          checked={ctl.fakeNewCandidates}
          onChange={(v) => control.setFakeNewCandidates(v)}
        />
      </Space>

      <Divider style={{ margin: '12px 0' }} />

      <Popconfirm
        title="데이터를 처음 상태로 되돌릴까요?"
        description="시각 기준(R)을 지금으로 다시 잡아요."
        okText="초기화"
        cancelText="취소"
        onConfirm={resetData}
        // 패널(zIndex 2000)보다 위에 떠야 버튼을 누를 수 있다
        zIndex={2100}
      >
        <Button size="small" danger block>
          데이터 초기화
        </Button>
      </Popconfirm>
    </Card>
  );
}
