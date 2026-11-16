import { PlayCircleFilled } from '@ant-design/icons';
import type { SceneView } from '@/api/view';
import { statusColor } from '@/theme';
import { formatTime } from '@/utils/format';

export type SceneThumbnailStatus = 'confirmed' | 'pending' | 'needs_recheck';

interface SceneThumbnailProps {
  scene: SceneView;
  status: SceneThumbnailStatus;
  /** 아래 한 줄 설명(예: "서쪽 진입") */
  caption?: string;
  /** 누르면 영상 구간 재생 */
  onClick?: () => void;
  size?: number;
}

/** 장면 썸네일: 테두리로 상태(확정 초록 실선, 대기·재확인 주황 점선), 아래 카메라·시각 */
export function SceneThumbnail({
  scene,
  status,
  caption,
  onClick,
  size = 56,
}: SceneThumbnailProps) {
  const confirmed = status === 'confirmed';
  const color = confirmed ? statusColor.confirmed : statusColor.pending;
  const suffix = status === 'pending' ? ' ?' : '';

  return (
    <button
      type="button"
      onClick={onClick}
      title="눌러서 영상 구간 재생"
      style={{
        all: 'unset',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          position: 'relative',
          display: 'block',
          width: size,
          height: size * 1.2,
          borderRadius: 6,
          border: `3px ${confirmed ? 'solid' : 'dashed'} ${color}`,
          overflow: 'hidden',
          background: '#e5e7eb',
        }}
      >
        <img
          src={scene.thumbnailUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {onClick && (
          <PlayCircleFilled
            style={{
              position: 'absolute',
              right: 3,
              bottom: 3,
              fontSize: 14,
              color: '#fff',
              filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))',
            }}
          />
        )}
      </span>
      <span
        className="num"
        style={{ fontSize: 12, fontWeight: 600, color: confirmed ? 'rgba(0,0,0,0.85)' : color }}
      >
        {scene.cameraCode} {formatTime(scene.startAt)}
        {suffix}
      </span>
      {(caption || status === 'needs_recheck') && (
        <span
          style={{ fontSize: 12, color: status === 'needs_recheck' ? color : 'rgba(0,0,0,0.55)' }}
        >
          {status === 'needs_recheck' ? '재확인 필요' : caption}
        </span>
      )}
    </button>
  );
}
