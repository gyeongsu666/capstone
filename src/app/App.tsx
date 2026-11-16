import { lazy, Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Providers } from '@/app/providers';
import { router } from '@/app/router';

// 개발 모드 + 가짜 서버일 때만 개발 패널을 불러온다(배포 빌드에는 포함되지 않음)
const DevPanel =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true'
    ? lazy(() => import('@/mocks/dev-panel/DevPanel'))
    : null;

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
      {DevPanel && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}
    </Providers>
  );
}
