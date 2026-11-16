import { http, HttpResponse } from 'msw';
import type {
  Camera,
  Case,
  CaseCloseRequest,
  CaseCreateRequest,
  CaseMembersRequest,
  CaseUpdateRequest,
  CaseVideo,
  CaseVideoAccepted,
  CloseReason,
  Page,
  UserBrief,
  Video,
  WalkSpeedPreset,
} from '@/api/types';
import { addAudit, db, findUser, newId, toUserBrief } from '@/mocks/db';
import { toCaseWithSummary as toCase } from '@/mocks/db/tracking';
import { stopWatchOnClose } from '@/mocks/handlers/search';
import { nowKst } from '@/mocks/db/time';
import { createTask, settleTasks } from '@/mocks/db/tasks';
import {
  MockError,
  readJson,
  requireCaseAccess,
  requireOpenCase,
  requireUser,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

const PRESETS: WalkSpeedPreset[] = ['ADULT', 'CHILD', 'ELDERLY'];
const CLOSE_REASONS: CloseReason[] = ['FOUND', 'SEARCH_STOPPED', 'OTHER'];
const CLOSE_LABEL: Record<CloseReason, string> = {
  FOUND: '발견',
  SEARCH_STOPPED: '수색 중단',
  OTHER: '기타',
};

/** ?page=1&size=20 → Page<T> */
export function paginate<T>(items: T[], url: URL): Page<T> {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? 20) || 20));
  return { items: items.slice((page - 1) * size, page * size), total: items.length, page, size };
}

/** 올해 사건 번호 다음 값. 예: "2026-033" */
function nextCaseNo() {
  const year = new Date().getFullYear();
  const max = db.state.cases
    .map((c) => c.case_no)
    .filter((no) => no.startsWith(`${year}-`))
    .reduce((m, no) => Math.max(m, Number(no.split('-')[1]) || 0), 0);
  return `${year}-${String(max + 1).padStart(3, '0')}`;
}

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

export const caseHandlers = [
  // 사건 목록 · 사용자(맡은 사건만, 관리자는 전체) · SYS02-001
  http.get(
    '/api/cases',
    withMock(({ request }) => {
      const user = requireUser(request);
      const url = new URL(request.url);
      const status = url.searchParams.get('status') ?? 'OPEN';
      const q = (url.searchParams.get('q') ?? '').trim();
      const list = db.state.cases
        .filter((c) => user.role === 'ADMIN' || c.member_ids.includes(user.id))
        .filter((c) => c.status === status)
        .filter((c) => !q || c.case_no.includes(q) || c.missing_person.name.includes(q))
        // 진행 중은 실종 시각 최신순, 종료는 종료 시각 최신순
        .sort((a, b) =>
          (status === 'CLOSED' ? (b.closed_at ?? '') : b.missing_at).localeCompare(
            status === 'CLOSED' ? (a.closed_at ?? '') : a.missing_at,
          ),
        )
        .map(toCase);
      return HttpResponse.json<Page<Case>>(paginate(list, url));
    }),
  ),

  // 사건 등록 · 사용자 · SYS02-001
  http.post(
    '/api/cases',
    withMock(async ({ request }) => {
      const user = requireUser(request);
      const body = await readJson<CaseCreateRequest>(request);
      const p = body.missing_person;
      if (!p?.name) return validationError('missing_person.name');
      if (typeof p.age !== 'number') return validationError('missing_person.age');
      if (!body.missing_at) return validationError('missing_at');
      if (!body.last_seen_place?.name || !body.last_seen_place.location)
        return validationError('last_seen_place');
      if (!body.walk_speed_preset || !PRESETS.includes(body.walk_speed_preset))
        return validationError('walk_speed_preset');

      const memberIds = Array.from(
        new Set([user.id, ...(body.member_ids ?? []).filter((id) => findUser(id)?.active)]),
      );
      const now = nowKst();
      const c = {
        id: newId('case'),
        case_no: nextCaseNo(),
        status: 'OPEN' as const,
        missing_person: { name: p.name, age: p.age, description: p.description ?? '' },
        missing_at: body.missing_at,
        last_seen_place: body.last_seen_place,
        walk_speed_preset: body.walk_speed_preset,
        created_by: user.id,
        member_ids: memberIds,
        created_at: now,
        closed_at: null,
        close_reason: null,
        summary: {
          confirmed_count: 0,
          pending_count: 0,
          last_seen_at: null,
          last_seen_camera_code: null,
        },
      };
      db.state.cases.push(c);
      addAudit(user.id, 'CASE_CREATE', `사건 등록 ${c.case_no}`, c.id);
      db.save();
      return HttpResponse.json<Case>(toCase(c), { status: 201 });
    }),
  ),

  // 사건 상세(사이드바 사건 카드) · 사용자(맡은 사건만) · SYS02-001
  http.get(
    '/api/cases/:caseId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      return HttpResponse.json<Case>(toCase(c));
    }),
  ),

  // 사건 정보 수정 · 사용자 · SYS02-001
  http.patch(
    '/api/cases/:caseId',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const body = await readJson<CaseUpdateRequest>(request);
      if (body.missing_person) c.missing_person = body.missing_person;
      if (body.missing_at) c.missing_at = body.missing_at;
      if (body.last_seen_place) c.last_seen_place = body.last_seen_place;
      if (body.walk_speed_preset && PRESETS.includes(body.walk_speed_preset))
        c.walk_speed_preset = body.walk_speed_preset;
      db.save();
      return HttpResponse.json<Case>(toCase(c));
    }),
  ),

  // 사건 종료(실시간 감시 자동 해제, 이후 읽기 전용) · 사용자 · SYS02-011
  http.post(
    '/api/cases/:caseId/close',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      if (c.status === 'CLOSED')
        throw new MockError(409, 'ALREADY_CLOSED', '이미 종료된 사건이에요.');
      const body = await readJson<CaseCloseRequest>(request);
      if (!body.reason || !CLOSE_REASONS.includes(body.reason)) return validationError('reason');
      c.status = 'CLOSED';
      c.closed_at = nowKst();
      c.close_reason = body.reason;
      stopWatchOnClose(c);
      addAudit(
        user.id,
        'CASE_CLOSE',
        `사건 종료 ${c.case_no} (${CLOSE_LABEL[body.reason]}${body.note ? `: ${body.note}` : ''})`,
        c.id,
      );
      db.save();
      return HttpResponse.json<Case>(toCase(c));
    }),
  ),

  // 공동 담당자 설정 · 사건 등록자 또는 관리자 · SYS02-012
  http.put(
    '/api/cases/:caseId/members',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      if (user.role !== 'ADMIN' && c.created_by !== user.id) {
        throw new MockError(403, 'FORBIDDEN', '사건 등록자나 관리자만 담당자를 바꿀 수 있어요.');
      }
      requireOpenCase(c);
      const body = await readJson<CaseMembersRequest>(request);
      if (!Array.isArray(body.member_ids)) return validationError('member_ids');
      if (!body.member_ids.includes(c.created_by)) {
        throw new MockError(400, 'CREATOR_REQUIRED', '사건 등록자는 빼낼 수 없어요.');
      }
      c.member_ids = Array.from(new Set(body.member_ids.filter((id) => findUser(id))));
      addAudit(user.id, 'ACCOUNT_CHANGE', `담당자 변경 ${c.case_no}`, c.id);
      db.save();
      return HttpResponse.json<UserBrief[]>(c.member_ids.map(toUserBrief));
    }),
  ),

  // 담당자 선택용 계정 검색 · 사용자 · SYS02-012
  http.get(
    '/api/users/brief',
    withMock(({ request }) => {
      requireUser(request);
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
      const list = db.state.users
        .filter((u) => u.active && (!q || u.name.includes(q) || u.username.includes(q)))
        .map((u) => ({ id: u.id, name: u.name }));
      return HttpResponse.json<UserBrief[]>(list);
    }),
  ),

  // 사건 영상 목록 · 사용자 · SYS02-009
  http.get(
    '/api/cases/:caseId/videos',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const list = db.state.videos
        .filter((v) => v.case_id === c.id)
        .map((video) => ({
          video,
          camera: db.state.cameras.find((cam) => cam.id === video.camera_id)!,
        }))
        .filter((x) => x.camera);
      return HttpResponse.json<CaseVideo[]>(list);
    }),
  ),

  // 사건 영상 추가(사설 CCTV, 블랙박스 등) · 사용자(맡은 사건만) · SYS02-009
  http.post(
    '/api/cases/:caseId/videos',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const form = await request.formData();
      const file = form.get('file');
      const name = String(form.get('name') ?? '').trim();
      const lat = Number(form.get('lat'));
      const lng = Number(form.get('lng'));
      const direction = Number(form.get('direction_deg'));
      const fov = form.get('fov_deg') ? Number(form.get('fov_deg')) : 90;
      const recordedAt = String(form.get('recorded_at') ?? '');

      if (!(file instanceof File)) return validationError('file');
      if (!name) return validationError('name');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return validationError('lat');
      if (!Number.isFinite(direction)) return validationError('direction_deg');
      if (!recordedAt) return validationError('recorded_at');
      if (file.size > MAX_VIDEO_BYTES)
        throw new MockError(413, 'FILE_TOO_LARGE', '영상은 2GB까지 올릴 수 있어요.');
      if (file.type && !file.type.startsWith('video/'))
        throw new MockError(415, 'UNSUPPORTED_FILE', '영상 파일만 올릴 수 있어요.');

      const count = db.state.cameras.filter((x) => x.case_id === c.id).length;
      const camera: Camera = {
        id: newId('cam'),
        code: `P${count + 1}`,
        name,
        location: { lat, lng },
        direction_deg: ((direction % 360) + 360) % 360,
        fov_deg: fov,
        source: 'CASE',
        case_id: c.id,
        video_count: 1,
        analyzed: false,
      };
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
        case_id: c.id,
        uploaded_at: nowKst(),
      };
      const task = createTask('VIDEO_ANALYSIS', {
        kind: 'video_done',
        video_id: video.id,
        camera_id: camera.id,
      });
      video.task_id = task.task_id;
      db.state.cameras.push(camera);
      db.state.videos.push(video);
      addAudit(user.id, 'VIDEO_UPLOAD', `사건 영상 추가 ${camera.code} ${name}`, c.id);
      db.save();
      return HttpResponse.json<CaseVideoAccepted>(
        { video, camera, task_id: task.task_id },
        { status: 202 },
      );
    }),
  ),
];
