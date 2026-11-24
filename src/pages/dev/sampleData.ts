// 부품 확인 페이지용 예시 데이터(화면용 타입). 개발 모드에서만 쓴다.
import type { AlertView, CandidateView, CaseCardView, DecisionView, SceneView } from '@/api/view';

const today = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const thumb = (color: string) => `/mock/thumbnails/person-${color}.svg`;

export const scene = (code: string, hhmm: string, color = 'red'): SceneView => ({
  id: `scene-${code}-${hhmm}`,
  cameraId: `cam-${code.toLowerCase()}`,
  cameraCode: code,
  startAt: today(hhmm),
  endAt: today(hhmm),
  thumbnailUrl: thumb(color),
  // 파일이 없으므로 재생기는 "영상 없음(가짜 데이터)"로 바뀐다
  highlightUrl: `/mock/clips/${code.toLowerCase()}-highlight.mp4`,
  videoUrl: `/mock/clips/${code.toLowerCase()}.mp4`,
  clipStartSec: 12,
  clipEndSec: 16,
  bbox: { x: 0.38, y: 0.22, w: 0.24, h: 0.62 },
});

export const QUERY_IMAGE = '/mock/thumbnails/query-red.svg';

export const candidates: CandidateView[] = [
  {
    id: 'cand-a',
    scene: scene('C4', '15:09'),
    similarity: 0.71,
    status: 'pending',
    decisionId: null,
    belowThreshold: false,
    outOfFilter: false,
    reasons: [
      { kind: 'route_ok', text: '이동 시간 7분 맞음' },
      { kind: 'route_ok', text: '방향 동→북 맞음' },
      { kind: 'overlap', text: '사람 겹침' },
    ],
    travelMinutes: 7,
    expectedMinutes: 6,
  },
  {
    id: 'cand-b',
    scene: scene('C6', '15:14', 'orange'),
    similarity: 0.66,
    status: 'pending',
    decisionId: null,
    belowThreshold: false,
    outOfFilter: false,
    reasons: [{ kind: 'route_ok', text: '경로 일관' }],
    travelMinutes: null,
    expectedMinutes: null,
  },
  {
    id: 'cand-c',
    scene: scene('C7', '15:05', 'crimson'),
    similarity: 0.63,
    status: 'held',
    decisionId: null,
    belowThreshold: false,
    outOfFilter: false,
    reasons: [{ kind: 'time_short', text: '이동 시간 부족' }],
    travelMinutes: 3,
    expectedMinutes: 9,
  },
  {
    id: 'cand-e',
    scene: scene('C11', '15:20', 'pink'),
    similarity: 0.86,
    status: 'pending',
    decisionId: null,
    belowThreshold: false,
    outOfFilter: true,
    reasons: [{ kind: 'out_of_filter', text: '도보 범위 밖' }],
    travelMinutes: null,
    expectedMinutes: null,
  },
  {
    id: 'cand-f',
    scene: scene('C9', '15:12', 'darkred'),
    similarity: 0.48,
    status: 'pending',
    decisionId: null,
    belowThreshold: true,
    outOfFilter: false,
    reasons: [{ kind: 'low_quality', text: '화질 낮음' }],
    travelMinutes: null,
    expectedMinutes: null,
  },
];

export const decisions: DecisionView[] = [
  {
    id: 'dec-4',
    candidateId: 'cand-old',
    source: 'tracklet',
    observedAt: today('15:00'),
    needsRecheck: false,
    version: 1,
    verdict: 'no',
    decidedAt: today('15:31'),
    decidedByName: '김수색',
    scene: { cameraCode: 'C5', startAt: today('14:50'), thumbnailUrl: thumb('blue') },
    revert: { at: today('15:33'), byName: '이수색', reason: '옷 색이 달라요' },
  },
  {
    id: 'dec-3',
    candidateId: 'cand-c3',
    source: 'tracklet',
    observedAt: today('15:00'),
    needsRecheck: false,
    version: 1,
    verdict: 'yes',
    decidedAt: today('15:25'),
    decidedByName: '이수색',
    scene: { cameraCode: 'C3', startAt: today('15:02'), thumbnailUrl: thumb('red') },
    revert: null,
  },
  {
    id: 'dec-2',
    candidateId: 'cand-c2',
    source: 'tracklet',
    observedAt: today('15:00'),
    needsRecheck: false,
    version: 1,
    verdict: 'yes',
    decidedAt: today('15:12'),
    decidedByName: '김수색',
    scene: { cameraCode: 'C2', startAt: today('14:44'), thumbnailUrl: thumb('red') },
    revert: null,
  },
  {
    id: 'dec-1',
    candidateId: 'cand-c7',
    source: 'tracklet',
    observedAt: today('15:00'),
    needsRecheck: false,
    version: 1,
    verdict: 'hold',
    decidedAt: today('15:08'),
    decidedByName: '김수색',
    scene: { cameraCode: 'C7', startAt: today('15:05'), thumbnailUrl: thumb('crimson') },
    revert: null,
  },
];

export const alertNew: AlertView = {
  id: 'alert-1',
  cameraCode: 'C10',
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  seenAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  thumbnailUrl: thumb('red'),
  similarity: 0.84,
  status: 'new',
  respondedByName: null,
  scene: scene('C10', '16:01'),
};

export const alertAnswered: AlertView = {
  ...alertNew,
  id: 'alert-2',
  status: 'confirmed',
  respondedByName: '이수색',
};

export const caseCard: CaseCardView = {
  id: '31',
  title: '김OO 실종',
  personName: '김OO',
  age: 9,
  description: '빨간 상의, 남색 바지',
  missingAt: new Date(Date.now() - 80 * 60_000).toISOString(),
  walkSpeedLabel: '어린이',
  closed: false,
  closeReasonLabel: null,
};
