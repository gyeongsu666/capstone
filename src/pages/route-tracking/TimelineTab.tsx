import { Fragment, useState } from 'react';
import { Empty } from 'antd';
import { useCaseSceneDetail } from '@/api/search';
import { useSceneDetail } from '@/api/tracking';
import type { CandidateView, RouteView, SceneView } from '@/api/view';
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
export function TimelineTab({
  caseId,
  route,
  pending = null,
}: {
  caseId: string;
  route: RouteView | undefined;
  /** 지금 확인 중인 후보(점선으로 이어 보여 준다) */
  pending?: CandidateView | null;
}) {
  const [playing, setPlaying] = useState<SceneView | null>(null);
  // 출현 알림에서 확정한 장면(alert:{id})은 사건 장면 API, 나머지는 트랙렛 API
  const isAlertScene = !!playing?.id.startsWith('alert:');
  const { data: trackletDetail } = useSceneDetail(playing && !isAlertScene ? playing.id : null);
  const { data: caseSceneDetail } = useCaseSceneDetail(
    caseId,
    playing && isAlertScene ? playing.id : null,
  );
  const detail = isAlertScene ? caseSceneDetail : trackletDetail;

  if (!route || (route.scenes.length === 0 && !pending)) {
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
              caption={
                s.status === 'needs_recheck'
                  ? `${s.order}. 재확인 필요`
                  : `${s.order}. ${s.confirmedByName} 확정`
              }
              onClick={() => setPlaying(s.scene)}
            />
          </Fragment>
        ))}
        {pending && (
          <>
            {route.scenes.length > 0 && <Connector dashed />}
            <SceneThumbnail
              scene={pending.scene}
              status="pending"
              caption="확인 대기"
              onClick={() => setPlaying(pending.scene)}
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
