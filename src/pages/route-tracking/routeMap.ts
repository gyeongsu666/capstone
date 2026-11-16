import type { CameraView, RouteMapView, RouteView } from '@/api/view';

/** 동선(서버) + 카메라 위치 → 지도용 동선 */
export function toRouteMap(route: RouteView | undefined, cameras: CameraView[]): RouteMapView {
  const loc = (id: string) => cameras.find((c) => c.id === id)?.location;
  const stops = (route?.scenes ?? [])
    .map((s) => ({ order: s.order, location: loc(s.cameraId), status: s.status }))
    .filter((s): s is RouteMapView['stops'][number] => !!s.location);
  const lastConfirmed = [...stops].reverse().find((s) => s.status === 'confirmed');
  const pendingLoc = route?.pending ? loc(route.pending.cameraId) : undefined;
  return {
    stops,
    path: route?.path ?? [],
    pending:
      pendingLoc && lastConfirmed
        ? { path: [lastConfirmed.location, pendingLoc], location: pendingLoc }
        : null,
  };
}
