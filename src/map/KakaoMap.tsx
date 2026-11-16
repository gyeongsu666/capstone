import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Map, useKakaoLoader, ZoomControl } from 'react-kakao-maps-sdk';
import { Segmented, Spin } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import type { LatLngView } from '@/api/view';

const KAKAO_KEY = import.meta.env.VITE_KAKAO_MAP_KEY;

/** 기본 중심: 국립목포대학교 도림캠퍼스(무안군 청계면) */
const DEFAULT_CENTER: LatLngView = { lat: 34.9103, lng: 126.4378 };

export type BaseMapType = 'ROADMAP' | 'HYBRID';

interface KakaoMapProps {
  /** 지도 위에 그리는 레이어(react-kakao-maps-sdk 요소) */
  children?: ReactNode;
  center?: LatLngView;
  level?: number;
  /** 처음 한 번 이 점들이 모두 보이게 맞춘다 */
  fitTo?: LatLngView[];
  /** 지도 왼쪽 위(레이어 토글) */
  topLeft?: ReactNode;
  /** 지도 왼쪽 아래(범례) */
  bottomLeft?: ReactNode;
  onClick?: (pos: LatLngView) => void;
  style?: CSSProperties;
}

function Notice({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        background: '#e9edf2',
        color: 'rgba(0,0,0,0.6)',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <EnvironmentOutlined style={{ fontSize: 32, color: '#9aa4b2' }} />
      <div style={{ fontWeight: 600 }}>{title}</div>
      {detail && <div style={{ fontSize: 12 }}>{detail}</div>}
    </div>
  );
}

/** 카카오맵 래퍼: 로딩·키 없음·실패 처리, 일반/위성 전환, 지도 위 배치 칸 */
export function KakaoMap(props: KakaoMapProps) {
  const { topLeft, bottomLeft, style } = props;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      {KAKAO_KEY ? (
        <LoadedMap {...props} />
      ) : (
        <Notice
          title="카카오 지도 키가 없어 지도를 표시할 수 없어요"
          detail={
            <>
              .env.local에 VITE_KAKAO_MAP_KEY를 넣고 개발 서버를 다시 시작하세요.
              <br />
              카카오 개발자 사이트에 http://localhost:5173 도메인이 등록돼 있어야 해요.
            </>
          }
        />
      )}
      {topLeft && (
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10 }}>{topLeft}</div>
      )}
      {bottomLeft && (
        <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 10 }}>{bottomLeft}</div>
      )}
    </div>
  );
}

function LoadedMap({
  children,
  center = DEFAULT_CENTER,
  level = 4,
  fitTo,
  onClick,
}: KakaoMapProps) {
  const [loading, error] = useKakaoLoader({ appkey: KAKAO_KEY });
  const [map, setMap] = useState<kakao.maps.Map | null>(null);
  const [mapType, setMapType] = useState<BaseMapType>('ROADMAP');
  const fitKey = fitTo?.map((p) => `${p.lat},${p.lng}`).join('|') ?? '';
  const fittedKey = useRef<string | null>(null);

  // 처음 한 번(또는 맞출 점들이 바뀌면) 모든 점이 보이게
  useEffect(() => {
    if (!map || !fitTo || fitTo.length === 0 || fittedKey.current === fitKey) return;
    const bounds = new kakao.maps.LatLngBounds();
    fitTo.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
    map.setBounds(bounds, 40, 40, 40, 40);
    fittedKey.current = fitKey;
  }, [map, fitTo, fitKey]);

  if (error) {
    return (
      <Notice
        title="카카오 지도를 불러오지 못했어요"
        detail="키가 맞는지, 카카오 개발자 사이트에 http://localhost:5173 도메인이 등록돼 있는지 확인하세요."
      />
    );
  }
  if (loading) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <Spin aria-label="지도를 불러오는 중" />
      </div>
    );
  }

  return (
    <>
      <Map
        center={center}
        level={level}
        mapTypeId={mapType}
        onCreate={setMap}
        onClick={(_, e) => onClick?.({ lat: e.latLng.getLat(), lng: e.latLng.getLng() })}
        style={{ position: 'absolute', inset: 0 }}
      >
        <ZoomControl position="RIGHT" />
        {children}
      </Map>
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
        <Segmented<BaseMapType>
          size="small"
          value={mapType}
          onChange={setMapType}
          options={[
            { label: '일반', value: 'ROADMAP' },
            { label: '위성', value: 'HYBRID' },
          ]}
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
        />
      </div>
    </>
  );
}
