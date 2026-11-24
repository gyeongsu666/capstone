import { useEffect } from 'react';
import { Alert, Button, Tag } from 'antd';
import { CheckOutlined, CloseOutlined, PauseOutlined } from '@ant-design/icons';
import type { CandidateView, VerdictView } from '@/api/view';
import { ReasonList } from '@/components/ReasonList';
import { HighlightPlayer } from '@/components/VideoPlayer';
import { statusColor } from '@/theme';
import { formatSimilarity, formatTime } from '@/utils/format';

const verdictDone: Record<VerdictView, string> = {
  yes: '확정함',
  no: '제외함',
  hold: '보류함',
};

interface ConfirmAreaProps {
  candidate: CandidateView;
  /** 기준 사진 */
  queryImageUrl: string;
  onDecide: (verdict: VerdictView) => void;
  /** 저장 중인 판단 */
  pending?: VerdictView | null;
  /** 공동 담당자가 먼저 판단함: 버튼 대신 안내 */
  decidedBy?: { name: string; verdict: VerdictView } | null;
  /** 종료된 사건 등 */
  readOnly?: boolean;
  /** 판단할 수 없는 이유(기본: 종료된 사건) */
  readOnlyReason?: string;
  /** 남은 확인 개수 */
  remaining?: number;
  /** 지도 모드에서 작게 */
  compact?: boolean;
  /** 단축키 Y / N (화면에 확인 영역이 하나일 때만 켠다) */
  shortcuts?: boolean;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** 확인 영역: 기준 사진(왼쪽) ↔ 후보 하이라이트(오른쪽), 근거, 예/아니오/보류 */
export function ConfirmArea({
  candidate: c,
  queryImageUrl,
  onDecide,
  pending = null,
  decidedBy = null,
  readOnly = false,
  readOnlyReason = '종료된 사건이라 판단할 수 없어요.',
  remaining,
  compact = false,
  shortcuts = true,
}: ConfirmAreaProps) {
  const canDecide = !decidedBy && !readOnly && !pending;

  useEffect(() => {
    if (!shortcuts || !canDecide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // e.code를 써서 한글 입력 상태(ㅛ/ㅜ)에서도 동작
      if (e.code === 'KeyY') onDecide('yes');
      else if (e.code === 'KeyN') onDecide('no');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, canDecide, onDecide]);

  const hasOverlap = c.reasons.some((r) => r.kind === 'overlap');
  const imgWidth = compact ? 96 : 200;

  return (
    <section
      aria-label="확인 요청"
      style={{ background: '#fff', borderRadius: 8, padding: compact ? 12 : 20 }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>확인 요청</h2>
        {hasOverlap && <Tag color="orange">사람 겹침</Tag>}
        {c.outOfFilter && <Tag color="orange">필터 밖</Tag>}
        {c.status === 'needs_recheck' && <Tag color="orange">재확인 필요</Tag>}
        <span style={{ flex: 1 }} />
        {remaining !== undefined && (
          <span className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
            남은 확인 {remaining}개
          </span>
        )}
      </header>

      {!compact && <div style={{ marginBottom: 12 }}>이 사람이 찾는 대상이 맞나요?</div>}

      <div style={{ display: 'flex', gap: compact ? 12 : 20, alignItems: 'flex-start' }}>
        <figure style={{ margin: 0, width: imgWidth, flex: 'none', textAlign: 'center' }}>
          <img
            src={queryImageUrl}
            alt="기준 사진"
            style={{
              width: '100%',
              aspectRatio: '4 / 5',
              objectFit: 'cover',
              borderRadius: 6,
              display: 'block',
            }}
          />
          <figcaption style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 4 }}>
            기준
          </figcaption>
        </figure>
        <figure style={{ margin: 0, width: imgWidth, flex: 'none', textAlign: 'center' }}>
          <HighlightPlayer scene={c.scene} />
          <figcaption className="num" style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>
            {c.scene.cameraCode} {formatTime(c.scene.startAt)}
          </figcaption>
        </figure>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>유사도</div>
          <div
            className="num"
            style={{ fontSize: compact ? 18 : 20, fontWeight: 700, marginBottom: 8 }}
          >
            {formatSimilarity(c.similarity)}
          </div>
          <ReasonList reasons={c.reasons} max={3} size={compact ? 12 : 14} />
        </div>
      </div>

      <div style={{ marginTop: compact ? 12 : 20 }}>
        {decidedBy ? (
          <Alert
            type="info"
            showIcon
            message={`${decidedBy.name}님이 ${verdictDone[decidedBy.verdict]}`}
            description={
              compact ? undefined : '결정 기록 탭에서 확인하고 필요하면 번복할 수 있어요.'
            }
          />
        ) : readOnly ? (
          <Alert type="warning" showIcon message={readOnlyReason} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                size={compact ? 'middle' : 'large'}
                icon={<CheckOutlined />}
                loading={pending === 'yes'}
                disabled={!!pending && pending !== 'yes'}
                onClick={() => onDecide('yes')}
                style={{
                  flex: 2,
                  background: statusColor.confirmed,
                  borderColor: statusColor.confirmed,
                }}
              >
                예, 맞아요
              </Button>
              <Button
                size={compact ? 'middle' : 'large'}
                icon={<CloseOutlined />}
                loading={pending === 'no'}
                disabled={!!pending && pending !== 'no'}
                onClick={() => onDecide('no')}
                style={{ flex: 2 }}
              >
                아니요
              </Button>
              <Button
                size={compact ? 'middle' : 'large'}
                icon={<PauseOutlined />}
                loading={pending === 'hold'}
                disabled={!!pending && pending !== 'hold'}
                onClick={() => onDecide('hold')}
                style={{ flex: 1 }}
              >
                보류
              </Button>
            </div>
            {shortcuts && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 8 }}>
                단축키 <kbd>Y</kbd> 예 · <kbd>N</kbd> 아니요 · 보류하면 대기열 맨 뒤로 가요
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
