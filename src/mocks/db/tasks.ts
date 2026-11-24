// 오래 걸리는 작업 흉내: 약 1초마다 progress 0 → 40 → 80 → 100 (docs/mock-scenario.md)
import type { S } from '@/api/server';
import type { Task, TaskStatus, TaskType } from '@/mocks/db/legacyTypes';
import { db, newId } from '@/mocks/db';
import type { DbTask, DbTaskEffect } from '@/mocks/db/schema';
import { addFakeCandidates } from '@/mocks/db/fakeCandidates';

const STEPS = [0, 40, 80, 100];

export function createTask(
  type: TaskType,
  effect: DbTaskEffect = { kind: 'none' },
  options: {
    stepMs?: number;
    failAt?: number;
    error?: string;
    result?: Record<string, unknown>;
  } = {},
): DbTask {
  const task: DbTask = {
    task_id: newId('task'),
    type,
    started_at: Date.now(),
    step_ms: options.stepMs ?? 1000,
    fail_at: options.failAt ?? null,
    error: options.error ?? null,
    result: options.result ?? null,
    effect,
    settled: false,
  };
  db.state.tasks.push(task);
  return task;
}

/** 지금 시각 기준 진행률·상태 */
export function taskProgress(t: DbTask): { status: TaskStatus; progress: number } {
  const step = Math.min(STEPS.length - 1, Math.floor((Date.now() - t.started_at) / t.step_ms));
  const progress = STEPS[step];
  if (t.fail_at !== null && progress >= t.fail_at)
    return { status: 'FAILURE', progress: t.fail_at };
  if (progress >= 100) return { status: 'SUCCESS', progress: 100 };
  return { status: progress === 0 ? 'PENDING' : 'PROGRESS', progress };
}

const SERVER_KIND = {
  VIDEO_ANALYSIS: 'video_analysis',
  WALK_ROUTE_CALC: 'walk_graph_recalculation',
  QUERY_EMBEDDING: 'query_embedding',
  CANDIDATE_SEARCH: 'candidate_search',
} as const;

/** 백엔드 Task 모양 */
export function toServerTask(t: DbTask): S['Task'] {
  const { status, progress } = taskProgress(t);
  const st = (
    { PENDING: 'queued', PROGRESS: 'running', SUCCESS: 'done', FAILURE: 'failed' } as const
  )[status];
  const stage =
    st === 'queued'
      ? 'queued'
      : st === 'done'
        ? 'done'
        : st === 'failed'
          ? 'failed'
          : t.type === 'VIDEO_ANALYSIS'
            ? progress < 50
              ? 'converting'
              : 'analyzing'
            : 'analyzing';
  const now = new Date().toISOString();
  return {
    task_id: t.task_id,
    kind: SERVER_KIND[t.type],
    case_id: null,
    video_id: null,
    status: st,
    stage,
    progress,
    seq: 1,
    processed_samples: 0,
    total_samples: null,
    skipped_samples: 0,
    heartbeat_at: st === 'running' ? now : null,
    created_at: new Date(t.started_at).toISOString(),
    updated_at: now,
    error:
      st === 'failed'
        ? { code: 'INTERNAL_ERROR', message: t.error ?? '작업이 실패했어요.', retryable: true }
        : null,
    result: st === 'done' ? (t.result as S['TaskResult'] | null) : null,
  };
}

export function toTask(t: DbTask): Task {
  const { status, progress } = taskProgress(t);
  return {
    task_id: t.task_id,
    type: t.type,
    status,
    progress,
    result: status === 'SUCCESS' ? t.result : null,
    error: status === 'FAILURE' ? (t.error ?? '작업이 실패했어요.') : null,
  };
}

function applyEffect(e: DbTaskEffect, success: boolean) {
  if (e.kind === 'image_ready') {
    const q = db.state.queries[e.case_id];
    const img = q?.images.find((i) => i.id === e.image_id);
    if (img && success) img.ready = true;
    if (img && !success && q) q.images = q.images.filter((i) => i.id !== e.image_id);
  }
  if (e.kind === 'search_done') {
    const q = db.state.queries[e.case_id];
    if (q) {
      q.search_task_id = null;
      if (success) q.searched = true;
    }
    if (success && e.fake_count) addFakeCandidates(e.case_id, e.fake_count);
  }
  if (e.kind === 'video_done') {
    const v = db.state.videos.find((x) => x.id === e.video_id);
    if (v) {
      v.status = success ? 'DONE' : 'FAILED';
      v.progress = success ? 100 : v.progress;
      v.task_id = null;
      v.duration_sec = v.duration_sec ?? 600;
      if (!success) v.error_message = '프레임 디코딩 실패';
    }
    const cam = db.state.cameras.find((c) => c.id === e.camera_id);
    if (cam && success) cam.analyzed = true;
  }
}

let lastVideoTick = 0;

/**
 * 시나리오 영상(작업 없이 진행 중인 것): 조회할 때마다 조금씩 올라 완료되고, 그다음 대기 영상이 시작된다.
 * 너무 빨리 끝나지 않게 2초에 한 번만 올린다.
 */
function advanceScenarioVideos() {
  if (Date.now() - lastVideoTick < 2000) return false;
  lastVideoTick = Date.now();
  const videos = db.state.videos;
  const running = videos.find((v) => v.status === 'PROCESSING' && !v.task_id);
  if (running) {
    running.progress = Math.min(100, running.progress + 4);
    if (running.progress >= 100) {
      running.status = 'DONE';
      running.duration_sec = 7200;
      const next = videos.find((v) => v.status === 'WAITING' && !v.task_id);
      if (next) next.status = 'PROCESSING';
    }
    return true;
  }
  return false;
}

/** 끝난 작업의 결과를 가짜 DB에 반영하고, 진행 중인 영상의 진행률을 맞춘다. 조회 핸들러 앞에서 부른다. */
export function settleTasks() {
  let changed = advanceScenarioVideos();
  for (const t of db.state.tasks) {
    const { status, progress } = taskProgress(t);
    if (t.effect.kind === 'video_done') {
      const effect = t.effect;
      const v = db.state.videos.find((x) => x.id === effect.video_id);
      if (v && v.status !== 'DONE' && v.status !== 'FAILED' && !t.settled) {
        v.status = status === 'PENDING' ? 'WAITING' : 'PROCESSING';
        v.progress = progress;
        changed = true;
      }
    }
    if (!t.settled && (status === 'SUCCESS' || status === 'FAILURE')) {
      applyEffect(t.effect, status === 'SUCCESS');
      t.settled = true;
      changed = true;
    }
  }
  if (changed) db.save();
}
