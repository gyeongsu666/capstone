import { useRef, useState, type CSSProperties } from 'react';
import { Modal } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';
import type { BoxView, SceneView, TrackPointView } from '@/api/view';
import { formatTime } from '@/utils/format';

/** 영상이 없거나 재생할 수 없을 때: 썸네일 + 안내 */
function MediaFallback({ scene, message }: { scene: SceneView; message: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#1f2937' }}>
      <img
        src={scene.thumbnailUrl}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: 0.8 }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '6px 8px',
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <VideoCameraOutlined />
        {message}
      </div>
    </div>
  );
}

/** 인물 박스(0~1 비율) */
function PersonBox({ box }: { box: BoxView }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        border: '2px solid #facc15',
        borderRadius: 2,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
      }}
    />
  );
}

/** 재생 시각에 가장 가까운 인물 박스 */
function boxAt(track: TrackPointView[], t: number): BoxView | null {
  if (track.length === 0) return null;
  let best = track[0];
  for (const p of track) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return Math.abs(best.t - t) <= 1 ? best : null;
}

const NO_MEDIA = '영상 없음(가짜 데이터)';

interface VideoPlayerProps {
  scene: SceneView;
  /** 재생 중 인물 박스. 없으면 장면 구간 동안 대표 박스를 보여준다 */
  track?: TrackPointView[];
  /** 장면 앞뒤로 더 보여줄 시간(초) */
  paddingSec?: number;
  autoPlay?: boolean;
  style?: CSSProperties;
}

/** 영상 재생기: 해당 장면 앞뒤 10초를 재생하고 인물 박스를 겹쳐 그린다 */
export function VideoPlayer({
  scene,
  track = [],
  paddingSec = 10,
  autoPlay = true,
  style,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const [box, setBox] = useState<BoxView | null>(null);

  const from = Math.max(0, scene.clipStartSec - paddingSec);
  const to = scene.clipEndSec + paddingSec;

  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime >= to) v.pause();
    const t = v.currentTime;
    setBox(
      boxAt(track, t) ??
        (track.length === 0 && t >= scene.clipStartSec && t <= scene.clipEndSec
          ? scene.bbox
          : null),
    );
  };

  return (
    <div style={style}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: String(ratio),
          background: '#111827',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {!scene.videoUrl || failed ? (
          <MediaFallback scene={scene} message={NO_MEDIA} />
        ) : (
          <>
            <video
              ref={videoRef}
              src={scene.videoUrl}
              controls
              muted
              autoPlay={autoPlay}
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
                v.currentTime = from;
              }}
              onTimeUpdate={onTime}
              onError={() => setFailed(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />
            {box && <PersonBox box={box} />}
          </>
        )}
      </div>
      <div className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>
        {scene.cameraCode} {formatTime(scene.startAt)} · 장면 앞뒤 {paddingSec}초
      </div>
    </div>
  );
}

/** 하이라이트(3~5초 자동 반복, 인물 박스). 확인 영역의 후보 자리 */
export function HighlightPlayer({ scene, style }: { scene: SceneView; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 5',
        background: '#111827',
        borderRadius: 6,
        overflow: 'hidden',
        ...style,
      }}
    >
      {!scene.highlightUrl || failed ? (
        <MediaFallback scene={scene} message={NO_MEDIA} />
      ) : (
        <>
          <video
            src={scene.highlightUrl}
            autoPlay
            loop
            muted
            playsInline
            onError={() => setFailed(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          {scene.bbox && <PersonBox box={scene.bbox} />}
        </>
      )}
    </div>
  );
}

/** 다른 화면에서 쓰는 팝업 재생기 */
export function VideoPlayerModal({
  scene,
  track,
  onClose,
}: {
  scene: SceneView | null;
  track?: TrackPointView[];
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!scene}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
      title={scene ? `${scene.cameraCode} ${formatTime(scene.startAt)} 장면` : ''}
    >
      {scene && <VideoPlayer scene={scene} track={track} />}
    </Modal>
  );
}
