import { setupWorker } from 'msw/browser';
import { db } from '@/mocks/db';
import { handlers } from '@/mocks/handlers';

export const worker = setupWorker(...handlers);

// 개발 중 콘솔에서 가짜 DB를 들여다보고 상황을 만들 수 있게(예: 공동 담당자가 먼저 판단한 상황)
if (import.meta.env.DEV) {
  (window as unknown as { __mockDb: typeof db }).__mockDb = db;
}
