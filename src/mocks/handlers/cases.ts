import { http, HttpResponse } from 'msw';
import type {
  S,
  ServerCase,
  ServerCaseCreateRequest,
  ServerCasePage,
  ServerCasePatch,
} from '@/api/server';
import type { CloseReason, WalkSpeedPreset } from '@/mocks/db/legacyTypes';
import { addAudit, db, findUser } from '@/mocks/db';
import { caseTitle, toServerAssignees, toServerCase } from '@/mocks/db/cases';
import type { DbCase, DbUser } from '@/mocks/db/schema';
import { ensureQuery } from '@/mocks/db/tracking';
import { stopWatchOnClose } from '@/mocks/handlers/search';
import { nowKst } from '@/mocks/db/time';
import {
  cursorPage,
  MockError,
  readJson,
  requireCaseAccess,
  requireOpenCase,
  requireUser,
  requireVersion,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

const PERSON_TYPES = ['adult', 'child', 'elderly', 'other'] as const;
const PRESET_BY_TYPE = {
  adult: 'ADULT',
  child: 'CHILD',
  elderly: 'ELDERLY',
  other: 'ADULT',
} as const satisfies Record<(typeof PERSON_TYPES)[number], WalkSpeedPreset>;
const CLOSE_BY_OUTCOME = {
  found: 'FOUND',
  unresolved: 'SEARCH_STOPPED',
  other: 'OTHER',
} as const satisfies Record<string, CloseReason>;
const CLOSE_LABEL: Record<CloseReason, string> = {
  FOUND: '발견',
  SEARCH_STOPPED: '미해결',
  OTHER: '기타',
};

const nextId = (ids: string[]) => String(Math.max(0, ...ids.map((x) => Number(x) || 0)) + 1);

/** 공동 담당 변경은 주 담당자 또는 관리자만 */
function requireOwnerOrAdmin(user: DbUser, c: DbCase) {
  if (user.role !== 'ADMIN' && c.created_by !== user.id)
    throw new MockError(403, 'FORBIDDEN', '주 담당자나 관리자만 담당자를 바꿀 수 있어요.');
}

export const caseHandlers = [
  // 사건 목록 · 사용자(맡은 사건만, 관리자는 전체) · SYS02-001
  http.get(
    '/api/cases',
    withMock(({ request }) => {
      const user = requireUser(request);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const q = (url.searchParams.get('query') ?? '').trim();
      const list = db.state.cases
        .filter((c) => user.role === 'ADMIN' || c.member_ids.includes(user.id))
        .filter((c) => !status || (status === 'closed') === (c.status === 'CLOSED'))
        .filter(
          (c) => !q || caseTitle(c).includes(q) || c.missing_person.name.includes(q) || c.id === q,
        )
        // 기본: 최신 생성·ID 역순(openapi.json x-data-rules.pagination)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || Number(b.id) - Number(a.id))
        .map(toServerCase);
      return HttpResponse.json<ServerCasePage>(cursorPage(list, request));
    }),
  ),

  // 사건 등록 · 사용자(등록자가 주 담당자) · SYS02-001
  http.post(
    '/api/cases',
    withMock(async ({ request }) => {
      const user = requireUser(request);
      const b = await readJson<ServerCaseCreateRequest>(request);
      if (!b.title?.trim()) return validationError('title');
      const name = b.person_name?.trim();
      if (!name || name.length > 50) return validationError('person_name', '1~50자');
      if (!b.person_type || !PERSON_TYPES.includes(b.person_type))
        return validationError('person_type');
      if (
        b.person_age !== undefined &&
        b.person_age !== null &&
        (!Number.isInteger(b.person_age) || b.person_age < 0 || b.person_age > 150)
      )
        return validationError('person_age', '0~150 정수');
      if (!b.last_seen_at) return validationError('last_seen_at');
      if (new Date(b.last_seen_at).getTime() > Date.now())
        throw new MockError(
          422,
          'INVALID_LAST_SEEN_AT',
          '마지막 목격 시각은 지금보다 앞이어야 해요.',
        );
      const loc = b.last_seen_location;
      if (!loc || loc.type !== 'Point' || loc.coordinates?.length !== 2)
        throw new MockError(422, 'INVALID_GEOMETRY', '마지막 목격 위치를 확인해 주세요.');
      const s = db.state.settings;
      if (s.default_similarity_threshold === null && b.similarity_threshold === undefined)
        throw new MockError(
          409,
          'SETTINGS_NOT_CONFIGURED',
          '관리자가 시스템 설정을 먼저 입력해야 해요.',
        );

      const now = nowKst();
      const c: DbCase = {
        id: nextId(db.state.cases.map((x) => x.id)),
        case_no: '',
        status: 'OPEN',
        missing_person: {
          name,
          age: b.person_age ?? null,
          description: b.appearance?.trim() ?? '',
        },
        missing_at: b.last_seen_at,
        last_seen_place: {
          name: b.last_seen_place_name?.trim() || '',
          location: { lat: loc.coordinates[1], lng: loc.coordinates[0] },
        },
        walk_speed_preset: PRESET_BY_TYPE[b.person_type],
        person_type: b.person_type,
        title: b.title.trim(),
        created_by: user.id,
        member_ids: [user.id],
        assigned_at: { [user.id]: new Date().toISOString() },
        created_at: now,
        closed_at: null,
        close_reason: null,
        version: 1,
        summary: {
          confirmed_count: 0,
          pending_count: 0,
          last_seen_at: null,
          last_seen_camera_code: null,
        },
      };
      db.state.cases.push(c);
      if (typeof b.similarity_threshold === 'number')
        ensureQuery(c).threshold = b.similarity_threshold;
      addAudit(user.id, 'CASE_CREATE', `사건 등록 ${caseTitle(c)}`, c.id);
      db.save();
      return HttpResponse.json<ServerCase>(toServerCase(c), { status: 201 });
    }),
  ),

  // 사건 상세(사이드바 사건 카드) · 사용자(맡은 사건만) · SYS02-001
  http.get(
    '/api/cases/:caseId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      return HttpResponse.json<ServerCase>(toServerCase(c));
    }),
  ),

  // 사건 정보 수정 · 사용자 · SYS02-001
  http.patch(
    '/api/cases/:caseId',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const b = await readJson<ServerCasePatch>(request);
      requireVersion(c.version ?? 1, b.expected_version);
      if (b.title !== undefined) c.title = b.title.trim();
      if (b.person_name !== undefined) c.missing_person.name = b.person_name.trim();
      if (b.person_age !== undefined) c.missing_person.age = b.person_age;
      if (b.appearance !== undefined) c.missing_person.description = b.appearance;
      if (b.person_type && PERSON_TYPES.includes(b.person_type)) {
        c.person_type = b.person_type;
        c.walk_speed_preset = PRESET_BY_TYPE[b.person_type];
      }
      if (b.last_seen_place_name !== undefined)
        c.last_seen_place.name = b.last_seen_place_name?.trim() || '';
      if (b.last_seen_at) c.missing_at = b.last_seen_at;
      if (b.last_seen_location)
        c.last_seen_place.location = {
          lat: b.last_seen_location.coordinates[1],
          lng: b.last_seen_location.coordinates[0],
        };
      c.version = (c.version ?? 1) + 1;
      db.save();
      return HttpResponse.json<ServerCase>(toServerCase(c));
    }),
  ),

  // 사건 종료(실시간 감시 자동 해제, 이후 읽기 전용) · 사용자 · SYS02-011
  http.post(
    '/api/cases/:caseId/close',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const b = await readJson<S['CaseCloseRequest']>(request);
      requireVersion(c.version ?? 1, b.expected_version);
      if (!b.outcome || !(b.outcome in CLOSE_BY_OUTCOME)) return validationError('outcome');
      if (!b.reason?.trim()) return validationError('reason', '종료 사유를 적어 주세요.');
      if (b.outcome === 'found' && !b.found_at)
        return validationError('found_at', '발견 시각이 필요해요.');
      c.status = 'CLOSED';
      c.closed_at = nowKst();
      c.close_reason = CLOSE_BY_OUTCOME[b.outcome];
      c.close_note = b.reason.trim();
      c.found_at = b.found_at ?? null;
      c.version = (c.version ?? 1) + 1;
      stopWatchOnClose(c);
      addAudit(
        user.id,
        'CASE_CLOSE',
        `사건 종료 ${caseTitle(c)} (${CLOSE_LABEL[c.close_reason]}: ${c.close_note})`,
        c.id,
      );
      db.save();
      return HttpResponse.json<ServerCase>(toServerCase(c));
    }),
  ),

  // 사건 담당자 목록 · 사용자(맡은 사건만) · SYS02-012
  http.get(
    '/api/cases/:caseId/assignees',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      return HttpResponse.json<S['AssigneeListResponse']>({
        case_id: Number(c.id),
        items: toServerAssignees(c),
      });
    }),
  ),

  // 공동 담당자 추가 · 주 담당자 또는 관리자 · SYS02-012
  http.post(
    '/api/cases/:caseId/assignees',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOwnerOrAdmin(user, c);
      requireOpenCase(c);
      const b = await readJson<S['AssigneeAddRequest']>(request);
      if (typeof b.user_id !== 'number') return validationError('user_id');
      const target = findUser(String(b.user_id));
      if (!target) throw new MockError(404, 'RESOURCE_NOT_FOUND', '계정을 찾을 수 없어요.');
      if (!target.active)
        throw new MockError(409, 'USER_INACTIVE', '비활성 계정은 추가할 수 없어요.');
      if (c.member_ids.includes(target.id))
        throw new MockError(409, 'ASSIGNEE_ALREADY_EXISTS', '이미 담당자예요.');
      c.member_ids.push(target.id);
      c.assigned_at = { ...c.assigned_at, [target.id]: new Date().toISOString() };
      addAudit(user.id, 'ACCOUNT_CHANGE', `담당자 추가 ${caseTitle(c)} · ${target.name}`, c.id);
      db.save();
      return HttpResponse.json<S['AssigneeListResponse']>(
        { case_id: Number(c.id), items: toServerAssignees(c) },
        { status: 201 },
      );
    }),
  ),

  // 공동 담당자 제거 · 주 담당자 또는 관리자 · SYS02-012 (이미 없으면 현재 목록으로 200)
  http.delete(
    '/api/cases/:caseId/assignees/:userId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOwnerOrAdmin(user, c);
      requireOpenCase(c);
      const id = String(params.userId);
      if (id === c.created_by)
        throw new MockError(409, 'OWNER_REMOVAL_FORBIDDEN', '주 담당자는 뺄 수 없어요.');
      if (c.member_ids.includes(id)) {
        c.member_ids = c.member_ids.filter((m) => m !== id);
        const name = findUser(id)?.name ?? id;
        addAudit(user.id, 'ACCOUNT_CHANGE', `담당자 제거 ${caseTitle(c)} · ${name}`, c.id);
        db.save();
      }
      return HttpResponse.json<S['AssigneeListResponse']>({
        case_id: Number(c.id),
        items: toServerAssignees(c),
      });
    }),
  ),
];
