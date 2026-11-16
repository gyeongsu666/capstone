// 메인 사건(2026-031) 동선 추적 데이터: docs/mock-scenario.md "메인 사건 흐름"
// 실제 동선 C1 → C2 → C3 → C4 → C6. 시각은 모두 R 기준.
import type { Reason, Scene } from '@/api/types';
import { atR } from '@/mocks/db/time';
import type { DbCandidate, DbCandidateVariant, DbDecision, DbQuery } from '@/mocks/db/schema';
import { cameraId } from '@/mocks/scenario/map';

export const START_ANCHOR = 'start';

const clip = (code: string) => code.toLowerCase();

export function makeScene(
  r: number,
  code: string,
  minutes: number,
  color: string,
  opts: { camId?: string; videoId?: string } = {},
): Scene {
  const start = atR(r, minutes);
  return {
    id: `scene-${clip(code)}-${Math.abs(minutes)}`,
    camera_id: opts.camId ?? cameraId(code),
    camera_code: code,
    video_id: opts.videoId ?? `video-${clip(code)}-main`,
    start_at: start,
    end_at: atR(r, minutes + 0.1),
    start_sec: 600 + Math.abs(minutes) * 3,
    end_sec: 604 + Math.abs(minutes) * 3,
    thumbnail_url: `/mock/thumbnails/person-${color}.svg`,
    highlight_url: `/mock/clips/${clip(code)}-highlight.mp4`,
    video_url: `/mock/clips/${clip(code)}.mp4`,
    bbox: { x: 0.4, y: 0.2, w: 0.2, h: 0.6 },
  };
}

const v = (
  similarity: number,
  reasons: Reason[],
  extra: Partial<DbCandidateVariant> = {},
): DbCandidateVariant => ({
  similarity,
  reasons,
  out_of_filter: false,
  travel_minutes: null,
  expected_minutes: null,
  ...extra,
});

const ok = (text: string): Reason => ({ kind: 'ROUTE_OK', text });

export function createMainTracking(
  r: number,
  caseId: string,
  users: { user1: string; user2: string },
) {
  const S = {
    c1: makeScene(r, 'C1', -69, 'red'),
    old: makeScene(r, 'C10', -62, 'blue'),
    c2: makeScene(r, 'C2', -56, 'red'),
    c3: makeScene(r, 'C3', -38, 'red'),
    a: makeScene(r, 'C4', -31, 'red'),
    b: makeScene(r, 'C6', -26, 'red'),
    c: makeScene(r, 'C7', -35, 'crimson'),
    d: makeScene(r, 'C5', -30, 'darkred'),
    e: makeScene(r, 'C11', -20, 'pink'),
    f: makeScene(r, 'C9', -33, 'orange'),
    g: makeScene(r, 'C10', -28, 'white'),
    h: makeScene(r, 'C8', -29, 'gray'),
    i: makeScene(r, 'C8', -24, 'crimson'),
  };

  const cand = (
    id: string,
    scene: Scene,
    status: DbCandidate['status'],
    variants: Record<string, DbCandidateVariant>,
  ): DbCandidate => ({ id, case_id: caseId, scene_id: scene.id, status, variants, pinned: false });

  const candidates: DbCandidate[] = [
    cand('cand-c1', S.c1, 'CONFIRMED', { [START_ANCHOR]: v(0.82, [ok('마지막 확인 장소 근처')]) }),
    cand('cand-old', S.old, 'REJECTED', {
      'cand-c1': v(0.61, [{ kind: 'DIRECTION_MISMATCH', text: '방향 반대' }]),
    }),
    cand('cand-c2', S.c2, 'CONFIRMED', { 'cand-c1': v(0.77, [ok('이동 시간 13분 맞음')]) }),
    cand('cand-c3', S.c3, 'CONFIRMED', { 'cand-c2': v(0.74, [ok('이동 시간 18분 맞음')]) }),
    // C3 기준 대기열
    cand('cand-a', S.a, 'PENDING', {
      'cand-c3': v(
        0.71,
        [ok('이동 시간 7분 맞음'), ok('방향 동→북 맞음'), { kind: 'OVERLAP', text: '사람 겹침' }],
        { travel_minutes: 7, expected_minutes: 6 },
      ),
    }),
    cand('cand-b', S.b, 'PENDING', {
      'cand-c3': v(0.66, [ok('경로 일관')], { travel_minutes: 12, expected_minutes: 10 }),
      // C4 확정 후 재검색하면 맨 위로
      'cand-a': v(0.74, [ok('이동 시간 5분 맞음')], { travel_minutes: 5, expected_minutes: 4 }),
    }),
    cand('cand-c', S.c, 'PENDING', {
      'cand-c3': v(0.63, [{ kind: 'TIME_SHORT', text: '이동 시간 부족' }], {
        travel_minutes: 3,
        expected_minutes: 7,
      }),
    }),
    cand('cand-d', S.d, 'PENDING', { 'cand-c3': v(0.62, [ok('경로 일관')]) }),
    cand('cand-e', S.e, 'PENDING', {
      'cand-c3': v(0.86, [{ kind: 'OUT_OF_FILTER', text: '도보 범위 밖' }], {
        out_of_filter: true,
      }),
    }),
    cand('cand-f', S.f, 'PENDING', {
      'cand-c3': v(0.41, [{ kind: 'LOW_QUALITY', text: '화질 낮음' }]),
    }),
    cand('cand-g', S.g, 'PENDING', {
      'cand-c3': v(0.48, [{ kind: 'LOW_QUALITY', text: '얼굴 가림' }]),
    }),
    cand('cand-h', S.h, 'PENDING', {
      'cand-c3': v(0.55, [{ kind: 'LOW_QUALITY', text: '멀리 찍힘' }]),
    }),
    // C4 기준 새 후보(가짜)
    cand('cand-i', S.i, 'PENDING', {
      'cand-a': v(0.64, [{ kind: 'ROUTE_OK', text: '옷 비슷함' }]),
    }),
  ];

  const dec = (
    id: string,
    candidate: string,
    kind: DbDecision['kind'],
    by: string,
    minutes: number,
  ): DbDecision => ({
    id,
    case_id: caseId,
    candidate_id: candidate,
    kind,
    target_decision_id: null,
    reverted: false,
    decided_by: by,
    decided_at: atR(r, minutes),
  });

  const decisions: DbDecision[] = [
    dec('dec-4', 'cand-c3', 'YES', users.user2, -30),
    dec('dec-3', 'cand-c2', 'YES', users.user1, -50),
    dec('dec-2', 'cand-old', 'NO', users.user1, -55),
    dec('dec-1', 'cand-c1', 'YES', users.user1, -60),
  ];

  return { scenes: Object.values(S), candidates, decisions };
}

export function createQuery(
  timeFrom: string,
  threshold: number,
  image: { id: string; url: string } | null,
  searched: boolean,
): DbQuery {
  return {
    images: image ? [{ id: image.id, image_url: image.url, source: 'UPLOAD', ready: true }] : [],
    time_from: timeFrom,
    time_to: null,
    threshold,
    searched,
    search_task_id: null,
  };
}
