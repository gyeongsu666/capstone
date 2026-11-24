import {
  delay,
  HttpResponse,
  type DefaultBodyType,
  type HttpResponseResolver,
  type PathParams,
} from 'msw';
import type { ErrorResponse } from '@/api/server';
import { control } from '@/mocks/control';
import { db, findCase, findUser, newId } from '@/mocks/db';
import type { DbCase, DbSession, DbUser } from '@/mocks/db/schema';

/** 일정 시간 미사용 시 세션 만료. 실제 값은 협의 전(임시 60분). */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

/** 세션 쿠키 이름(openapi.json securitySchemes.sessionCookie) */
export const SESSION_COOKIE = 'refind_session';

type FieldError = ErrorResponse['error']['fields'][number];

/** 핸들러 안에서 던지면 openapi.json ErrorResponse 모양의 에러 응답이 된다 */
export class MockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly fields: FieldError[] = [],
  ) {
    super(detail);
  }
}

const errorJson = (status: number, code: string, message: string, fields: FieldError[] = []) => {
  const requestId = newId('req');
  return HttpResponse.json<ErrorResponse>(
    {
      request_id: requestId,
      error: { code, message, fields, context: {}, retryable: status >= 500 || status === 429 },
    },
    { status, headers: { 'X-Request-ID': requestId } },
  );
};

const FORCED: Record<number, { code: string; detail: string }> = {
  401: { code: 'SESSION_EXPIRED', detail: '(개발 패널) 강제 401: 세션이 만료됐어요.' },
  403: { code: 'FORBIDDEN', detail: '(개발 패널) 강제 403: 권한이 없어요.' },
  409: { code: 'VERSION_CONFLICT', detail: '(개발 패널) 강제 409: 다른 사람이 먼저 수정했어요.' },
  500: { code: 'INTERNAL_ERROR', detail: '(개발 패널) 강제 500: 서버 오류예요.' },
};

/**
 * 모든 핸들러를 감싼다: 300~800ms 지연 → 개발 패널 강제 에러 → 실행 → MockError를 에러 응답으로.
 */
export function withMock<
  P extends PathParams = PathParams,
  B extends DefaultBodyType = DefaultBodyType,
>(resolver: HttpResponseResolver<P, B>): HttpResponseResolver<P, B> {
  return async (info) => {
    if (control.get().delayEnabled) await delay(300 + Math.random() * 500);

    const forced = control.takeNextError();
    if (forced !== null) {
      const f = FORCED[forced];
      if (forced === 401) endCurrentSession();
      return errorJson(forced, f.code, f.detail);
    }

    try {
      return await resolver(info);
    } catch (e) {
      if (e instanceof MockError) return errorJson(e.status, e.code, e.detail, e.fields);
      console.error('[mock] 핸들러 오류', e);
      return errorJson(500, 'INTERNAL_ERROR', '가짜 서버 내부 오류');
    }
  };
}

/** 422 VALIDATION_ERROR */
export function validationError(field: string, message = '필수 항목이에요.') {
  return errorJson(422, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', [
    { field, code: 'required', message },
  ]);
}

// ---------- 세션 쿠키 ----------
// 실제 서버는 HttpOnly 쿠키를 응답 헤더로 붙인다. 가짜 서버는 브라우저 안에서 돌기 때문에
// 같은 이름의 쿠키를 직접 쓰고 읽는다. 프론트 코드(src/api)는 이 쿠키를 건드리지 않는다.

export function setSessionCookie(session: DbSession) {
  document.cookie = `${SESSION_COOKIE}=${session.id}; Path=/; SameSite=Lax`;
}

export function clearSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readSessionCookie(): string | null {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return hit ? hit.slice(SESSION_COOKIE.length + 1) || null : null;
}

export function currentSession(): DbSession | undefined {
  const id = readSessionCookie();
  return id ? db.state.sessions.find((s) => s.id === id) : undefined;
}

function endCurrentSession() {
  const session = currentSession();
  if (session) {
    db.state.sessions = db.state.sessions.filter((s) => s !== session);
    db.save();
  }
  clearSessionCookie();
}

// ---------- 권한 검사 (가짜 서버도 화면과 별개로 검사한다) ----------

/** 첫 로그인 비밀번호 변경 전에도 허용하는 API(openapi.json x-security-rules.first_login) */
const FIRST_LOGIN_ALLOWED = ['/api/auth/me', '/api/auth/password', '/api/auth/logout'];

/**
 * 세션 쿠키 → 로그인한 사용자.
 * - 없음 401 UNAUTHENTICATED, 오래 안 씀 401 SESSION_EXPIRED
 * - 변경 요청(GET 외)은 X-CSRF-Token 검사, 틀리면 403 CSRF_INVALID
 * - 첫 로그인 비밀번호 변경 전이면 me·password·logout 외 403 PASSWORD_CHANGE_REQUIRED
 */
export function requireUser(request: Request): DbUser {
  const session = currentSession();
  if (!session) throw new MockError(401, 'UNAUTHENTICATED', '로그인이 필요해요.');

  if (Date.now() - session.last_used_at > SESSION_IDLE_MS) {
    endCurrentSession();
    throw new MockError(401, 'SESSION_EXPIRED', '오래 사용하지 않아 로그아웃됐어요.');
  }

  const user = findUser(session.user_id);
  if (!user || !user.active) {
    endCurrentSession();
    throw new MockError(401, 'UNAUTHENTICATED', '로그인이 필요해요.');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (request.headers.get('X-CSRF-Token') !== session.csrf_token) {
      throw new MockError(
        403,
        'CSRF_INVALID',
        '요청을 확인하지 못했어요. 새로고침 후 다시 시도하세요.',
      );
    }
  }

  const path = new URL(request.url).pathname;
  if (user.must_change_password && !FIRST_LOGIN_ALLOWED.includes(path)) {
    throw new MockError(403, 'PASSWORD_CHANGE_REQUIRED', '비밀번호를 먼저 바꿔 주세요.');
  }

  session.last_used_at = Date.now();
  db.save();
  return user;
}

export function requireAdmin(user: DbUser) {
  if (user.role !== 'ADMIN') throw new MockError(403, 'FORBIDDEN', '관리자만 할 수 있어요.');
}

/** 사용자는 맡은 사건만, 관리자는 모든 사건 */
export function requireCaseAccess(user: DbUser, caseId: string): DbCase {
  const c = findCase(caseId);
  // 맡지 않은 사건도 404(존재 여부를 알려 주지 않는다, openapi.json x-security-rules)
  if (!c || (user.role !== 'ADMIN' && !c.member_ids.includes(user.id))) {
    throw new MockError(404, 'RESOURCE_NOT_FOUND', '사건을 찾을 수 없거나 접근 권한이 없습니다.');
  }
  return c;
}

/** 종료된 사건에 변경 요청 */
export function requireOpenCase(c: DbCase) {
  if (c.status === 'CLOSED') throw new MockError(409, 'CASE_CLOSED', '종료된 사건이에요.');
}

/** JSON 본문 읽기(없거나 깨졌으면 빈 객체) */
export async function readJson<T extends object>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}

// ---------- cursor 목록 ----------

/** cursor 목록 응답. cursor는 불투명 문자열(가짜 서버는 시작 위치). limit 기본 30, 최대 100 */
export function cursorPage<T>(items: T[], request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? 30);
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 30;
  const cursor = url.searchParams.get('cursor');
  const start = cursor ? Number(cursor) || 0 : 0;
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : null;
  return { items: page, next_cursor: next, has_more: next !== null };
}

/** expected_version이 맞지 않으면 409 VERSION_CONFLICT */
export function requireVersion(current: number, expected: unknown) {
  if (typeof expected !== 'number')
    throw new MockError(422, 'VALIDATION_ERROR', 'expected_version이 필요해요.', [
      { field: 'expected_version', code: 'required', message: '필수 항목이에요.' },
    ]);
  if (expected !== current)
    throw new MockError(
      409,
      'VERSION_CONFLICT',
      '다른 사람이 먼저 수정했어요. 다시 불러온 뒤 시도하세요.',
    );
}
