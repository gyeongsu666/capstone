import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Result } from 'antd';
import { useAuthStore } from '@/stores/auth';

/** 로그인 안 했거나 첫 로그인 비밀번호 변경 전이면 로그인 화면으로 */
export function RequireAuth() {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  if (!token || !user || user.must_change_password) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** 관리자 화면. 서버도 역할을 검사하지만 화면에서도 먼저 막는다. */
export function RequireAdmin() {
  const role = useAuthStore((s) => s.user?.role);
  if (role !== 'ADMIN') return <Forbidden />;
  return <Outlet />;
}

/** 403 권한 없음 안내 */
export function Forbidden({ message }: { message?: string }) {
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="권한이 없어요"
      subTitle={message ?? '이 화면을 볼 권한이 없어요. 필요하면 관리자에게 요청하세요.'}
      extra={
        <Button type="primary" onClick={() => navigate('/cases')}>
          사건 목록으로
        </Button>
      }
      style={{ margin: 'auto' }}
    />
  );
}

/** 404 */
export function NotFound({ message }: { message?: string }) {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="찾을 수 없어요"
      subTitle={message ?? '주소가 잘못됐거나 없어진 화면이에요.'}
      extra={
        <Button type="primary" onClick={() => navigate('/cases')}>
          사건 목록으로
        </Button>
      }
      style={{ margin: 'auto' }}
    />
  );
}
