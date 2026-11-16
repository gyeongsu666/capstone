import { CustomOverlayMap, Polygon } from 'react-kakao-maps-sdk';
import type { CameraView } from '@/api/view';
import { sector } from '@/map/geo';
import { mapColor } from '@/theme';

interface CameraLayerProps {
  cameras: CameraView[];
  /** 지금 확인 중인 후보의 카메라(파란 링) */
  activeCameraId?: string | null;
  /** 선택한 카메라(관리자 화면) */
  selectedCameraId?: string | null;
  onSelect?: (camera: CameraView) => void;
  /** 촬영 방향 부채꼴 */
  showSectors?: boolean;
}

/**
 * 카메라: 고정 CCTV = 원, 사건 영상 = 네모, 라벨(C1) + 촬영 방향 부채꼴.
 * 파랑, 분석 전이면 회색. 색만으로 구분하지 않도록 모양을 다르게 한다.
 */
export function CameraLayer({
  cameras,
  activeCameraId,
  selectedCameraId,
  onSelect,
  showSectors = true,
}: CameraLayerProps) {
  return (
    <>
      {showSectors &&
        cameras
          .filter((c) => c.directionDeg !== null && c.fovDeg !== null)
          .map((c) => {
            const color = c.analyzed ? mapColor.camera : mapColor.cameraNotAnalyzed;
            return (
              <Polygon
                key={`sector-${c.id}`}
                path={sector(c.location, c.directionDeg!, c.fovDeg!)}
                strokeWeight={0}
                strokeOpacity={0}
                fillColor={color}
                fillOpacity={0.25}
                zIndex={2}
              />
            );
          })}
      {cameras.map((c) => {
        const color = c.analyzed ? mapColor.camera : mapColor.cameraNotAnalyzed;
        const active = c.id === activeCameraId;
        const selected = c.id === selectedCameraId;
        const square = c.source === 'case';
        return (
          <CustomOverlayMap key={c.id} position={c.location} zIndex={active ? 30 : 20} clickable>
            <button
              type="button"
              onClick={() => onSelect?.(c)}
              title={`${c.code} ${c.name}${c.analyzed ? '' : ' (분석 전)'}`}
              aria-label={`${c.code} ${c.name}`}
              style={{
                all: 'unset',
                cursor: onSelect ? 'pointer' : 'default',
                display: 'grid',
                placeItems: 'center',
                minWidth: 28,
                height: 28,
                padding: '0 4px',
                boxSizing: 'border-box',
                borderRadius: square ? 4 : 14,
                background: color,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                border: '2px solid #fff',
                boxShadow: active
                  ? `0 0 0 3px #fff, 0 0 0 6px ${mapColor.currentCandidateRing}`
                  : selected
                    ? `0 0 0 3px ${mapColor.currentCandidateRing}`
                    : '0 1px 3px rgba(0,0,0,0.35)',
              }}
            >
              {c.code}
            </button>
          </CustomOverlayMap>
        );
      })}
    </>
  );
}
