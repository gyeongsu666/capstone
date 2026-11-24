// 가짜 DB 사건 → 백엔드 Case 모양(openapi.json + 요청 R1·R6)
import type { S, ServerCase } from '@/api/server';
import { db, findUser } from '@/mocks/db';
import type { DbCase } from '@/mocks/db/schema';
import { caseSummary, ensureQuery } from '@/mocks/db/tracking';
import {
  activeDecision,
  latestSearch,
  searchCandidates,
  toServerSearchRun,
} from '@/mocks/db/searches';

const PERSON_TYPE = { ADULT: 'adult', CHILD: 'child', ELDERLY: 'elderly', OTHER: 'other' } as const;
const OUTCOME = { FOUND: 'found', SEARCH_STOPPED: 'unresolved', OTHER: 'other' } as const;

const iso = (t: string | null | undefined) => (t ? new Date(t).toISOString() : null);

export const caseTitle = (c: DbCase) => c.title ?? `${c.missing_person.name} 실종`;
export const casePersonType = (c: DbCase) =>
  c.person_type ?? PERSON_TYPE[c.walk_speed_preset as keyof typeof PERSON_TYPE] ?? 'adult';

export function toServerUserSummary(id: string): S['UserSummary'] {
  const u = findUser(id);
  return {
    user_id: Number(id),
    username: u?.username ?? 'unknown',
    display_name: u?.name ?? '(알 수 없음)',
    role: u?.role === 'ADMIN' ? 'admin' : 'user',
    active: u?.active ?? false,
  };
}

export function toServerAssignees(c: DbCase): S['Assignee'][] {
  return c.member_ids.map((id) => ({
    user: toServerUserSummary(id),
    is_owner: id === c.created_by,
    assigned_at: c.assigned_at?.[id] ?? new Date(c.created_at).toISOString(),
    assigned_by: Number(c.created_by),
  }));
}

export function toServerCase(c: DbCase): ServerCase {
  const q = ensureQuery(c);
  // 종료된 시나리오 사건처럼 후보 데이터가 없으면 저장된 요약을 쓴다
  const hasData =
    db.state.candidates.some((x) => x.case_id === c.id) || c.summary.confirmed_count === 0;
  const summary = hasData ? caseSummary(c) : c.summary;
  const latest = latestSearch(c.id);
  const search = latest ? toServerSearchRun(latest) : null;
  // R1: 최신 검색이 끝났고 낡지 않았을 때만, 유효 판단이 없는 후보 수
  const pending =
    latest && search && search.status === 'done' && !search.stale
      ? searchCandidates(latest).filter(({ cand }) => !activeDecision(cand.id)).length
      : null;
  const created = iso(c.created_at)!;
  const ready = q.images.some((i) => i.ready);
  return {
    case_id: Number(c.id),
    title: caseTitle(c),
    person_type: casePersonType(c),
    description: '',
    appearance: c.missing_person.description,
    status: c.status === 'CLOSED' ? 'closed' : 'open',
    close_outcome: c.close_reason ? OUTCOME[c.close_reason] : null,
    close_reason: c.close_note ?? null,
    closed_at: iso(c.closed_at),
    found_at: c.found_at ?? null,
    last_seen_at: iso(c.missing_at)!,
    last_seen_location: {
      type: 'Point',
      coordinates: [c.last_seen_place.location.lng, c.last_seen_place.location.lat],
    },
    origin_node_id: 1,
    owner_id: Number(c.created_by),
    assignees: toServerAssignees(c),
    query: {
      status: ready ? 'ready' : q.images.length ? 'running' : 'not_set',
      source_type: q.images.length ? 'photo' : null,
      query_version: 1,
      tracklet_id: null,
      photo_url: q.images[0]?.image_url ?? null,
      model_name: ready ? 'mock-reid' : null,
      embedding_dimension: ready ? 512 : null,
      task_id: null,
      error_code: null,
      updated_at: created,
    },
    search_conditions: {
      case_id: Number(c.id),
      similarity_threshold: q.threshold,
      alert_high_threshold: db.state.settings.alert_high_threshold,
      version: 1,
      updated_at: created,
    },
    watch_enabled: db.state.watches[c.id]?.status === 'ON',
    version: c.version ?? 1,
    created_at: created,
    updated_at: created,
    // R1
    person_name: c.missing_person.name,
    person_age: c.missing_person.age,
    last_seen_place_name: c.last_seen_place.name || null,
    summary: {
      confirmed_count: summary.confirmed_count,
      // done이고 stale이 아닌 최신 검색이 있을 때만 숫자
      pending_count: pending,
    },
    // R6
    latest_search: search,
  };
}
