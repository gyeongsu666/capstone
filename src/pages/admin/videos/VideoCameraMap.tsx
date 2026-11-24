import { useMemo } from 'react';
import { CustomOverlayMap } from 'react-kakao-maps-sdk';
import type { CameraVideoStats, CameraView } from '@/api/view';
import { KakaoMap } from '@/map';
import { PRIMARY, statusColor } from '@/theme';

/** 마커 모양: 실패 = 빨간 링, 분석 중·대기 = 파란 점선 링, 영상 없음 = 회색 */
function markerStyle(s: CameraVideoStats | undefined) {
  if (!s || s.total === 0) return { bg: '#9ca3af', ring: 'none' };
  if (s.failed > 0) return { bg: PRIMARY, ring: `0 0 0 3px #fff, 0 0 0 6px ${statusColor.danger}` };
  if (s.processing + s.waiting > 0)
    return { bg: PRIMARY, ring: `0 0 0 3px #fff, 0 0 0 5px ${PRIMARY}` };
  return { bg: PRIMARY, ring: '0 1px 3px rgba(0,0,0,0.35)' };
}

const Legend = () => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 10px',
      padding: '6px 10px',
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      fontSize: 12,
    }}
  >
    <span>
      <span style={{ color: statusColor.danger, fontWeight: 700 }}>◎</span> 분석 실패
    </span>
    <span>
      <span style={{ color: PRIMARY, fontWeight: 700 }}>◎</span> 분석 중·대기
    </span>
    <span>
      <span style={{ color: PRIMARY, fontWeight: 700 }}>●</span> 완료
    </span>
    <span>
      <span style={{ color: '#9ca3af', fontWeight: 700 }}>●</span> 영상 없음
    </span>
    <span>숫자 = 영상 수</span>
  </div>
);

interface VideoCameraMapProps {
  cameras: CameraView[];
  /** 전체 현황(R7)의 카메라별 상태 수. 키는 서버 camera_id */
  stats: Record<string, CameraVideoStats>;
  /** 지도 노드 id */
  selectedCameraId: string | undefined;
  /** 표에서 누른 영상의 카메라: 주황 링으로 깜빡이고 지도 가운데로 옮긴다 */
  highlightedCameraId?: string;
  onSelect: (cameraId: string | undefined) => void;
}

/** 영상 화면용 지도: 카메라 위치별 영상 상태. 누르면 표가 그 카메라 영상으로 걸러진다 */
export function VideoCameraMap({
  cameras,
  stats,
  selectedCameraId,
  highlightedCameraId,
  onSelect,
}: VideoCameraMapProps) {
  const fixed = useMemo(() => cameras.filter((c) => c.source === 'fixed'), [cameras]);
  // 카메라들의 가운데를 중심으로 가깝게(마커가 겹치지 않게)
  const center = useMemo(() => {
    if (!fixed.length) return undefined;
    const lat = fixed.reduce((sum, c) => sum + c.location.lat, 0) / fixed.length;
    const lng = fixed.reduce((sum, c) => sum + c.location.lng, 0) / fixed.length;
    return { lat, lng };
  }, [fixed]);
  const highlighted = fixed.find((c) => c.id === highlightedCameraId);

  return (
    <KakaoMap center={highlighted?.location ?? center} level={4} bottomLeft={<Legend />}>
      {fixed.map((c) => {
        const s = stats[c.cameraId ?? c.id];
        const m = markerStyle(s);
        const selected = c.id === selectedCameraId;
        const lit = c.id === highlightedCameraId;
        return (
          <CustomOverlayMap
            key={c.id}
            position={c.location}
            zIndex={lit ? 40 : selected ? 30 : 20}
            clickable
          >
            <button
              type="button"
              onClick={() => onSelect(selected ? undefined : c.id)}
              title={`${c.code} ${c.name} · 영상 ${s?.total ?? 0}개${s?.failed ? ` · 실패 ${s.failed}` : ''}`}
              aria-label={`${c.code} ${c.name}`}
              aria-pressed={selected}
              style={{
                all: 'unset',
                position: 'relative',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                minWidth: 30,
                height: 30,
                padding: '0 4px',
                boxSizing: 'border-box',
                borderRadius: 15,
                background: selected ? '#0b3d91' : m.bg,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                border: '2px solid #fff',
                boxShadow: m.ring,
                animation: lit ? 'refind-highlight 1s ease-in-out infinite' : undefined,
                outline: selected ? '3px solid #111827' : undefined,
                outlineOffset: 6,
              }}
            >
              {c.code}
              <span
                className="num"
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -10,
                  minWidth: 16,
                  height: 16,
                  padding: '0 3px',
                  borderRadius: 8,
                  background: '#fff',
                  color: s?.failed ? statusColor.danger : '#111827',
                  border: `1px solid ${s?.failed ? statusColor.danger : '#d1d5db'}`,
                  fontSize: 12,
                  lineHeight: '14px',
                  textAlign: 'center',
                }}
              >
                {s?.total ?? 0}
              </span>
            </button>
          </CustomOverlayMap>
        );
      })}
    </KakaoMap>
  );
}
