import { http, HttpResponse } from 'msw';
import type { S, ServerSystemSettings } from '@/api/server';
import { db } from '@/mocks/db';
import { settleTasks, toServerTask } from '@/mocks/db/tasks';
import { cursorPage, MockError, requireUser, withMock } from '@/mocks/handlers/utils';

export const commonHandlers = [
  // 작업 상태 조회(폴링) · 사용자 · 공통
  http.get(
    '/api/tasks/:taskId',
    withMock(({ request, params }) => {
      requireUser(request);
      settleTasks();
      const t = db.state.tasks.find((x) => x.task_id === params.taskId);
      if (!t) throw new MockError(404, 'RESOURCE_NOT_FOUND', '작업을 찾을 수 없어요.');
      return HttpResponse.json<S['Task']>(toServerTask(t));
    }),
  ),

  // 시스템 설정 조회 · 사용자(사건 등록·질의 바에서 기본값 필요) · SYS01-006
  http.get(
    '/api/settings',
    withMock(({ request }) => {
      requireUser(request);
      return HttpResponse.json<ServerSystemSettings>(db.state.settings);
    }),
  ),

  // 공동 담당 추가용 계정 검색 · 사용자 · SYS02-012
  // 활성 계정의 이름·아이디·역할만(관리자 정보 없음)
  http.get(
    '/api/users/directory',
    withMock(({ request }) => {
      requireUser(request);
      const q = (new URL(request.url).searchParams.get('query') ?? '').trim();
      const list = db.state.users
        .filter((u) => u.active)
        .filter((u) => !q || u.name.includes(q) || u.username.includes(q))
        .map((u): S['UserSummary'] => ({
          user_id: Number(u.id),
          username: u.username,
          display_name: u.name,
          role: u.role === 'ADMIN' ? 'admin' : 'user',
          active: u.active,
        }));
      return HttpResponse.json<S['UserDirectoryPage']>(cursorPage(list, request));
    }),
  ),
];
