// 관리자: 시스템 설정 · 계정 · 이용 기록 · 데이터 보관 (영상은 handlers/videos.ts)
import { http, HttpResponse } from 'msw';
import type { S, ServerSystemSettings, ServerSystemSettingsPatch } from '@/api/server';
import type { Role } from '@/mocks/db/legacyTypes';
import { addAudit, db, findUser, pubId, toServerUser } from '@/mocks/db';
import type { DbAuditLog, DbUser } from '@/mocks/db/schema';
import { nowKst } from '@/mocks/db/time';
import {
  cursorPage,
  MockError,
  readJson,
  requireAdmin,
  requireUser,
  requireVersion,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

const requireAdminUser = (request: Request) => {
  const user = requireUser(request);
  requireAdmin(user);
  return user;
};

/** 임시 비밀번호(영문+숫자 12자, 비밀번호 규칙 10자 이상) */
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${s}${Math.floor(Math.random() * 90 + 10)}`;
}

/** 이 사용자의 모든 세션 폐기(비활성화·비밀번호 초기화) */
function revokeSessions(userId: string) {
  db.state.sessions = db.state.sessions.filter((s) => s.user_id !== userId);
}

const activeAdmins = () => db.state.users.filter((u) => u.role === 'ADMIN' && u.active);

function findTargetUser(id: string) {
  const u = findUser(id);
  if (!u) throw new MockError(404, 'RESOURCE_NOT_FOUND', '계정을 찾을 수 없어요.');
  return u;
}

/** 이용 기록 → 백엔드 AuditEntry. 서버 기록에는 설명 문장이 없고 대상(자원)만 있다 */
const AUDIT_RESOURCE: Record<string, string> = {
  LOGIN: 'session',
  SEARCH: 'case',
  DECISION: 'decision',
  REVERT: 'decision',
  VIDEO_VIEW: 'video',
  VIDEO_UPLOAD: 'video',
  CASE_CREATE: 'case',
  CASE_CLOSE: 'case',
  ACCOUNT_CHANGE: 'user',
  SETTINGS_CHANGE: 'settings',
  DATA_DELETE: 'retention',
};
function toServerAudit(l: DbAuditLog): S['AuditEntry'] {
  const u = findUser(l.user_id);
  return {
    log_id: pubId(l.id),
    occurred_at: new Date(l.at).toISOString(),
    actor_user_id: u ? Number(u.id) : null,
    actor_name: u?.name ?? null,
    case_id: l.case_id ? Number(l.case_id) : null,
    action: l.action.toLowerCase(),
    resource_type: AUDIT_RESOURCE[l.action] ?? 'other',
    resource_id: l.case_id,
    request_id: `req-${l.id}`,
    result: 'success',
    changed_fields: [],
  };
}

const ROLE_LABEL: Record<Role, string> = { ADMIN: '관리자', USER: '사용자' };

export const adminHandlers = [
  // ---------- 녹화 영상 ----------

  // ---------- 시스템 설정 ----------

  // 시스템 설정 수정 · 관리자 · SYS01-006 (보낸 값만 바꾼다)
  http.patch(
    '/api/settings',
    withMock(async ({ request }) => {
      const user = requireAdminUser(request);
      const b = await readJson<ServerSystemSettingsPatch>(request);
      const s = db.state.settings;
      requireVersion(s.version, b.expected_version);

      const ratio = (field: string, v: unknown) => {
        if (v !== undefined && (typeof v !== 'number' || v < 0 || v > 1))
          throw new MockError(422, 'INVALID_SETTINGS', `${field}는 0~1이어야 해요.`, [
            { field, code: 'range', message: '0~1' },
          ]);
      };
      ratio('default_similarity_threshold', b.default_similarity_threshold);
      ratio('alert_high_threshold', b.alert_high_threshold);
      // R5: null이면 예외 기준 해제
      if (b.out_of_filter_threshold !== null)
        ratio('out_of_filter_threshold', b.out_of_filter_threshold);
      const mid = b.default_similarity_threshold ?? s.default_similarity_threshold;
      const high = b.alert_high_threshold ?? s.alert_high_threshold;
      if (mid !== null && high !== null && mid >= high)
        throw new MockError(
          422,
          'INVALID_SETTINGS',
          '유사도 기준 기본값은 알림 높음 기준보다 작아야 해요.',
        );
      if (b.area_level_ratios !== undefined) {
        const [r1, r2, r3] = b.area_level_ratios;
        if (!(r1 > 0 && r1 < r2 && r2 < 1 && r3 === 1))
          throw new MockError(422, 'INVALID_SETTINGS', '범위 비율은 높음 < 중간 < 1이어야 해요.');
      }
      if (b.walking_speed_presets !== undefined) {
        for (const p of b.walking_speed_presets) {
          if (!(p.speed_mps > 0 && p.speed_mps <= p.max_speed_mps))
            throw new MockError(
              422,
              'INVALID_SETTINGS',
              '평소 속도는 0보다 크고 최대 속도 이하여야 해요.',
            );
        }
      }

      const before = s.default_similarity_threshold;
      const { expected_version: _v, ...patch } = b;
      void _v;
      Object.assign(s, patch, { version: s.version + 1, updated_at: nowKst() });
      addAudit(
        user.id,
        'SETTINGS_CHANGE',
        before !== s.default_similarity_threshold
          ? `유사도 기준 기본값 ${before?.toFixed(2) ?? '없음'} → ${s.default_similarity_threshold?.toFixed(2) ?? '없음'}`
          : '시스템 설정 변경',
      );
      db.save();
      return HttpResponse.json<ServerSystemSettings>(s);
    }),
  ),

  // ---------- 계정 ----------

  // 계정 목록 · 관리자 · SYS01-007 (cursor)
  http.get(
    '/api/users',
    withMock(({ request }) => {
      requireAdminUser(request);
      const url = new URL(request.url);
      const role = url.searchParams.get('role');
      const active = url.searchParams.get('active');
      const q = (url.searchParams.get('query') ?? '').trim();
      const list = db.state.users
        .filter((u) => !role || (u.role === 'ADMIN' ? 'admin' : 'user') === role)
        .filter((u) => active === null || String(u.active) === active)
        .filter((u) => !q || u.name.includes(q) || u.username.includes(q))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(toServerUser);
      return HttpResponse.json<S['UserPage']>(cursorPage(list, request));
    }),
  ),

  // 계정 생성·임시 비밀번호 발급 · 관리자 · SYS01-007 (임시 비밀번호는 이 응답에서 한 번만)
  http.post(
    '/api/users',
    withMock(async ({ request }) => {
      const admin = requireAdminUser(request);
      const b = await readJson<S['UserCreateRequest']>(request);
      const username = b.username?.trim() ?? '';
      if (!/^[a-z0-9_]{3,20}$/.test(username))
        return validationError('username', '영문 소문자·숫자·밑줄 3~20자');
      if (!b.display_name?.trim()) return validationError('display_name');
      if (b.role !== 'admin' && b.role !== 'user') return validationError('role');
      if (db.state.users.some((u) => u.username === username))
        throw new MockError(409, 'USERNAME_ALREADY_EXISTS', `${username}은 이미 쓰는 아이디예요.`);
      const temp = tempPassword();
      const user: DbUser = {
        id: String(Math.max(0, ...db.state.users.map((x) => Number(x.id) || 0)) + 1),
        username,
        password: temp,
        name: b.display_name.trim(),
        role: b.role === 'admin' ? 'ADMIN' : 'USER',
        active: true,
        must_change_password: true,
        created_at: nowKst(),
        version: 1,
      };
      db.state.users.push(user);
      addAudit(
        admin.id,
        'ACCOUNT_CHANGE',
        `계정 생성 ${username} (${user.name}, ${ROLE_LABEL[user.role]})`,
      );
      db.save();
      return HttpResponse.json<S['TemporaryPasswordResponse']>(
        { user: toServerUser(user), temporary_password: temp, must_change_password: true },
        { status: 201, headers: { 'Cache-Control': 'no-store' } },
      );
    }),
  ),

  // 계정 역할 변경 · 관리자 · SYS01-007 (마지막 관리자 강등 금지, 대상 세션 폐기)
  http.patch(
    '/api/users/:userId/role',
    withMock(async ({ request, params }) => {
      const admin = requireAdminUser(request);
      const u = findTargetUser(String(params.userId));
      const b = await readJson<S['UserRolePatch']>(request);
      if (b.role !== 'admin' && b.role !== 'user') return validationError('role');
      requireVersion(u.version ?? 1, b.expected_version);
      if (!u.active) throw new MockError(409, 'USER_INACTIVE', '비활성 계정이에요.');
      const next = b.role === 'admin' ? 'ADMIN' : 'USER';
      if (u.role === 'ADMIN' && next !== 'ADMIN' && activeAdmins().length <= 1)
        throw new MockError(409, 'LAST_ADMIN_PROTECTED', '마지막 관리자는 역할을 바꿀 수 없어요.');
      if (next !== u.role) {
        addAudit(
          admin.id,
          'ACCOUNT_CHANGE',
          `역할 변경 ${u.username}: ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[next]}`,
        );
        u.role = next;
        u.version = (u.version ?? 1) + 1;
        revokeSessions(u.id);
      }
      db.save();
      return HttpResponse.json<S['User']>(toServerUser(u));
    }),
  ),

  // 계정 비활성화 · 관리자 · SYS01-007 (되돌리는 API 없음, 열린 사건의 주 담당자는 금지)
  http.post(
    '/api/users/:userId/deactivate',
    withMock(async ({ request, params }) => {
      const admin = requireAdminUser(request);
      const u = findTargetUser(String(params.userId));
      const b = await readJson<S['UserDeactivateRequest']>(request);
      if (!b.reason?.trim()) return validationError('reason', '사유를 적어 주세요.');
      requireVersion(u.version ?? 1, b.expected_version);
      if (u.active) {
        if (u.role === 'ADMIN' && activeAdmins().length <= 1)
          throw new MockError(409, 'LAST_ADMIN_PROTECTED', '마지막 관리자는 비활성화할 수 없어요.');
        const owning = db.state.cases.filter((c) => c.status === 'OPEN' && c.created_by === u.id);
        if (owning.length)
          throw new MockError(
            409,
            'ACTIVE_CASE_OWNER',
            `진행 중인 사건의 주 담당자예요(사건 #${owning.map((c) => c.id).join(', #')}). 사건을 먼저 종료하세요.`,
          );
        u.active = false;
        u.version = (u.version ?? 1) + 1;
        revokeSessions(u.id);
        addAudit(admin.id, 'ACCOUNT_CHANGE', `비활성화 ${u.username}: ${b.reason.trim()}`);
        db.save();
      }
      return HttpResponse.json<S['User']>(toServerUser(u));
    }),
  ),

  // 비밀번호 초기화 · 관리자 · SYS01-007 (임시 비밀번호 재발급, 모든 세션 폐기)
  http.post(
    '/api/users/:userId/password-reset',
    withMock(async ({ request, params }) => {
      const admin = requireAdminUser(request);
      const u = findTargetUser(String(params.userId));
      const b = await readJson<S['PasswordResetRequest']>(request);
      if (!b.reason?.trim()) return validationError('reason', '사유를 적어 주세요.');
      requireVersion(u.version ?? 1, b.expected_version);
      if (!u.active) throw new MockError(409, 'USER_INACTIVE', '비활성 계정이에요.');
      const temp = tempPassword();
      u.password = temp;
      u.must_change_password = true;
      u.version = (u.version ?? 1) + 1;
      revokeSessions(u.id);
      addAudit(admin.id, 'ACCOUNT_CHANGE', `비밀번호 초기화 ${u.username}: ${b.reason.trim()}`);
      db.save();
      return HttpResponse.json<S['TemporaryPasswordResponse']>(
        { user: toServerUser(u), temporary_password: temp, must_change_password: true },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }),
  ),

  // ---------- 이용 기록 ----------

  // 이용 기록 조회 · 관리자 · SYS01-008 (최신순, cursor)
  http.get(
    '/api/audit-logs',
    withMock(({ request }) => {
      requireAdminUser(request);
      const url = new URL(request.url);
      const p = (k: string) => url.searchParams.get(k);
      const fromMs = p('from') ? new Date(p('from')!).getTime() : null;
      const toMs = p('to') ? new Date(p('to')!).getTime() : null;
      const list = db.state.audit_logs
        .filter((l) => fromMs === null || new Date(l.at).getTime() >= fromMs)
        .filter((l) => toMs === null || new Date(l.at).getTime() <= toMs)
        .filter((l) => !p('user_id') || l.user_id === p('user_id'))
        .filter((l) => !p('case_id') || l.case_id === p('case_id'))
        .filter((l) => !p('action') || l.action.toLowerCase() === p('action'))
        // 가짜 서버 기록은 모두 성공
        .filter(() => !p('result') || p('result') === 'success')
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(toServerAudit);
      return HttpResponse.json<S['AuditPage']>(cursorPage(list, request));
    }),
  ),

  // ---------- 데이터 보관 ----------

  // 데이터 보관 기간 · 관리자 · SYS01-009
  http.get(
    '/api/retention-policy',
    withMock(({ request }) => {
      requireAdminUser(request);
      return HttpResponse.json<S['RetentionPolicy']>(db.state.retention);
    }),
  ),

  // 보관 기간 수정 · 관리자 · SYS01-009 (이 요청으로 삭제하지 않는다)
  http.patch(
    '/api/retention-policy',
    withMock(async ({ request }) => {
      const admin = requireAdminUser(request);
      const b = await readJson<S['RetentionPatch']>(request);
      const r = db.state.retention;
      requireVersion(r.version, b.expected_version);
      const keys = [
        'video_retention_days',
        'closed_case_retention_days',
        'alert_retention_days',
        'audit_retention_days',
      ] as const;
      for (const k of keys) {
        const v = b[k];
        if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 1 || v > 3650))
          return validationError(k, '1~3650일');
      }
      for (const k of keys) if (b[k] !== undefined) r[k] = b[k] ?? null;
      r.version += 1;
      r.updated_at = new Date().toISOString();
      addAudit(
        admin.id,
        'SETTINGS_CHANGE',
        `보관 기간 변경${b.apply_to_existing ? ' (기존 데이터 포함)' : ''}`,
      );
      db.save();
      return HttpResponse.json<S['RetentionPolicy']>(r);
    }),
  ),

  // 삭제 예정·보호 대상 · 관리자 · SYS01-009 (조회만, 자동 삭제 없음 D02)
  http.get(
    '/api/deletion-candidates',
    withMock(({ request }) => {
      requireAdminUser(request);
      const url = new URL(request.url);
      const type = url.searchParams.get('resource_type');
      const r = db.state.retention;
      const DAY = 24 * 60 * 60_000;
      const at = (base: string, days: number | null) =>
        days === null ? null : new Date(new Date(base).getTime() + days * DAY).toISOString();
      const list: S['DeletionCandidate'][] = [];
      for (const c of db.state.cases.filter((x) => x.status === 'CLOSED' && x.closed_at)) {
        const until = at(c.closed_at!, r.closed_case_retention_days);
        if (until)
          list.push({
            resource_type: 'closed_case',
            resource_id: c.id,
            retain_until: until,
            eligible: new Date(until).getTime() <= Date.now(),
            approval_required: true,
            blocked_reasons: [],
            referenced_case_ids: [Number(c.id)],
            estimated_bytes: 50_000_000,
          });
      }
      for (const v of db.state.videos.filter((x) => x.status === 'DONE' && !x.case_id)) {
        const until = at(v.recorded_at, r.video_retention_days);
        // 확정 동선에 쓰인 영상은 보호
        const used = db.state.scenes.some(
          (s) =>
            s.video_id === v.id &&
            db.state.candidates.some((c) => c.scene_id === s.id && c.status === 'CONFIRMED'),
        );
        if (until)
          list.push({
            resource_type: 'video',
            resource_id: pubId(v.id),
            retain_until: until,
            eligible: !used && new Date(until).getTime() <= Date.now(),
            approval_required: true,
            blocked_reasons: used ? ['확정 동선에 쓰인 영상'] : [],
            referenced_case_ids: [],
            estimated_bytes: 1_200_000_000,
          });
      }
      const filtered = list
        .filter((x) => !type || x.resource_type === type)
        .sort((a, b) => a.retain_until.localeCompare(b.retain_until));
      return HttpResponse.json<S['DeletionCandidatePage']>(cursorPage(filtered, request));
    }),
  ),
];
