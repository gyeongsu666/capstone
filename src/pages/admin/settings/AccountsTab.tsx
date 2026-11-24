import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popover,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  useChangeRole,
  useCreateUser,
  useDeactivateUser,
  useResetPassword,
  useUsers,
} from '@/api/admin';
import { isApiError } from '@/api/client';
import type { RoleView, UserView } from '@/api/view';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime } from '@/utils/format';

const ROLE_LABEL: Record<RoleView, string> = { admin: '관리자', user: '사용자' };

/** 임시 비밀번호는 이 팝업에서 한 번만 보여준다 */
function TempPasswordModal({
  info,
  onClose,
}: {
  info: { username: string; password: string } | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!info}
      title="임시 비밀번호"
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          확인했어요
        </Button>
      }
    >
      {info && (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="이 창을 닫으면 다시 볼 수 없어요. 계정 주인에게 직접 전달하세요."
          />
          <div>
            아이디 <b>{info.username}</b>
          </div>
          <Typography.Paragraph
            copyable={{ text: info.password }}
            style={{ fontSize: 20, marginTop: 8 }}
          >
            <code>{info.password}</code>
          </Typography.Paragraph>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
            처음 로그인하면 비밀번호를 바꾸게 돼요.
          </div>
        </>
      )}
    </Modal>
  );
}

/** 사유를 받아 실행하는 버튼(비활성화·비밀번호 초기화) */
function ReasonButton({
  label,
  title,
  description,
  okText,
  danger,
  disabled,
  loading,
  onConfirm,
}: {
  label: string;
  title: string;
  description: string;
  okText: string;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Popover
      trigger="click"
      open={open && !disabled}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setReason('');
      }}
      title={title}
      content={
        <Space direction="vertical" style={{ width: 280 }}>
          <div style={{ fontSize: 13 }}>{description}</div>
          <Input.TextArea
            rows={2}
            autoFocus
            placeholder="사유 (필수, 이용 기록에 남아요)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
          />
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              size="small"
              type="primary"
              danger={danger}
              disabled={!reason.trim()}
              onClick={() => {
                onConfirm(reason.trim());
                setOpen(false);
                setReason('');
              }}
            >
              {okText}
            </Button>
          </Space>
        </Space>
      }
    >
      <Button size="small" danger={danger} disabled={disabled} loading={loading}>
        {label}
      </Button>
    </Popover>
  );
}

/**
 * 계정: 표 + 계정 추가, 줄마다 역할 변경·비활성화·비밀번호 초기화 (SYS01-007).
 * 비활성화는 되돌릴 수 없다(백엔드에 재활성화 API 없음, D06).
 */
export function AccountsTab() {
  const { message } = App.useApp();
  const me = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleView | undefined>();
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const [form] = Form.useForm<{ username: string; name: string; role: RoleView }>();
  const { items, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useUsers({
    q,
    role,
  });
  const create = useCreateUser();
  const changeRole = useChangeRole();
  const deactivate = useDeactivateUser();
  const reset = useResetPassword();

  const errorText = (e: unknown, fallback: string) =>
    isApiError(e, 'VERSION_CONFLICT')
      ? '다른 관리자가 먼저 바꿨어요. 목록을 다시 불러왔으니 확인 후 다시 시도하세요.'
      : isApiError(e)
        ? e.detail
        : fallback;

  const columns: TableProps<UserView>['columns'] = [
    {
      title: '아이디',
      key: 'username',
      render: (_, u) => (
        <span>
          {u.username} {u.id === me?.id && <Tag>나</Tag>}
        </span>
      ),
    },
    { title: '이름', dataIndex: 'name', key: 'name' },
    {
      title: '역할',
      key: 'role',
      width: 130,
      render: (_, u) => (
        <Select<RoleView>
          size="small"
          value={u.role}
          style={{ width: 100 }}
          disabled={!u.active}
          onChange={(r) =>
            changeRole.mutate(
              { id: u.id, role: r, version: u.version },
              {
                onSuccess: () => message.success(`${u.name}님 역할을 ${ROLE_LABEL[r]}로 바꿨어요.`),
                onError: (e) => message.error(errorText(e, '역할을 바꾸지 못했어요.')),
              },
            )
          }
          options={(['admin', 'user'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
        />
      ),
    },
    {
      title: '상태',
      key: 'active',
      width: 150,
      render: (_, u) => (
        <Space size={4}>
          {u.active ? <Tag color="green">사용 중</Tag> : <Tag>비활성</Tag>}
          {u.mustChangePassword && u.active && <Tag color="orange">비밀번호 변경 전</Tag>}
        </Space>
      ),
    },
    {
      title: '만든 날',
      key: 'created',
      width: 110,
      render: (_, u) => <span className="num">{formatDateTime(u.createdAt).slice(0, 5)}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 210,
      align: 'right',
      render: (_, u) =>
        u.active ? (
          <Space size={4}>
            <ReasonButton
              label="비밀번호 초기화"
              title={`${u.name}님 비밀번호를 초기화할까요?`}
              description="새 임시 비밀번호를 만들고, 로그인한 기기에서도 로그아웃돼요."
              okText="초기화"
              loading={reset.isPending && reset.variables?.id === u.id}
              onConfirm={(reason) =>
                reset.mutate(
                  { id: u.id, reason, version: u.version },
                  {
                    onSuccess: (r) =>
                      setTemp({ username: u.username, password: r.temporary_password }),
                    onError: (e) => message.error(errorText(e, '초기화하지 못했어요.')),
                  },
                )
              }
            />
            <ReasonButton
              label="비활성화"
              danger
              title={`${u.name}님 계정을 비활성화할까요?`}
              description="되돌릴 수 없어요. 계정은 지우지 않고 이용·확인 기록은 남아요. 진행 중인 사건의 주 담당자는 비활성화할 수 없어요."
              okText="비활성화"
              loading={deactivate.isPending && deactivate.variables?.id === u.id}
              onConfirm={(reason) =>
                deactivate.mutate(
                  { id: u.id, reason, version: u.version },
                  {
                    onSuccess: () => message.success(`${u.name}님 계정을 비활성화했어요.`),
                    onError: (e) => message.error(errorText(e, '비활성화하지 못했어요.')),
                  },
                )
              }
            />
          </Space>
        ) : null,
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Input.Search
            allowClear
            placeholder="이름·아이디"
            style={{ width: 220 }}
            onSearch={(v) => setQ(v.trim())}
          />
          <Select<RoleView>
            allowClear
            placeholder="역할"
            style={{ width: 120 }}
            value={role}
            onChange={setRole}
            options={(['admin', 'user'] as const).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          계정 추가
        </Button>
      </Space>
      <Table<UserView>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={isLoading}
        rowClassName={(u) => (u.active ? '' : 'decision-row-reverted')}
        pagination={false}
        footer={
          hasNextPage
            ? () => (
                <div style={{ textAlign: 'center' }}>
                  <Button loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                    더 보기
                  </Button>
                </div>
              )
            : undefined
        }
      />

      <Modal
        title="계정 추가"
        open={adding}
        onCancel={() => setAdding(false)}
        okText="만들기"
        cancelText="취소"
        okButtonProps={{ loading: create.isPending }}
        destroyOnHidden
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ role: 'user' }}
          onFinish={(v) =>
            create.mutate(
              { username: v.username.trim(), name: v.name.trim(), role: v.role },
              {
                onSuccess: (r) => {
                  setAdding(false);
                  form.resetFields();
                  setTemp({ username: r.user.username, password: r.temporary_password });
                },
              },
            )
          }
        >
          <Form.Item
            name="username"
            label="아이디"
            rules={[
              { required: true, message: '아이디를 넣으세요.' },
              { pattern: /^[a-z0-9_]{3,20}$/, message: '영문 소문자·숫자·밑줄 3~20자' },
            ]}
          >
            <Input placeholder="user3" />
          </Form.Item>
          <Form.Item
            name="name"
            label="이름"
            rules={[{ required: true, whitespace: true, message: '이름을 넣으세요.' }]}
          >
            <Input placeholder="박수색" />
          </Form.Item>
          <Form.Item name="role" label="역할">
            <Radio.Group>
              <Radio value="user">사용자 (수색 담당자)</Radio>
              <Radio value="admin">관리자</Radio>
            </Radio.Group>
          </Form.Item>
          {create.isError && (
            <Alert
              type="error"
              showIcon
              message={errorText(create.error, '계정을 만들지 못했어요.')}
            />
          )}
        </Form>
      </Modal>
      <TempPasswordModal info={temp} onClose={() => setTemp(null)} />
    </>
  );
}
