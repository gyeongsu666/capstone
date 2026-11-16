import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCreateUser, useResetPassword, useUpdateUser, useUsers } from '@/api/admin';
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

/** 계정: 표 + 계정 추가, 줄마다 역할 변경·비활성화·비밀번호 초기화 (SYS01-007) */
export function AccountsTab() {
  const { message } = App.useApp();
  const me = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<RoleView | undefined>();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const [form] = Form.useForm<{ username: string; name: string; role: RoleView }>();
  const { data, isLoading } = useUsers({ q, role, page });
  const create = useCreateUser();
  const update = useUpdateUser();
  const reset = useResetPassword();

  const errorText = (e: unknown, fallback: string) => (isApiError(e) ? e.detail : fallback);

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
            update.mutate(
              { id: u.id, role: r },
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
      render: (_, u) => (
        <Space size={4}>
          <Popconfirm
            title={`${u.name}님 비밀번호를 초기화할까요?`}
            description="지금 로그인한 기기에서도 로그아웃돼요."
            okText="초기화"
            cancelText="취소"
            onConfirm={() =>
              reset.mutate(u.id, {
                onSuccess: (r) => setTemp({ username: u.username, password: r.temp_password }),
                onError: (e) => message.error(errorText(e, '초기화하지 못했어요.')),
              })
            }
          >
            <Button size="small" disabled={!u.active}>
              비밀번호 초기화
            </Button>
          </Popconfirm>
          <Popconfirm
            title={
              u.active ? `${u.name}님 계정을 비활성화할까요?` : `${u.name}님 계정을 다시 쓸까요?`
            }
            description={u.active ? '계정은 지우지 않고 이용·확인 기록은 남아요.' : undefined}
            okText={u.active ? '비활성화' : '다시 쓰기'}
            okButtonProps={{ danger: u.active }}
            cancelText="취소"
            onConfirm={() =>
              update.mutate(
                { id: u.id, active: !u.active },
                {
                  onSuccess: () =>
                    message.success(u.active ? '비활성화했어요.' : '다시 쓸 수 있게 했어요.'),
                  onError: (e) => message.error(errorText(e, '바꾸지 못했어요.')),
                },
              )
            }
          >
            <Button size="small" danger={u.active}>
              {u.active ? '비활성화' : '다시 쓰기'}
            </Button>
          </Popconfirm>
        </Space>
      ),
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
            onSearch={(v) => {
              setQ(v.trim());
              setPage(1);
            }}
          />
          <Select<RoleView>
            allowClear
            placeholder="역할"
            style={{ width: 120 }}
            value={role}
            onChange={(v) => {
              setRole(v);
              setPage(1);
            }}
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
        dataSource={data?.items}
        loading={isLoading}
        rowClassName={(u) => (u.active ? '' : 'decision-row-reverted')}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total,
          onChange: setPage,
          hideOnSinglePage: true,
        }}
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
                  setTemp({ username: r.user.username, password: r.temp_password });
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
