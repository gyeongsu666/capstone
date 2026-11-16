import type { CSSProperties } from 'react';
import { CustomOverlayMap, Polyline } from 'react-kakao-maps-sdk';
import type { RouteMapView } from '@/api/view';
import { mapColor } from '@/theme';

const circle = (bg: string, border: string): CSSProperties => ({
  display: 'grid',
  placeItems: 'center',
  width: 26,
  height: 26,
  borderRadius: '50%',
  background: bg,
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  border: `3px solid ${border}`,
  boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
});

/** 동선: 확정 = 굵은 초록 실선 + 순번 원, 확인 대기 = 굵은 주황 점선 + "?" 원 */
export function RouteLayer({ route }: { route: RouteMapView }) {
  return (
    <>
      {route.path.length > 1 && (
        <Polyline
          path={route.path}
          strokeWeight={6}
          strokeColor={mapColor.route}
          strokeOpacity={0.95}
          strokeStyle="solid"
          zIndex={6}
        />
      )}
      {route.pending && (
        <>
          <Polyline
            path={route.pending.path}
            strokeWeight={5}
            strokeColor={mapColor.routePending}
            strokeOpacity={0.95}
            strokeStyle="dash"
            zIndex={6}
          />
          <CustomOverlayMap position={route.pending.location} zIndex={41} yAnchor={1.4}>
            <span style={circle(mapColor.routePending, '#fff')} title="확인 대기">
              ?
            </span>
          </CustomOverlayMap>
        </>
      )}
      {route.stops.map((s) => (
        <CustomOverlayMap key={s.order} position={s.location} zIndex={40} yAnchor={1.4}>
          <span
            className="num"
            style={
              s.status === 'confirmed'
                ? circle(mapColor.route, '#fff')
                : circle('#fff', mapColor.routePending)
            }
            title={s.status === 'confirmed' ? `${s.order}번 확정` : `${s.order}번 재확인 필요`}
          >
            <span style={{ color: s.status === 'confirmed' ? '#fff' : mapColor.routePending }}>
              {s.order}
            </span>
          </span>
        </CustomOverlayMap>
      ))}
    </>
  );
}
