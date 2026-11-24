import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapSession } from '@/api/auth';
import { App } from '@/app/App';

async function enableMocking() {
  if (import.meta.env.VITE_USE_MOCK !== 'true') return;
  const { worker } = await import('@/mocks/browser');
  await worker.start({
    onUnhandledRequest(request, print) {
      // /api 요청인데 핸들러가 없으면 경고. 나머지(카카오맵, 정적 파일)는 통과.
      if (new URL(request.url).pathname.startsWith('/api')) print.warning();
    },
  });
}

// 가짜 서버를 켠 뒤, 세션 쿠키가 살아 있는지 /auth/me로 확인하고 화면을 그린다.
enableMocking()
  .then(bootstrapSession)
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
