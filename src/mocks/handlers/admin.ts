// 관리자: 녹화 영상 · 시스템 설정 · 계정 · 이용 기록 · 데이터 보관
import { http, HttpResponse } from 'msw';
import type { ServerSystemSettings, ServerSystemSettingsPatch } from '@/api/server';
import type {
  AuditLog,
  Page,
  PendingDeletion,
  ResetPasswordResponse,
  Retention,
  Role,
  User,
  UserCreateRequest,
  UserCreateResponse,
  UserUpdateRequest,
  Video,
  VideoAccepted,
  VideoPage,
} from '@/api/types';
import { addAudit, db, findCase, findUser, newId, toUser, toUserBrief } from '@/mocks/db';
import type { DbUser } from '@/mocks/db/schema';
import { createTask, settleTasks } from '@/mocks/db/tasks';
import { nowKst, toKst } from '@/mocks/db/time';
import { paginate } from '@/mocks/handlers/cases';
import {
  MockError,
  readJson,
  requireAdmin,
  requireUser,
  requireVersion,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

const ROLES: Role[] = ['ADMIN', 'USER'];
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

const requireAdminUser = (request: Request) => {
  const user = requireUser(request);
  requireAdmin(user);
  return user;
};

/** 임시 비밀번호(영문+숫자 10자) */
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${s}${Math.floor(Math.random() * 90 + 10)}`;
}

/** 이 사용자의 모든 세션 폐기(비활성화·비밀번호 초기화) */
function revokeSessions(userId: string) {
  db.state.sessions = db.state.sessions.filter((s) => s.user_id !== userId);
}

const activeAdmins = () => db.state.users.filter((u) => u.role === 'ADMIN' && u.active);

function videoSort(a: Video, b: Video) {
  // 실패가 먼저, 그다음 최신순
  const failed = Number(b.status === 'FAILED') - Number(a.status === 'FAILED');
  return failed !== 0 ? failed : b.uploaded_at.localeCompare(a.uploaded_at);
}

const ROLE_LABEL: Record<Role, string> = { ADMIN: '관리자', USER: '사용자' };

export const adminHandlers = [
  // ---------- 녹화 영상 ----------

  // 녹화 영상 목록·분석 현황 · 관리자 · SYS01-004, 005
  http.get(
    '/api/videos',
    withMock(({ request }) => {
      requireAdminUser(request);
      settleTasks();
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const cameraId = url.searchParams.get('camera_id');
      const all = db.state.videos;
      const list = all
        .filter((v) => !status || v.status === status)
        .filter((v) => !cameraId || v.camera_id === cameraId)
        .sort(videoSort);
      return HttpResponse.json<VideoPage>({
        ...paginate(list, url),
        summary: {
          waiting: all.filter((v) => v.status === 'WAITING').length,
          processing: all.filter((v) => v.status === 'PROCESSING').length,
          done: all.filter((v) => v.status === 'DONE').length,
          failed: all.filter((v) => v.status === 'FAILED').length,
        },
      });
    }),
  ),

  // 고정 CCTV 영상 업로드 · 관리자 · SYS01-004, 005
  http.post(
    '/api/videos',
    withMock(async ({ request }) => {
      const user = requireAdminUser(request);
      const form = await request.formData();
      const cameraId = String(form.get('camera_id') ?? '');
      const file = form.get('file');
      const recordedAt = String(form.get('recorded_at') ?? '');
      if (!cameraId) return validationError('camera_id');
      if (!(file instanceof File)) return validationError('file');
      if (!recordedAt) return validationError('recorded_at');
      const camera = db.state.cameras.find((c) => c.id === cameraId && c.source === 'FIXED');
      if (!camera) throw new MockError(404, 'CAMERA_NOT_FOUND', '카메라를 찾을 수 없어요.');
      if (file.size > MAX_VIDEO_BYTES)
        throw new MockError(413, 'FILE_TOO_LARGE', '영상은 2GB까지 올릴 수 있어요.');
      if (file.type && !file.type.startsWith('video/'))
        throw new MockError(415, 'UNSUPPORTED_FILE', '영상 파일만 올릴 수 있어요.');
      const video: Video = {
        id: newId('video'),
        camera_id: camera.id,
        camera_code: camera.code,
        file_name: file.name,
        recorded_at: recordedAt,
        duration_sec: null,
        status: 'WAITING',
        progress: 0,
        error_message: null,
        task_id: null,
        case_id: null,
        uploaded_at: nowKst(),
      };
      // 파일 이름에 "fail"이 있으면 분석 실패(실패 화면 확인용)
      const fail = /fail/i.test(file.name);
      const task = createTask(
        'VIDEO_ANALYSIS',
        { kind: 'video_done', video_id: video.id, camera_id: camera.id },
        {
          stepMs: 1500,
          failAt: fail ? 80 : undefined,
          error: fail ? '프레임 디코딩 실패' : undefined,
        },
      );
      video.task_id = task.task_id;
      db.state.videos.push(video);
      addAudit(user.id, 'VIDEO_UPLOAD', `녹화 영상 등록 ${file.name}`);
      db.save();
      return HttpResponse.json<VideoAccepted>({ video, task_id: task.task_id }, { status: 202 });
    }),
  ),

  // 실패한 분석 재처리 · 관리자 · SYS01-005
  http.post(
    '/api/videos/:videoId/retry',
    withMock(({ request, params }) => {
      const user = requireAdminUser(request);
      const v = db.state.videos.find((x) => x.id === params.videoId);
      if (!v) throw new MockError(404, 'NOT_FOUND', '영상을 찾을 수 없어요.');
      if (v.status !== 'FAILED')
        throw new MockError(409, 'NOT_FAILED', '실패한 영상만 재처리할 수 있어요.');
      const task = createTask(
        'VIDEO_ANALYSIS',
        { kind: 'video_done', video_id: v.id, camera_id: v.camera_id },
        { stepMs: 1500 },
      );
      v.status = 'PROCESSING';
      v.progress = 0;
      v.error_message = null;
      v.task_id = task.task_id;
      addAudit(user.id, 'VIDEO_UPLOAD', `분석 재처리 ${v.file_name}`);
      db.save();
      return HttpResponse.json({ task_id: task.task_id }, { status: 202 });
    }),
  ),

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

  // 계정 목록 · 관리자 · SYS01-007
  http.get(
    '/api/users',
    withMock(({ request }) => {
      requireAdminUser(request);
      const url = new URL(request.url);
      const role = url.searchParams.get('role');
      const active = url.searchParams.get('active');
      const q = (url.searchParams.get('q') ?? '').trim();
      const list = db.state.users
        .filter((u) => !role || u.role === role)
        .filter((u) => active === null || String(u.active) === active)
        .filter((u) => !q || u.name.includes(q) || u.username.includes(q))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(toUser);
      return HttpResponse.json<Page<User>>(paginate(list, url));
    }),
  ),

  // 계정 생성 · 관리자 · SYS01-007
  http.post(
    '/api/users',
    withMock(async ({ request }) => {
      const admin = requireAdminUser(request);
      const b = await readJson<UserCreateRequest>(request);
      const username = b.username?.trim() ?? '';
      if (!/^[a-z0-9_]{3,20}$/.test(username))
        return validationError('username', '영문 소문자·숫자·밑줄 3~20자');
      if (!b.name?.trim()) return validationError('name');
      if (!b.role || !ROLES.includes(b.role)) return validationError('role');
      if (db.state.users.some((u) => u.username === username))
        throw new MockError(409, 'USERNAME_TAKEN', `${username}은 이미 쓰는 아이디예요.`);
      const temp = tempPassword();
      const user: DbUser = {
        id: String(Math.max(0, ...db.state.users.map((x) => Number(x.id) || 0)) + 1),
        username,
        password: temp,
        name: b.name.trim(),
        role: b.role,
        active: true,
        must_change_password: true,
        created_at: nowKst(),
      };
      db.state.users.push(user);
      addAudit(
        admin.id,
        'ACCOUNT_CHANGE',
        `계정 생성 ${username} (${user.name}, ${ROLE_LABEL[user.role]})`,
      );
      db.save();
      return HttpResponse.json<UserCreateResponse>(
        { user: toUser(user), temp_password: temp },
        { status: 201 },
      );
    }),
  ),

  // 역할 변경·비활성화 · 관리자 · SYS01-007
  http.patch(
    '/api/users/:userId',
    withMock(async ({ request, params }) => {
      const admin = requireAdminUser(request);
      const u = findUser(String(params.userId));
      if (!u) throw new MockError(404, 'NOT_FOUND', '계정을 찾을 수 없어요.');
      const b = await readJson<UserUpdateRequest>(request);
      const losesAdmin =
        u.role === 'ADMIN' && u.active && ((b.role && b.role !== 'ADMIN') || b.active === false);
      if (losesAdmin && activeAdmins().length <= 1)
        throw new MockError(
          400,
          'LAST_ADMIN',
          '마지막 관리자는 역할을 바꾸거나 비활성화할 수 없어요.',
        );
      const changes: string[] = [];
      if (b.name !== undefined && b.name.trim() && b.name.trim() !== u.name) {
        changes.push(`이름 ${u.name} → ${b.name.trim()}`);
        u.name = b.name.trim();
      }
      if (b.role && ROLES.includes(b.role) && b.role !== u.role) {
        changes.push(`역할 ${ROLE_LABEL[u.role]} → ${ROLE_LABEL[b.role]}`);
        u.role = b.role;
      }
      if (typeof b.active === 'boolean' && b.active !== u.active) {
        changes.push(b.active ? '다시 활성화' : '비활성화');
        u.active = b.active;
        if (!b.active) revokeSessions(u.id);
      }
      if (changes.length)
        addAudit(admin.id, 'ACCOUNT_CHANGE', `계정 변경 ${u.username}: ${changes.join(', ')}`);
      db.save();
      return HttpResponse.json<User>(toUser(u));
    }),
  ),

  // 비밀번호 초기화 · 관리자 · SYS01-007
  http.post(
    '/api/users/:userId/reset-password',
    withMock(({ request, params }) => {
      const admin = requireAdminUser(request);
      const u = findUser(String(params.userId));
      if (!u) throw new MockError(404, 'NOT_FOUND', '계정을 찾을 수 없어요.');
      const temp = tempPassword();
      u.password = temp;
      u.must_change_password = true;
      revokeSessions(u.id);
      addAudit(admin.id, 'ACCOUNT_CHANGE', `비밀번호 초기화 ${u.username}`);
      db.save();
      return HttpResponse.json<ResetPasswordResponse>({ temp_password: temp });
    }),
  ),

  // ---------- 이용 기록 ----------

  // 이용 기록 조회 · 관리자 · SYS01-008
  http.get(
    '/api/audit-logs',
    withMock(({ request }) => {
      requireAdminUser(request);
      const url = new URL(request.url);
      const p = (k: string) => url.searchParams.get(k);
      const list = db.state.audit_logs
        .filter((l) => !p('from') || l.at >= p('from')!)
        .filter((l) => !p('to') || l.at <= p('to')!)
        .filter((l) => !p('user_id') || l.user_id === p('user_id'))
        .filter((l) => !p('case_id') || l.case_id === p('case_id'))
        .filter((l) => !p('action') || l.action === p('action'))
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((l): AuditLog => ({
          id: l.id,
          at: l.at,
          user: toUserBrief(l.user_id),
          action: l.action,
          case_id: l.case_id,
          case_no: l.case_id ? (findCase(l.case_id)?.case_no ?? null) : null,
          detail: l.detail,
        }));
      return HttpResponse.json<Page<AuditLog>>(paginate(list, url));
    }),
  ),

  // ---------- 데이터 보관 ----------

  // 보관 기간 조회 · 관리자 · SYS01-009
  http.get(
    '/api/retention',
    withMock(({ request }) => {
      requireAdminUser(request);
      return HttpResponse.json<Retention>(db.state.retention);
    }),
  ),

  // 보관 기간 수정 · 관리자 · SYS01-009
  http.put(
    '/api/retention',
    withMock(async ({ request }) => {
      const admin = requireAdminUser(request);
      const b = await readJson<Retention>(request);
      for (const k of ['closed_case_days', 'raw_video_days'] as const) {
        const v = b[k];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 3650)
          return validationError(k, 'Input should be an integer between 1 and 3650');
      }
      db.state.retention = {
        closed_case_days: b.closed_case_days!,
        raw_video_days: b.raw_video_days!,
      };
      addAudit(
        admin.id,
        'SETTINGS_CHANGE',
        `보관 기간 변경 (종료 사건 ${b.closed_case_days}일, 원본 영상 ${b.raw_video_days}일)`,
      );
      db.save();
      return HttpResponse.json<Retention>(db.state.retention);
    }),
  ),

  // 삭제 예정 목록 · 관리자 · SYS01-009
  http.get(
    '/api/retention/pending-deletions',
    withMock(({ request }) => {
      requireAdminUser(request);
      const days = db.state.retention;
      const DAY = 24 * 60 * 60_000;
      const cases: PendingDeletion[] = db.state.cases
        .filter((c) => c.status === 'CLOSED' && c.closed_at)
        .map((c) => ({
          target_type: 'CASE',
          target_id: c.id,
          label: `사건 ${c.case_no} 썸네일·특징 벡터·확인 기록`,
          delete_at: toKst(new Date(c.closed_at!).getTime() + days.closed_case_days * DAY),
        }));
      const videos: PendingDeletion[] = db.state.videos
        .filter((v) => v.status === 'DONE' && !v.case_id)
        .map((v) => ({
          target_type: 'VIDEO',
          target_id: v.id,
          label: `녹화 영상 원본 ${v.file_name}`,
          delete_at: toKst(new Date(v.recorded_at).getTime() + days.raw_video_days * DAY),
        }));
      const list = [...cases, ...videos].sort((a, b) => a.delete_at.localeCompare(b.delete_at));
      return HttpResponse.json<Page<PendingDeletion>>(paginate(list, new URL(request.url)));
    }),
  ),
];
