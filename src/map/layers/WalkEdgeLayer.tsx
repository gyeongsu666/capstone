import { Fragment } from 'react';
import { CustomOverlayMap, Polyline } from 'react-kakao-maps-sdk';
import type { WalkEdgeView } from '@/api/view';
import { midpoint } from '@/map/geo';
import { mapColor, statusColor } from '@/theme';

interface WalkEdgeLayerProps {
  edges: WalkEdgeView[];
  /** 라벨용 카메라 코드 */
  cameraCodeById: Record<string, string>;
  selectedEdgeId?: string | null;
  onSelect?: (edge: WalkEdgeView) => void;
}

/** 도보 경로: 가는 회색 점선. 우회 의심 구간: 주황 점선 + 경고 라벨 */
export function WalkEdgeLayer({
  edges,
  cameraCodeById,
  selectedEdgeId,
  onSelect,
}: WalkEdgeLayerProps) {
  return (
    <>
      {edges.map((e) => {
        const selected = e.id === selectedEdgeId;
        const label = `${cameraCodeById[e.fromCameraId] ?? '?'}→${cameraCodeById[e.toCameraId] ?? '?'}`;
        return (
          <Fragment key={e.id}>
            <Polyline
              path={e.path}
              strokeWeight={e.detourSuspected ? 3 : selected ? 4 : 2}
              strokeColor={
                e.detourSuspected ? mapColor.detour : selected ? '#1677ff' : mapColor.walkEdge
              }
              strokeOpacity={0.9}
              strokeStyle={e.detourSuspected ? 'dash' : 'shortdash'}
              zIndex={4}
              onClick={() => onSelect?.(e)}
            />
            {e.detourSuspected && (
              <CustomOverlayMap position={midpoint(e.path)} zIndex={16} clickable>
                <span
                  onClick={() => onSelect?.(e)}
                  style={{
                    display: 'inline-block',
                    padding: '1px 6px',
                    fontSize: 12,
                    color: '#92400e',
                    background: statusColor.pendingBg,
                    border: `1px dashed ${statusColor.pending}`,
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                    cursor: onSelect ? 'pointer' : 'default',
                  }}
                >
                  ⚠ 우회 의심 {label}
                  {e.source === 'api' ? ' · 보정 필요' : ''}
                </span>
              </CustomOverlayMap>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
