import { useMemo } from 'react';
import { CustomOverlayMap, Polygon } from 'react-kakao-maps-sdk';
import { EnvironmentFilled } from '@ant-design/icons';
import type { CameraView, LatLngView } from '@/api/view';
import { sector } from '@/map/geo';
import { KakaoMap } from '@/map/KakaoMap';
import { CameraLayer } from '@/map/layers/CameraLayer';
import { PRIMARY, statusColor } from '@/theme';

interface LocationPickerProps {
  value: LatLngView | null;
  onChange: (pos: LatLngView) => void;
  /** 참고용 카메라 */
  cameras?: CameraView[];
  /** 정하면 찍은 위치에 촬영 방향 부채꼴을 미리 보여준다 */
  directionDeg?: number | null;
  fovDeg?: number | null;
  height?: number;
}

/** 작은 지도에서 위치 찍기(사건 등록의 마지막 확인 장소, 사건 영상 촬영 위치) */
export function LocationPicker({
  value,
  onChange,
  cameras = [],
  directionDeg,
  fovDeg,
  height = 240,
}: LocationPickerProps) {
  const fitTo = useMemo(
    () => (value ? [value] : cameras.length ? cameras.map((c) => c.location) : undefined),
    // 처음 열 때만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameras.length],
  );

  return (
    <div style={{ height, borderRadius: 6, overflow: 'hidden', border: '1px solid #d9d9d9' }}>
      <KakaoMap
        fitTo={fitTo}
        level={4}
        onClick={onChange}
        bottomLeft={
          <span
            style={{
              fontSize: 12,
              padding: '2px 8px',
              background: 'rgba(255,255,255,0.95)',
              borderRadius: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            }}
          >
            지도를 눌러 위치를 찍으세요
          </span>
        }
      >
        <CameraLayer cameras={cameras} showSectors={false} />
        {value && directionDeg !== null && directionDeg !== undefined && (
          <Polygon
            path={sector(value, directionDeg, fovDeg ?? 90, 60)}
            strokeWeight={1}
            strokeColor={PRIMARY}
            fillColor={PRIMARY}
            fillOpacity={0.3}
            zIndex={5}
          />
        )}
        {value && (
          <CustomOverlayMap position={value} yAnchor={1} zIndex={60}>
            <EnvironmentFilled
              style={{
                fontSize: 30,
                color: statusColor.danger,
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
              }}
            />
          </CustomOverlayMap>
        )}
      </KakaoMap>
    </div>
  );
}
