import type { CameraView, CandidateView, RouteMapView, RouteView } from '@/api/view';

/** 장면의 camera_id로 카메라 찾기(지도 노드 id와 다를 수 있다) */
export const findCamera = (cameras: CameraView[], cameraId: string | null | undefined) =>
  cameraId ? cameras.find((c) => (c.cameraId ?? c.id) === cameraId) : undefined;

/** 동선(서버) + 카메라 위치 + 지금 확인 중인 후보 → 지도용 동선 */
export function toRouteMap(
  route: RouteView | undefined,
  cameras: CameraView[],
  pending: CandidateView | null = null,
): RouteMapView {
  const loc = (id: string) => findCamera(cameras, id)?.location;
  const stops = (route?.scenes ?? [])
    .map((s) => ({ order: s.order, location: loc(s.cameraId), status: s.status }))
    .filter((s): s is RouteMapView['stops'][number] => !!s.location);
  const lastConfirmed = [...stops].reverse().find((s) => s.status === 'confirmed');
  const pendingLoc = pending ? loc(pending.scene.cameraId) : undefined;
  return {
    stops,
    path: route?.path ?? [],
    pending:
      pendingLoc && lastConfirmed
        ? { path: [lastConfirmed.location, pendingLoc], location: pendingLoc }
        : null,
  };
}
