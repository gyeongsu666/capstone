import type { RequestHandler } from 'msw';
import { adminHandlers } from '@/mocks/handlers/admin';
import { authHandlers } from '@/mocks/handlers/auth';
import { caseHandlers } from '@/mocks/handlers/cases';
import { commonHandlers } from '@/mocks/handlers/common';
import { mapHandlers } from '@/mocks/handlers/map';
import { searchHandlers } from '@/mocks/handlers/search';
import { trackingHandlers } from '@/mocks/handlers/tracking';

// 묶음별 핸들러. 주소와 응답 모양은 openapi.json(+ 확정안 R1~R7)과 정확히 같게.
export const handlers: RequestHandler[] = [
  ...authHandlers,
  ...commonHandlers,
  ...trackingHandlers,
  ...searchHandlers,
  ...caseHandlers,
  ...mapHandlers,
  ...adminHandlers,
];
