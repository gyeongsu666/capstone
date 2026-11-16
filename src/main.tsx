import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
