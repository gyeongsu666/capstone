// 가짜 DB: 메모리 + localStorage. 새로고침해도 유지된다.
import type { ServerUser } from '@/api/server';
import { createScenario } from '@/mocks/scenario';
import { DB_VERSION, type DbSession, type DbState, type DbUser } from '@/mocks/db/schema';
import { nowKst } from '@/mocks/db/time';

const STORAGE_KEY = 'refind-mock-db';

function load(): DbState {
  const fresh = createScenario();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DbState;
      // 버전이 같아도 표가 빠져 있으면(개발 중 새로고침으로 덜 만든 데이터) 새로 만든다
      const complete = Object.keys(fresh).every((k) => k in parsed);
      if (parsed.version === DB_VERSION && complete) return parsed;
    }
  } catch {
    // 깨진 데이터면 새로 만든다
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

let state: DbState = load();

export const db = {
  get state() {
    return state;
  },
  /** 변경한 뒤 호출해 localStorage에 저장 */
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  },
  /** 시각 R을 지금으로 다시 잡고 처음 상태로 */
  reset() {
    state = createScenario(Date.now());
    db.save();
  },
};

// ---------- 공통 조회·변환 ----------

let seq = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const findUser = (id: string) => state.users.find((u) => u.id === id);
export const findUserByUsername = (username: string) =>
  state.users.find((u) => u.username === username);
export const findCase = (id: string) => state.cases.find((c) => c.id === id);

/** 내부 문자열 id → 서버 모양의 10진수 문자열 id(bigserial). 처음 부를 때 정해진다 */
export function pubId(internal: string): string {
  const ids = state.public_ids;
  if (!ids.map[internal]) {
    ids.map[internal] = String(ids.next++);
    db.save();
  }
  return ids.map[internal];
}

/** 서버 모양 id → 내부 id(없으면 undefined) */
export function fromPubId(pub: string): string | undefined {
  return Object.keys(state.public_ids.map).find((k) => state.public_ids.map[k] === pub);
}

/** 이용 기록 추가(서버가 자동으로 남기는 것과 같은 역할) */
export function addAudit(
  userId: string,
  action: DbState['audit_logs'][number]['action'],
  detail: string,
  caseId: string | null = null,
) {
  state.audit_logs.unshift({
    id: newId('log'),
    at: nowKst(),
    user_id: userId,
    action,
    case_id: caseId,
    detail,
  });
}

/** 세션 발급. 개발 패널의 계정 빠른 전환도 이 함수를 쓴다. */
export function createSession(userId: string): DbSession {
  const session: DbSession = {
    id: newId('sess'),
    csrf_token: newId('csrf'),
    user_id: userId,
    last_used_at: Date.now(),
  };
  state.sessions.push(session);
  return session;
}

/** 백엔드 openapi.json 모양의 User */
export function toServerUser(u: DbUser): ServerUser {
  return {
    user_id: Number(u.id),
    username: u.username,
    display_name: u.name,
    role: u.role === 'ADMIN' ? 'admin' : 'user',
    active: u.active,
    must_change_password: u.must_change_password,
    created_at: u.created_at,
    updated_at: u.created_at,
    version: u.version ?? 1,
  };
}
