// 동선 추적 계산: 기준점(마지막 확정 장면) → 대기열, 동선, 사건 요약
import type { Candidate, Case, Decision, LatLng, Scene } from '@/api/types';
import { db, findUser, toCase, toUserBrief } from '@/mocks/db';
import type { DbCandidate, DbCase, DbDecision, DbQuery } from '@/mocks/db/schema';
import { START_ANCHOR } from '@/mocks/scenario/tracking';

export const findScene = (id: string) => db.state.scenes.find((s) => s.id === id);

/** 사건의 검색 조건(새 사건이면 기본값으로 만든다) */
export function ensureQuery(c: DbCase): DbQuery {
  let q = db.state.queries[c.id];
  if (!q) {
    q = {
      images: [],
      time_from: c.missing_at,
      time_to: null,
      threshold: db.state.settings.similarity_threshold_default,
      searched: false,
      search_task_id: null,
    };
    db.state.queries[c.id] = q;
    db.save();
  }
  return q;
}

const sceneTime = (cand: DbCandidate) => findScene(cand.scene_id)?.start_at ?? '';

/** 확정 동선(확정 + 재확인 필요), 시간순 */
export function routeCandidates(caseId: string) {
  return db.state.candidates
    .filter(
      (x) => x.case_id === caseId && (x.status === 'CONFIRMED' || x.status === 'NEEDS_RECHECK'),
    )
    .sort((a, b) => sceneTime(a).localeCompare(sceneTime(b)));
}

/** 지금 기준점: 마지막 "확정" 후보(재확인 필요는 제외) */
export function currentAnchor(caseId: string) {
  const confirmed = routeCandidates(caseId).filter((x) => x.status === 'CONFIRMED');
  return confirmed.length ? confirmed[confirmed.length - 1].id : START_ANCHOR;
}

const variantFor = (cand: DbCandidate, anchor: string) =>
  cand.variants[anchor] ?? (cand.pinned ? Object.values(cand.variants).at(-1) : undefined);

export function toCandidate(cand: DbCandidate, threshold: number, anchor?: string): Candidate {
  const a = anchor ?? currentAnchor(cand.case_id);
  const variant = variantFor(cand, a) ?? Object.values(cand.variants)[0];
  return {
    id: cand.id,
    scene: findScene(cand.scene_id)!,
    similarity: variant.similarity,
    status: cand.status,
    below_threshold: variant.similarity < threshold,
    out_of_filter: variant.out_of_filter,
    reasons: variant.reasons,
    travel_minutes: variant.travel_minutes,
    expected_minutes: variant.expected_minutes,
  };
}

/** 대기열: 지금 기준점의 후보(대기·보류·재확인 필요) + 번복으로 돌아온 후보. 유사도 순, 필터 밖은 그 뒤, 보류는 맨 뒤 */
export function queue(caseId: string, threshold: number): Candidate[] {
  const anchor = currentAnchor(caseId);
  return db.state.candidates
    .filter((x) => x.case_id === caseId)
    .filter((x) => x.status === 'PENDING' || x.status === 'HELD' || x.status === 'NEEDS_RECHECK')
    .filter((x) => x.variants[anchor] || x.pinned)
    .map((x) => toCandidate(x, threshold, anchor))
    .sort((a, b) => {
      const held = Number(a.status === 'HELD') - Number(b.status === 'HELD');
      if (held !== 0) return held;
      // 자동 필터 밖 후보(확인 요청)는 범위 안 후보 뒤에
      const outside = Number(a.out_of_filter) - Number(b.out_of_filter);
      return outside !== 0 ? outside : b.similarity - a.similarity;
    });
}

/** 검색이 끝난 상태에서만 대기열을 보여준다 */
export function visibleQueue(caseId: string, q: DbQuery) {
  return q.searched ? queue(caseId, q.threshold) : [];
}

export function toDecision(d: DbDecision): Decision {
  const cand = db.state.candidates.find((x) => x.id === d.candidate_id);
  const scene = cand ? findScene(cand.scene_id) : undefined;
  return {
    id: d.id,
    candidate_id: d.candidate_id,
    scene: {
      camera_code: scene?.camera_code ?? '?',
      start_at: scene?.start_at ?? d.decided_at,
      thumbnail_url: scene?.thumbnail_url ?? '',
    },
    kind: d.kind,
    target_decision_id: d.target_decision_id,
    reverted: d.reverted,
    decided_by: toUserBrief(d.decided_by),
    decided_at: d.decided_at,
  };
}

/** 이 후보의 마지막 유효 판단(번복되지 않은 YES/NO/HOLD) */
export function activeDecisionFor(candidateId: string) {
  return db.state.decisions
    .filter((d) => d.candidate_id === candidateId && d.kind !== 'REVERT' && !d.reverted)
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
}

const camLoc = (scene: Scene): LatLng | undefined =>
  db.state.cameras.find((c) => c.id === scene.camera_id)?.location;

/** 확정 장면 카메라를 이은 경로 */
export function routePath(caseId: string): LatLng[] {
  const pts = routeCandidates(caseId)
    .map((x) => findScene(x.scene_id))
    .map((s) => (s ? camLoc(s) : undefined))
    .filter((p): p is LatLng => !!p);
  return pts;
}

export function caseSummary(c: DbCase) {
  const q = ensureQuery(c);
  const route = routeCandidates(c.id).filter((x) => x.status === 'CONFIRMED');
  const last = route.at(-1);
  const lastScene = last ? findScene(last.scene_id) : undefined;
  const pending = visibleQueue(c.id, q).filter(
    (x) => !x.below_threshold && x.status !== 'HELD',
  ).length;
  return {
    confirmed_count: route.length,
    pending_count: pending,
    last_seen_at: lastScene?.start_at ?? null,
    last_seen_camera_code: lastScene?.camera_code ?? null,
  };
}

/** 사건 응답(요약은 후보·판단에서 계산) */
export function toCaseWithSummary(c: DbCase): Case {
  // 종료된 시나리오 사건처럼 후보 데이터가 없으면 저장된 요약을 그대로 쓴다
  const hasData =
    db.state.candidates.some((x) => x.case_id === c.id) || c.summary.confirmed_count === 0;
  return { ...toCase(c), summary: hasData ? caseSummary(c) : c.summary };
}

export const decidedByName = (d: DbDecision) => findUser(d.decided_by)?.name ?? '다른 담당자';
