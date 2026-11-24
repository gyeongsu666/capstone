// 동선 추적 공통 계산: 검색 조건, 확정 동선, 지금 기준점(마지막 확정 장면)
import { db } from '@/mocks/db';
import type { DbCase, DbQuery } from '@/mocks/db/schema';
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
      threshold: db.state.settings.default_similarity_threshold ?? 0.6,
      searched: false,
      search_task_id: null,
    };
    db.state.queries[c.id] = q;
    db.save();
  }
  return q;
}

const sceneTime = (candidateSceneId: string) => findScene(candidateSceneId)?.start_at ?? '';

/** 확정 동선(확정 + 재확인 필요), 시간순 */
export function routeCandidates(caseId: string) {
  return db.state.candidates
    .filter(
      (x) => x.case_id === caseId && (x.status === 'CONFIRMED' || x.status === 'NEEDS_RECHECK'),
    )
    .sort((a, b) => sceneTime(a.scene_id).localeCompare(sceneTime(b.scene_id)));
}

/** 지금 기준점: 마지막 "확정" 후보(재확인 필요는 제외), 없으면 "start" */
export function currentAnchor(caseId: string) {
  const confirmed = routeCandidates(caseId).filter((x) => x.status === 'CONFIRMED');
  return confirmed.length ? confirmed[confirmed.length - 1].id : START_ANCHOR;
}

/** 사건 요약: 유효한 확정 장면 수 */
export function caseSummary(c: DbCase) {
  return {
    confirmed_count: routeCandidates(c.id).filter((x) => x.status === 'CONFIRMED').length,
  };
}
