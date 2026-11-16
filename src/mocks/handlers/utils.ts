import {
  delay,
  HttpResponse,
  type DefaultBodyType,
  type HttpResponseResolver,
  type PathParams,
} from 'msw';
import type { ErrorBody } from '@/api/types';
import { control } from '@/mocks/control';
import { db, findCase, findUser } from '@/mocks/db';
import type { DbCase, DbUser } from '@/mocks/db/schema';

/** 일정 시간 미사용 시 토큰 만료. 실제 값은 협의 전(임시 60분). */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

/** 핸들러 안에서 던지면 { detail, code } 에러 응답이 된다 */
export class MockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

const errorJson = (status: number, code: string, detail: string) =>
  HttpResponse.json<ErrorBody>({ detail, code }, { status });

const FORCED: Record<number, { code: string; detail: string }> = {
  401: { code: 'UNAUTHORIZED', detail: '(개발 패널) 강제 401: 로그인이 필요해요.' },
  403: { code: 'FORBIDDEN', detail: '(개발 패널) 강제 403: 권한이 없어요.' },
  409: { code: 'CONFLICT', detail: '(개발 패널) 강제 409: 다른 요청과 충돌했어요.' },
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
      return errorJson(forced, f.code, f.detail);
    }

    try {
      return await resolver(info);
    } catch (e) {
      if (e instanceof MockError) return errorJson(e.status, e.code, e.detail);
      console.error('[mock] 핸들러 오류', e);
      return errorJson(500, 'INTERNAL_ERROR', '가짜 서버 내부 오류');
    }
  };
}

/** 422: FastAPI 기본 형식 */
export function validationError(field: string, msg = 'Field required') {
  return HttpResponse.json(
    { detail: [{ loc: ['body', field], msg, type: 'missing' }] },
    { status: 422 },
  );
}

// ---------- 권한 검사 (가짜 서버도 화면과 별개로 검사한다) ----------

/** Bearer 토큰 → 로그인한 사용자. 없거나 만료면 401 */
export function requireUser(request: Request): DbUser {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const state = db.state;
  const session = token ? state.sessions.find((s) => s.token === token) : undefined;

  if (!session) throw new MockError(401, 'UNAUTHORIZED', '로그인이 필요해요.');

  if (Date.now() - session.last_used_at > SESSION_IDLE_MS) {
    state.sessions = state.sessions.filter((s) => s !== session);
    db.save();
    throw new MockError(401, 'UNAUTHORIZED', '오래 사용하지 않아 로그아웃됐어요.');
  }

  const user = findUser(session.user_id);
  if (!user || !user.active) {
    state.sessions = state.sessions.filter((s) => s !== session);
    db.save();
    throw new MockError(401, 'UNAUTHORIZED', '로그인이 필요해요.');
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
  if (!c) throw new MockError(404, 'NOT_FOUND', '사건을 찾을 수 없어요.');
  if (user.role !== 'ADMIN' && !c.member_ids.includes(user.id)) {
    throw new MockError(403, 'FORBIDDEN', '맡은 사건만 볼 수 있어요.');
  }
  return c;
}

/** 종료된 사건에 변경 요청 */
export function requireOpenCase(c: DbCase) {
  if (c.status === 'CLOSED') throw new MockError(400, 'CASE_CLOSED', '종료된 사건이에요.');
}

/** JSON 본문 읽기(없거나 깨졌으면 빈 객체) */
export async function readJson<T extends object>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}
