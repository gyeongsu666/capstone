import { useState, type ReactNode } from 'react';
import { App, Button, Card, Col, Row, Space, Switch } from 'antd';
import type { SceneView, VerdictView } from '@/api/view';
import { TableFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import { CandidateCard } from '@/components/CandidateCard';
import { CaseCard } from '@/components/CaseCard';
import { ConfirmArea } from '@/components/ConfirmArea';
import { DecisionLog } from '@/components/DecisionLog';
import { EmptyState } from '@/components/EmptyState';
import { LiveAlertCard } from '@/components/LiveAlertCard';
import { SceneThumbnail } from '@/components/SceneThumbnail';
import { AnalysisStatusBadge, SceneStatusBadge } from '@/components/StatusBadge';
import { VideoPlayer, VideoPlayerModal } from '@/components/VideoPlayer';
import { useUndoToastStore } from '@/stores/undoToast';
import { statusColor } from '@/theme';
import { formatTime } from '@/utils/format';
import {
  alertAnswered,
  alertNew,
  candidates,
  caseCard,
  decisions,
  QUERY_IMAGE,
  scene,
} from '@/pages/dev/sampleData';

const verdictText: Record<VerdictView, string> = { yes: '확정함', no: '제외함', hold: '보류함' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="small" title={title} style={{ marginBottom: 16 }}>
      {children}
    </Card>
  );
}

/** 공통 부품 10개 확인용(개발 모드에서만 /dev/components) */
export function ComponentsPage() {
  const { message } = App.useApp();
  const showUndo = useUndoToastStore((s) => s.show);
  const [activeId, setActiveId] = useState('cand-a');
  const [pending, setPending] = useState<VerdictView | null>(null);
  const [decidedByOther, setDecidedByOther] = useState(false);
  const [compact, setCompact] = useState(false);
  const [modalScene, setModalScene] = useState<SceneView | null>(null);

  const active = candidates.find((c) => c.id === activeId) ?? candidates[0];

  const decide = (v: VerdictView) => {
    setPending(v);
    window.setTimeout(() => {
      setPending(null);
      showUndo(
        `${active.scene.cameraCode} ${formatTime(active.scene.startAt)} ${verdictText[v]}`,
        () => message.info('되돌렸어요(예시)'),
      );
    }, 500);
  };

  return (
    <>
      <PageHeader title="공통 부품 확인" summary="개발 모드 전용 · 화면용 타입 예시 데이터" />
      <TableFrame>
        <Section title="1. 상태 배지">
          <Space wrap>
            {(
              ['confirmed', 'pending', 'needs_recheck', 'held', 'rejected', 'reverted'] as const
            ).map((s) => (
              <SceneStatusBadge key={s} status={s} />
            ))}
            <span style={{ width: 24 }} />
            <AnalysisStatusBadge status="waiting" />
            <AnalysisStatusBadge status="processing" progress={62} />
            <AnalysisStatusBadge status="done" />
            <AnalysisStatusBadge status="failed" />
          </Space>
        </Section>

        <Row gutter={16}>
          <Col flex="auto">
            <Section title="3. 확인 영역">
              <Space style={{ marginBottom: 12 }}>
                <span>공동 담당자가 먼저 판단</span>
                <Switch size="small" checked={decidedByOther} onChange={setDecidedByOther} />
                <span>작게(지도 모드)</span>
                <Switch size="small" checked={compact} onChange={setCompact} />
              </Space>
              <div
                style={{
                  background: '#f3f5f8',
                  padding: 12,
                  borderRadius: 8,
                  maxWidth: compact ? 360 : undefined,
                }}
              >
                <ConfirmArea
                  candidate={active}
                  queryImageUrl={QUERY_IMAGE}
                  onDecide={decide}
                  pending={pending}
                  decidedBy={decidedByOther ? { name: '이수색', verdict: 'yes' } : null}
                  remaining={4}
                  compact={compact}
                />
              </div>
            </Section>
          </Col>
          <Col flex="360px">
            <Section title="2. 후보 카드 (대기열)">
              <div style={{ margin: '-12px' }}>
                {candidates.map((c) => (
                  <CandidateCard
                    key={c.id}
                    candidate={c}
                    active={c.id === activeId}
                    onClick={() => setActiveId(c.id)}
                  />
                ))}
              </div>
            </Section>
            <Section title="7. 실시간 출현 알림">
              <Space direction="vertical" style={{ width: '100%' }}>
                <LiveAlertCard
                  alert={alertNew}
                  onRespond={(k) => message.info(`알림 응답: ${k}`)}
                  onPlay={() => setModalScene(scene('C10', '16:01'))}
                />
                <LiveAlertCard alert={alertAnswered} />
              </Space>
            </Section>
          </Col>
        </Row>

        <Section title="4. 장면 썸네일 (타임라인) — 누르면 팝업 재생기">
          <Space size={24} align="start">
            <SceneThumbnail
              scene={scene('C1', '14:31')}
              status="confirmed"
              caption="서쪽 진입"
              onClick={() => setModalScene(scene('C1', '14:31'))}
            />
            <SceneThumbnail
              scene={scene('C2', '14:44')}
              status="confirmed"
              caption="남쪽 이탈"
              onClick={() => setModalScene(scene('C2', '14:44'))}
            />
            <SceneThumbnail
              scene={scene('C3', '15:02')}
              status="needs_recheck"
              onClick={() => setModalScene(scene('C3', '15:02'))}
            />
            <SceneThumbnail
              scene={scene('C4', '15:09')}
              status="pending"
              caption="확인 대기"
              onClick={() => setModalScene(scene('C4', '15:09'))}
            />
          </Space>
        </Section>

        <Row gutter={16}>
          <Col span={14}>
            <Section title="6. 결정 기록 줄">
              <DecisionLog decisions={decisions} onRevert={(id) => message.info(`번복: ${id}`)} />
            </Section>
          </Col>
          <Col span={10}>
            <Section title="5. 되돌리기 알림">
              <Space>
                <Button
                  onClick={() => showUndo('C4 15:09 확정함', () => message.info('되돌렸어요'))}
                >
                  알림 띄우기
                </Button>
                <Button
                  onClick={() => showUndo('C6 15:14 제외함', () => message.info('되돌렸어요'))}
                >
                  다른 알림으로 대신하기
                </Button>
              </Space>
            </Section>
            <Section title="8. 사건 카드 (사이드바)">
              <div style={{ background: '#151c2c', padding: 12, borderRadius: 8, width: 220 }}>
                <CaseCard caseData={caseCard} />
              </div>
            </Section>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Section title="9. 빈 화면 안내">
              <EmptyState
                message="기준 사진을 올리면 후보 검색을 시작해요"
                actionLabel="사진 올리기"
                onAction={() => message.info('사진 올리기')}
              />
            </Section>
          </Col>
          <Col span={12}>
            <Section title="10. 영상 재생기 (영상 파일 없음 → 안내)">
              <VideoPlayer scene={scene('C4', '15:09')} style={{ maxWidth: 420 }} />
              <div style={{ fontSize: 12, color: statusColor.excluded, marginTop: 8 }}>
                public/mock/clips/에 mp4를 두면 앞뒤 10초 재생 + 인물 박스가 보여요.
              </div>
            </Section>
          </Col>
        </Row>
      </TableFrame>
      <VideoPlayerModal scene={modalScene} onClose={() => setModalScene(null)} />
    </>
  );
}
