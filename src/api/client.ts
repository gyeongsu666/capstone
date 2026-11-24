import { API_BASE_URL } from '@/api/config';
import { queryClient } from '@/api/queryClient';
import type { ErrorBody, ErrorResponse } from '@/api/server';
import { useAuthStore } from '@/stores/auth';
import { useCaseNavStore } from '@/stores/case';

type FieldError = ErrorBody['fields'][number];
type ErrorContext = ErrorBody['context'];

/**
 * 서버 에러. 서버 응답 `{ request_id, error: { code, message, fields, context, retryable } }`을 옮긴 것.
 * 화면 처리는 code 기준.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldError[];
  readonly context: ErrorContext;
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: {
      fields?: FieldError[];
      context?: ErrorContext;
      retryable?: boolean;
      requestId?: string | null;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? [];
    this.context = extra.context ?? {};
    this.retryable = extra.retryable ?? false;
    this.requestId = extra.requestId ?? null;
  }

  /** 화면에 그대로 보여 줄 문장(= message) */
  get detail() {
    return this.message;
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  query?: object;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  /**
   * 같은 요청을 다시 보낼 때 쓰는 Idempotency-Key. 생략하면 POST마다 새로 만든다.
   * (서버는 생성·업로드·검색·판단·번복·재처리 POST에 이 헤더를 요구한다.)
   */
  idempotencyKey?: string;
}

/** 세션이 끝났다는 뜻의 401 코드. 그 밖의 401(예: 현재 비밀번호 틀림)은 세션을 지우지 않는다. */
const SESSION_LOST_CODES = new Set(['UNAUTHENTICATED', 'SESSION_EXPIRED']);

function buildUrl(path: string, query?: object) {
  const url = new URL(API_BASE_URL + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

const isErrorResponse = (body: unknown): body is ErrorResponse =>
  !!body &&
  typeof body === 'object' &&
  'error' in body &&
  !!(body as { error: unknown }).error &&
  typeof (body as { error: { code?: unknown } }).error.code === 'string';

async function parseError(res: Response): Promise<ApiError> {
  const fallback = new ApiError(res.status, `HTTP_${res.status}`, '요청을 처리하지 못했어요.', {
    requestId: res.headers.get('X-Request-ID'),
    retryable: res.status >= 500,
  });
  try {
    const body: unknown = await res.json();
    if (isErrorResponse(body)) {
      const e = body.error;
      return new ApiError(res.status, e.code, e.message || fallback.message, {
        fields: e.fields,
        context: e.context,
        retryable: e.retryable,
        requestId: body.request_id,
      });
    }
  } catch {
    // 본문이 JSON이 아님
  }
  return fallback;
}

/** 세션이 끊겼을 때: 화면 세션을 지우면 라우트 가드가 로그인 화면으로 보낸다. */
function onSessionLost(code: string) {
  const auth = useAuthStore.getState();
  if (auth.status !== 'authenticated') return;
  auth.clearSession(code === 'SESSION_EXPIRED' ? 'expired' : 'manual');
  useCaseNavStore.getState().setLastCaseId(null);
  queryClient.clear();
}

export async function request<T>(
  method: Method,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrf = useAuthStore.getState().csrfToken;
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  if (method === 'POST') {
    headers['Idempotency-Key'] = options.idempotencyKey ?? crypto.randomUUID();
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      // 세션 쿠키(refind_session)는 같은 출처 요청에 브라우저가 붙인다.
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결하지 못했어요.', { retryable: true });
  }

  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401 && SESSION_LOST_CODES.has(error.code)) onSessionLost(error.code);
    // 첫 로그인 비밀번호 변경 전: 라우트 가드가 비밀번호 변경 화면으로 보낸다.
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') {
      const user = useAuthStore.getState().user;
      if (user && !user.mustChangePassword) {
        useAuthStore.getState().setUser({ ...user, mustChangePassword: true });
      }
    }
    throw error;
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // 예: 가짜 서버 핸들러가 없어 개발 서버가 index.html을 돌려준 경우
    throw new ApiError(res.status, 'INVALID_RESPONSE', '서버 응답을 읽지 못했어요.');
  }
}
