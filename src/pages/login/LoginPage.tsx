import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useChangePassword, useLogin, useLogout } from '@/api/auth';
import { isApiError } from '@/api/client';
import type { LoginRequest } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { layoutColor } from '@/theme';

const loginErrorMessage = (e: unknown) => {
  if (isApiError(e, 'INVALID_CREDENTIALS')) return '아이디 또는 비밀번호가 맞지 않아요.';
  if (isApiError(e, 'ACCOUNT_DISABLED')) return '비활성화된 계정이에요. 관리자에게 문의하세요.';
  if (isApiError(e)) return e.detail;
  return '로그인하지 못했어요. 잠시 뒤 다시 시도하세요.';
};

/** 로그인 · 첫 로그인 비밀번호 변경 (같은 카드가 바뀜) */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const logoutReason = useAuthStore((s) => s.logoutReason);

  // 로그인 폼에서 넣은 비밀번호. 비밀번호 변경 폼에서 현재 비밀번호로 다시 쓴다(새로고침하면 사라짐).
  const [currentPassword, setCurrentPassword] = useState<string | null>(null);

  const goNext = () => navigate(from && from !== '/login' ? from : '/cases', { replace: true });

  if (token && user && !user.must_change_password) {
    return <Navigate to={from && from !== '/login' ? from : '/cases'} replace />;
  }

  const mustChange = !!(token && user?.must_change_password);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: layoutColor.siderBg,
      }}
    >
      <Card style={{ width: 380 }} styles={{ body: { padding: 32 } }}>
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={3}>ReFind</Typography.Title>
          <Typography.Text type="secondary">CCTV 기반 실종자 동선 추적 시스템</Typography.Text>
        </div>
        {mustChange ? (
          <PasswordChangeForm currentPassword={currentPassword} onDone={goNext} />
        ) : (
          // 로그인에 성공하면 세션이 저장되고, 이 컴포넌트가 다시 그려지며
          // 이동(위 Navigate)하거나 비밀번호 변경 폼으로 바뀐다.
          <LoginForm expired={logoutReason === 'expired'} onSubmitPassword={setCurrentPassword} />
        )}
      </Card>
    </div>
  );
}

function LoginForm({
  expired,
  onSubmitPassword,
}: {
  expired: boolean;
  /** 첫 로그인이면 비밀번호 변경 폼에서 현재 비밀번호로 다시 쓴다 */
  onSubmitPassword: (password: string) => void;
}) {
  const loginMutation = useLogin();

  const onFinish = (values: LoginRequest) => {
    onSubmitPassword(values.password);
    loginMutation.mutate(values);
  };

  return (
    <Form<LoginRequest> layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
      {expired && !loginMutation.isError && (
        <Alert
          type="info"
          showIcon
          message="오래 사용하지 않아 로그아웃됐어요. 다시 로그인하세요."
          style={{ marginBottom: 16 }}
        />
      )}
      {loginMutation.isError && (
        <Alert
          type="error"
          showIcon
          message={loginErrorMessage(loginMutation.error)}
          style={{ marginBottom: 16 }}
        />
      )}
      <Form.Item
        name="username"
        label="아이디"
        rules={[{ required: true, message: '아이디를 입력하세요.' }]}
      >
        <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
      </Form.Item>
      <Form.Item
        name="password"
        label="비밀번호"
        rules={[{ required: true, message: '비밀번호를 입력하세요.' }]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loginMutation.isPending}>
        로그인
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        계정은 관리자에게 요청하세요.
      </Typography.Paragraph>
    </Form>
  );
}

interface PasswordFormValues {
  current_password?: string;
  new_password: string;
  confirm: string;
}

function PasswordChangeForm({
  currentPassword,
  onDone,
}: {
  currentPassword: string | null;
  onDone: () => void;
}) {
  const changeMutation = useChangePassword();
  const logoutMutation = useLogout();
  const user = useAuthStore((s) => s.user);

  const onFinish = (values: PasswordFormValues) => {
    changeMutation.mutate(
      {
        current_password: currentPassword ?? values.current_password ?? '',
        new_password: values.new_password,
      },
      { onSuccess: onDone },
    );
  };

  return (
    <Form<PasswordFormValues>
      layout="vertical"
      onFinish={onFinish}
      requiredMark={false}
      size="large"
    >
      <Alert
        type="info"
        showIcon
        message={`${user?.name ?? ''}님, 처음 로그인했어요`}
        description="계속하려면 비밀번호를 바꿔 주세요."
        style={{ marginBottom: 16 }}
      />
      {changeMutation.isError && (
        <Alert
          type="error"
          showIcon
          message={
            isApiError(changeMutation.error)
              ? changeMutation.error.detail
              : '비밀번호를 바꾸지 못했어요.'
          }
          style={{ marginBottom: 16 }}
        />
      )}
      {currentPassword === null && (
        <Form.Item
          name="current_password"
          label="현재 비밀번호"
          rules={[{ required: true, message: '현재(임시) 비밀번호를 입력하세요.' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
      )}
      <Form.Item
        name="new_password"
        label="새 비밀번호"
        extra="8자 이상, 영문과 숫자를 모두 넣어 주세요."
        rules={[{ required: true, message: '새 비밀번호를 입력하세요.' }]}
      >
        <Input.Password autoComplete="new-password" autoFocus />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="새 비밀번호 확인"
        dependencies={['new_password']}
        rules={[
          { required: true, message: '한 번 더 입력하세요.' },
          ({ getFieldValue }) => ({
            validator: (_, value) =>
              !value || getFieldValue('new_password') === value
                ? Promise.resolve()
                : Promise.reject(new Error('새 비밀번호와 같지 않아요.')),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={changeMutation.isPending}>
        비밀번호 바꾸기
      </Button>
      <Button
        type="link"
        block
        style={{ marginTop: 8 }}
        onClick={() => logoutMutation.mutate()}
        disabled={changeMutation.isPending}
      >
        다른 계정으로 로그인
      </Button>
    </Form>
  );
}
