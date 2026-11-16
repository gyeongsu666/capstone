import { CustomOverlayMap } from 'react-kakao-maps-sdk';
import type { LatLngView } from '@/api/view';
import { mapColor } from '@/theme';

/** 실시간 출현 위치: 빨간 원 + 퍼지는 링 */
export function LiveAlertMarker({ position, label }: { position: LatLngView; label?: string }) {
  return (
    <CustomOverlayMap position={position} zIndex={50}>
      <span
        title={label ?? '실시간 출현'}
        style={{ position: 'relative', display: 'block', width: 18, height: 18 }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: `3px solid ${mapColor.liveAlert}`,
            animation: 'refind-ping 1.4s ease-out infinite',
          }}
        />
        <span
          style={{
            position: 'absolute',
            inset: 3,
            borderRadius: '50%',
            background: mapColor.liveAlert,
            border: '2px solid #fff',
          }}
        />
      </span>
    </CustomOverlayMap>
  );
}
