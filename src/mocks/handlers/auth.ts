import { http, HttpResponse } from 'msw';
import type {
  MessageResponse,
  ServerLoginRequest,
  ServerLoginResponse,
  ServerMeResponse,
  ServerPasswordChangeRequest,
  ServerPasswordChangeResponse,
} from '@/api/server';
import { addAudit, createSession, db, findUserByUsername, toServerUser } from '@/mocks/db';
import type { DbSession } from '@/mocks/db/schema';
import {
  clearSessionCookie,
  currentSession,
  MockError,
  readJson,
  requireUser,
  SESSION_IDLE_MS,
  setSessionCookie,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

/** 비밀번호 규칙(openapi.json 제안): 10~128자, 현재 비밀번호와 다름 */
export function checkPasswordRule(pw: string): string | null {
  if (pw.length < 10 || pw.length > 128) return '비밀번호는 10~128자여야 해요.';
  return null;
}

const expiresAt = (s: DbSession) => new Date(s.last_used_at + SESSION_IDLE_MS).toISOString();

export const authHandlers = [
  // 로그인 · 공개 · SYS00-001
  http.post(
    '/api/auth/login',
    withMock(async ({ request }) => {
      const body = await readJson<ServerLoginRequest>(request);
      if (!body.username) return validationError('username');
      if (!body.password) return validationError('password');

      const user = findUserByUsername(body.username);
      if (!user || user.password !== body.password) {
        throw new MockError(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 맞지 않아요.');
      }
      if (!user.active) {
        throw new MockError(403, 'ACCOUNT_INACTIVE', '비활성화된 계정이에요.');
      }

      const session = createSession(user.id);
      setSessionCookie(session);
      addAudit(user.id, 'LOGIN', '로그인');
      db.save();

      return HttpResponse.json<ServerLoginResponse>({
        user: toServerUser(user),
        csrf_token: session.csrf_token,
        expires_at: expiresAt(session),
      });
    }),
  ),

  // 로그아웃 · 사용자
  http.post(
    '/api/auth/logout',
    withMock(({ request }) => {
      requireUser(request);
      const session = currentSession();
      db.state.sessions = db.state.sessions.filter((s) => s !== session);
      db.save();
      clearSessionCookie();
      return HttpResponse.json<MessageResponse>({ message: '로그아웃했어요.' });
    }),
  ),

  // 내 정보 · 사용자 · SYS00-002 (R4 요청: csrf_token 포함)
  http.get(
    '/api/auth/me',
    withMock(({ request }) => {
      const user = requireUser(request);
      const session = currentSession()!;
      // R4: 조회만으로 CSRF 토큰을 바꾸지 않는다(다른 탭 보호)
      return HttpResponse.json<ServerMeResponse>(
        {
          user: toServerUser(user),
          csrf_token: session.csrf_token,
          expires_at: expiresAt(session),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }),
  ),

  // 비밀번호 변경(첫 로그인 포함) · 사용자 · SYS01-007
  // 현재 세션을 회전하고(새 쿠키·CSRF) 다른 세션은 폐기한다.
  http.post(
    '/api/auth/password',
    withMock(async ({ request }) => {
      const user = requireUser(request);
      const body = await readJson<ServerPasswordChangeRequest>(request);
      if (!body.current_password) return validationError('current_password');
      if (!body.new_password) return validationError('new_password');

      if (body.current_password !== user.password) {
        throw new MockError(401, 'CURRENT_PASSWORD_INVALID', '현재 비밀번호가 맞지 않아요.');
      }
      if (body.new_password === body.current_password) {
        throw new MockError(422, 'PASSWORD_UNCHANGED', '지금과 다른 비밀번호를 써 주세요.');
      }
      const ruleError = checkPasswordRule(body.new_password);
      if (ruleError) throw new MockError(422, 'PASSWORD_POLICY_VIOLATION', ruleError);

      user.password = body.new_password;
      user.must_change_password = false;
      db.state.sessions = db.state.sessions.filter((s) => s.user_id !== user.id);
      const session = createSession(user.id);
      setSessionCookie(session);
      addAudit(user.id, 'ACCOUNT_CHANGE', '비밀번호 변경');
      db.save();

      return HttpResponse.json<ServerPasswordChangeResponse>({
        user: toServerUser(user),
        csrf_token: session.csrf_token,
        expires_at: expiresAt(session),
      });
    }),
  ),
];
