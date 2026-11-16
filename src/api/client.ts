import { API_BASE_URL } from '@/api/config';
import { queryClient } from '@/api/queryClient';
import { useAuthStore } from '@/stores/auth';
import { useCaseNavStore } from '@/stores/case';

/** 서버 에러. 화면 처리는 code 기준(docs/api-spec.md "공통 규칙"). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  query?: object;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

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

async function parseError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let detail = '요청을 처리하지 못했어요.';
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'detail' in body) {
      const b = body as { detail: unknown; code?: unknown };
      if (typeof b.detail === 'string') detail = b.detail;
      // 422는 FastAPI 기본 형식(detail이 배열)
      else if (res.status === 422) detail = '입력값을 확인해 주세요.';
      if (typeof b.code === 'string') code = b.code;
      else if (res.status === 422) code = 'VALIDATION_ERROR';
    }
  } catch {
    // 본문이 JSON이 아님
  }
  return new ApiError(res.status, code, detail);
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = useAuthStore.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;

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
      signal: options.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결하지 못했어요.');
  }

  if (!res.ok) {
    const error = await parseError(res);
    // 401: 토큰 만료·로그인 안 함 → 세션을 지우면 라우트 가드가 로그인 화면으로 보낸다.
    // 로그인 요청 자체의 401(INVALID_CREDENTIALS)은 제외.
    if (res.status === 401 && token && path !== '/auth/login') {
      useAuthStore.getState().clearSession('expired');
      useCaseNavStore.getState().setLastCaseId(null);
      queryClient.clear();
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
