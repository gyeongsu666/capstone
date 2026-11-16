import { Fragment, useState } from 'react';
import { Empty } from 'antd';
import { useSceneDetail } from '@/api/tracking';
import type { RouteView, SceneView } from '@/api/view';
import { SceneThumbnail } from '@/components/SceneThumbnail';
import { VideoPlayerModal } from '@/components/VideoPlayer';
import { statusColor } from '@/theme';

function Connector({ dashed }: { dashed: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        alignSelf: 'flex-start',
        marginTop: 34,
        width: 48,
        borderTop: `3px ${dashed ? 'dashed' : 'solid'} ${dashed ? statusColor.pending : statusColor.confirmed}`,
      }}
    />
  );
}

/** 타임라인: 확정 장면을 시간 순으로 잇고, 다음 확인 대기 구간을 점선으로. 장면을 누르면 영상 구간 재생 */
export function TimelineTab({ route }: { route: RouteView | undefined }) {
  const [playing, setPlaying] = useState<SceneView | null>(null);
  const { data: detail } = useSceneDetail(playing?.id ?? null);

  if (!route || (route.scenes.length === 0 && !route.pending)) {
    return <Empty description="아직 확정된 장면이 없어요." image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'flex-start', padding: '8px 4px', overflowX: 'auto' }}
      >
        {route.scenes.map((s, i) => (
          <Fragment key={s.candidateId}>
            {i > 0 && <Connector dashed={s.status !== 'confirmed'} />}
            <SceneThumbnail
              scene={s.scene}
              status={s.status}
              caption={`${s.order}. ${s.confirmedByName} 확정`}
              onClick={() => setPlaying(s.scene)}
            />
          </Fragment>
        ))}
        {route.pending && (
          <>
            {route.scenes.length > 0 && <Connector dashed />}
            <SceneThumbnail
              scene={route.pending.scene}
              status="pending"
              caption="확인 대기"
              onClick={() => setPlaying(route.pending!.scene)}
            />
          </>
        )}
      </div>
      <VideoPlayerModal
        scene={playing ? (detail?.scene ?? playing) : null}
        track={detail?.track}
        onClose={() => setPlaying(null)}
      />
    </>
  );
}
