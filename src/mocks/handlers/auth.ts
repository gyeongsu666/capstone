import { http, HttpResponse } from 'msw';
import type { LoginRequest, LoginResponse, PasswordChangeRequest, User } from '@/api/types';
import { addAudit, createSession, db, findUserByUsername, toUser } from '@/mocks/db';
import {
  MockError,
  readJson,
  requireUser,
  SESSION_IDLE_MS,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

/** 비밀번호 규칙은 협의 전. 임시: 8자 이상, 영문과 숫자를 모두 포함. */
export function checkPasswordRule(pw: string): string | null {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 해요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 모두 넣어 주세요.';
  return null;
}

export const authHandlers = [
  // 로그인 · 공개 · SYS00-001
  http.post(
    '/api/auth/login',
    withMock(async ({ request }) => {
      const body = await readJson<LoginRequest>(request);
      if (!body.username) return validationError('username');
      if (!body.password) return validationError('password');

      const user = findUserByUsername(body.username);
      if (!user || user.password !== body.password) {
        throw new MockError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 맞지 않아요.');
      }
      if (!user.active) {
        throw new MockError(403, 'ACCOUNT_DISABLED', '비활성화된 계정이에요.');
      }

      const token = createSession(user.id);
      addAudit(user.id, 'LOGIN', '로그인');
      db.save();

      return HttpResponse.json<LoginResponse>({
        access_token: token,
        token_type: 'bearer',
        expires_in: SESSION_IDLE_MS / 1000,
        user: toUser(user),
      });
    }),
  ),

  // 로그아웃 · 사용자
  http.post(
    '/api/auth/logout',
    withMock(({ request }) => {
      requireUser(request);
      const token = request.headers.get('Authorization')?.slice(7);
      db.state.sessions = db.state.sessions.filter((s) => s.token !== token);
      db.save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // 내 정보 · 사용자 · SYS00-002
  http.get(
    '/api/auth/me',
    withMock(({ request }) => HttpResponse.json<User>(toUser(requireUser(request)))),
  ),

  // 비밀번호 변경(첫 로그인 포함) · 사용자 · SYS01-007
  http.post(
    '/api/auth/password',
    withMock(async ({ request }) => {
      const user = requireUser(request);
      const body = await readJson<PasswordChangeRequest>(request);
      if (!body.current_password) return validationError('current_password');
      if (!body.new_password) return validationError('new_password');

      if (body.current_password !== user.password) {
        throw new MockError(400, 'WRONG_PASSWORD', '현재 비밀번호가 맞지 않아요.');
      }
      const ruleError = checkPasswordRule(body.new_password);
      if (ruleError) throw new MockError(400, 'WEAK_PASSWORD', ruleError);
      if (body.new_password === body.current_password) {
        throw new MockError(400, 'WEAK_PASSWORD', '지금과 다른 비밀번호를 써 주세요.');
      }

      user.password = body.new_password;
      user.must_change_password = false;
      addAudit(user.id, 'ACCOUNT_CHANGE', '비밀번호 변경');
      db.save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),
];
