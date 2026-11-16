import { createBrowserRouter, Navigate } from 'react-router-dom';
import { NotFound, RequireAdmin, RequireAuth } from '@/app/guards';
import { AppLayout } from '@/app/layout/AppLayout';
import { CaseLayout } from '@/app/layout/CaseLayout';
import { CameraMapPage } from '@/pages/admin/camera-map/CameraMapPage';
import { SettingsPage } from '@/pages/admin/settings/SettingsPage';
import { VideosPage } from '@/pages/admin/videos/VideosPage';
import { CaseListPage } from '@/pages/cases/CaseListPage';
import { LoginPage } from '@/pages/login/LoginPage';
import { RouteTrackingPage } from '@/pages/route-tracking/RouteTrackingPage';
import { SearchAreaPage } from '@/pages/search-area/SearchAreaPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/cases" replace /> },
          { path: 'cases', element: <CaseListPage /> },
          {
            path: 'cases/:caseId',
            element: <CaseLayout />,
            children: [
              { index: true, element: <Navigate to="tracking" replace /> },
              { path: 'tracking', element: <RouteTrackingPage /> },
              { path: 'search-area', element: <SearchAreaPage /> },
            ],
          },
          {
            path: 'admin',
            element: <RequireAdmin />,
            children: [
              { index: true, element: <Navigate to="camera-map" replace /> },
              { path: 'camera-map', element: <CameraMapPage /> },
              { path: 'videos', element: <VideosPage /> },
              { path: 'settings', element: <Navigate to="system" replace /> },
              { path: 'settings/:tab', element: <SettingsPage /> },
            ],
          },
          // 공통 부품 확인 페이지(개발 모드에서만, 배포 빌드에는 포함되지 않음)
          ...(import.meta.env.DEV
            ? [
                {
                  path: 'dev/components',
                  lazy: async () => ({
                    Component: (await import('@/pages/dev/ComponentsPage')).ComponentsPage,
                  }),
                },
                {
                  path: 'dev/map',
                  lazy: async () => ({
                    Component: (await import('@/pages/dev/MapPage')).MapPage,
                  }),
                },
              ]
            : []),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
