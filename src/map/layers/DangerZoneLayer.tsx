import { Fragment } from 'react';
import { CustomOverlayMap, Polygon } from 'react-kakao-maps-sdk';
import { polygonsCenter, type DangerZoneView } from '@/api/view';
import { mapColor } from '@/theme';

/** 위험 지역: 점선 테두리 + 옅은 채움, 빨강, 이름 라벨 */
export function DangerZoneLayer({ zones }: { zones: DangerZoneView[] }) {
  return (
    <>
      {zones.map((z) => (
        <Fragment key={z.id}>
          {z.polygons.map((poly, i) => (
            <Polygon
              key={`${z.id}-${i}`}
              path={poly}
              strokeWeight={2}
              strokeColor={mapColor.dangerZone}
              strokeOpacity={0.9}
              strokeStyle="dash"
              fillColor={mapColor.dangerZone}
              fillOpacity={0.12}
              zIndex={3}
            />
          ))}
          <CustomOverlayMap position={polygonsCenter(z.polygons)} zIndex={15}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: mapColor.dangerZone,
                textShadow: '0 0 3px #fff, 0 0 3px #fff',
                whiteSpace: 'nowrap',
              }}
            >
              {z.name} (위험)
            </span>
          </CustomOverlayMap>
        </Fragment>
      ))}
    </>
  );
}
