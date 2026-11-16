import { Fragment } from 'react';
import { CustomOverlayMap, Polygon } from 'react-kakao-maps-sdk';
import type { AreaLevelPolygons, AreaLevelView, PriorityZoneView } from '@/api/view';
import { areaLevelColor } from '@/theme';

const LEVEL_COLOR: Record<AreaLevelView, string> = {
  high: areaLevelColor.HIGH,
  mid: areaLevelColor.MID,
  low: areaLevelColor.LOW,
};
const LEVEL_OPACITY: Record<AreaLevelView, number> = { high: 0.55, mid: 0.4, low: 0.35 };
/** 낮음 → 중간 → 높음 순으로 쌓는다 */
const ORDER: AreaLevelView[] = ['low', 'mid', 'high'];

interface SearchAreaLayerProps {
  levels: AreaLevelPolygons[];
  priorityZones?: PriorityZoneView[];
}

/** 현재 위치 범위: 길을 따라 퍼진 채운 영역, 3단계 보라 진하기(동심원 아님) + 우선 수색 구역 번호 */
export function SearchAreaLayer({ levels, priorityZones = [] }: SearchAreaLayerProps) {
  const sorted = [...levels].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  return (
    <>
      {sorted.map((l, li) => (
        <Fragment key={l.level}>
          {l.polygons.map((poly, i) => (
            <Polygon
              key={`${l.level}-${i}`}
              path={poly}
              strokeWeight={1}
              strokeColor={LEVEL_COLOR[l.level]}
              strokeOpacity={0.8}
              fillColor={LEVEL_COLOR[l.level]}
              fillOpacity={LEVEL_OPACITY[l.level]}
              zIndex={1 + li}
            />
          ))}
        </Fragment>
      ))}
      {priorityZones.map((z) => (
        <CustomOverlayMap key={z.rank} position={z.center} zIndex={35}>
          <span
            className="num"
            title={`우선 수색 ${z.rank}: ${z.name}`}
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 24,
              height: 24,
              borderRadius: 4,
              background: '#fff',
              color: areaLevelColor.HIGH,
              border: `2px solid ${areaLevelColor.HIGH}`,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {z.rank}
          </span>
        </CustomOverlayMap>
      ))}
    </>
  );
}
