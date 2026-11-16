import { http, HttpResponse } from 'msw';
import type { Settings, Task } from '@/api/types';
import { db, toUserBrief } from '@/mocks/db';
import { settleTasks, toTask } from '@/mocks/db/tasks';
import { MockError, requireUser, withMock } from '@/mocks/handlers/utils';

export const commonHandlers = [
  // 작업 상태 조회(폴링) · 사용자 · 공통
  http.get(
    '/api/tasks/:taskId',
    withMock(({ request, params }) => {
      requireUser(request);
      settleTasks();
      const t = db.state.tasks.find((x) => x.task_id === params.taskId);
      if (!t) throw new MockError(404, 'NOT_FOUND', '작업을 찾을 수 없어요.');
      return HttpResponse.json<Task>(toTask(t));
    }),
  ),

  // 시스템 설정 조회 · 사용자(사건 등록·질의 바에서 기본값 필요) · SYS01-006
  http.get(
    '/api/settings',
    withMock(({ request }) => {
      requireUser(request);
      const s = db.state.settings;
      return HttpResponse.json<Settings>({ ...s, updated_by: toUserBrief(s.updated_by) });
    }),
  ),
];
