// 영상: 관리자 녹화 영상(전역) · 전체 현황 집계(R7) · 사건 영상 (openapi.json 모양)
import { http, HttpResponse } from 'msw';
import type { S, ServerVideoStats, VideoStatusCounts } from '@/api/server';
import type { Camera, Video } from '@/mocks/db/legacyTypes';
import { addAudit, db, findCase, pubId } from '@/mocks/db';
import { createTask, settleTasks } from '@/mocks/db/tasks';
import { nowKst } from '@/mocks/db/time';
import {
  cursorPage,
  MockError,
  readJson,
  requireAdmin,
  requireCaseAccess,
  requireOpenCase,
  requireUser,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

const MAX_VIDEO_BYTES = 2_000_000_000;
const iso = (t: string) => new Date(t).toISOString();

const STATUS = {
  WAITING: 'queued',
  PROCESSING: 'running',
  DONE: 'done',
  FAILED: 'failed',
} as const;

const nextId = (ids: string[]) => String(Math.max(0, ...ids.map((x) => Number(x) || 0)) + 1);

const cameraOf = (v: Video) => db.state.cameras.find((c) => c.id === v.camera_id);
const cameraName = (c: Camera | undefined, fallback: string) =>
  c ? (c.code ? `${c.code} ${c.name}` : c.name) : fallback;

export const videoPubId = (v: Video) => Number(pubId(v.id));
const findVideo = (id: string) => db.state.videos.find((v) => String(videoPubId(v)) === id);

export function toServerVideo(v: Video): S['Video'] {
  const cam = cameraOf(v);
  const status = STATUS[v.status];
  const vid = videoPubId(v);
  const stage =
    status === 'queued'
      ? 'queued'
      : status === 'done'
        ? 'done'
        : status === 'failed'
          ? 'failed'
          : v.progress < 40
            ? 'converting'
            : v.progress < 95
              ? 'analyzing'
              : 'saving';
  const updated = new Date().toISOString();
  const total = 600;
  return {
    video_id: vid,
    camera_id: Number(v.camera_id),
    camera_name: cameraName(cam, v.camera_code),
    case_id: v.case_id ? Number(v.case_id) : null,
    scope: v.case_id ? 'case' : 'global',
    location: { type: 'Point', coordinates: [cam?.location.lng ?? 0, cam?.location.lat ?? 0] },
    direction_deg: cam?.direction_deg ?? 0,
    recorded_start_at: iso(v.recorded_at),
    duration_s: v.duration_sec,
    analysis: {
      task_id: v.task_id ?? `analysis-${vid}`,
      status,
      stage,
      progress: v.progress,
      seq: 1,
      processed_samples: Math.round((total * v.progress) / 100),
      total_samples: status === 'queued' ? null : total,
      skipped_samples: 0,
      error_code: status === 'failed' ? 'VIDEO_DECODE_FAILED' : null,
      message: v.error_message,
      heartbeat_at: status === 'running' ? updated : null,
      updated_at: updated,
      video_id: vid,
      sample_interval_s: 1,
      model_name: 'mock-reid',
    },
    tracklet_count: db.state.scenes.filter((s) => s.video_id === v.id).length,
    playback_url: status === 'done' ? `/api/videos/${vid}/stream` : null,
    lifecycle: 'active',
    retain_until: null,
    hold: false,
    warnings: [],
    created_at: iso(v.uploaded_at),
  };
}

/** 실패가 먼저, 그다음 최신 등록순 */
function videoSort(a: Video, b: Video) {
  const failed = Number(b.status === 'FAILED') - Number(a.status === 'FAILED');
  return failed !== 0 ? failed : b.uploaded_at.localeCompare(a.uploaded_at);
}

const accepted = (v: Video, warnings: S['Warning'][] = []): S['VideoAccepted'] => ({
  video_id: videoPubId(v),
  task_id: v.task_id ?? '',
  status: 'queued',
  progress: 0,
  status_url: `/api/tasks/${v.task_id}`,
  warnings,
});

function checkFile(file: FormDataEntryValue | null): File {
  if (!(file instanceof File))
    throw new MockError(422, 'VALIDATION_ERROR', '영상 파일이 필요해요.', [
      { field: 'file', code: 'required', message: '필수 항목이에요.' },
    ]);
  if (file.size > MAX_VIDEO_BYTES)
    throw new MockError(413, 'FILE_TOO_LARGE', '영상은 2GB까지 올릴 수 있어요.');
  if (file.type && !file.type.startsWith('video/'))
    throw new MockError(422, 'UNSUPPORTED_VIDEO_FORMAT', 'mp4·mov·avi·mkv 영상만 올릴 수 있어요.');
  return file;
}

function checkRecordedAt(raw: FormDataEntryValue | null): string {
  const s = String(raw ?? '');
  const ms = new Date(s).getTime();
  if (!s || Number.isNaN(ms) || ms > Date.now() + 5 * 60_000)
    throw new MockError(422, 'INVALID_RECORDED_START_AT', '녹화 시작 시각을 확인해 주세요.');
  return s;
}

/** 분석 작업 시작. 파일 이름에 "fail"이 있으면 실패(실패 화면 확인용) */
function startAnalysis(v: Video, fileName = '') {
  const fail = /fail/i.test(fileName);
  const task = createTask(
    'VIDEO_ANALYSIS',
    { kind: 'video_done', video_id: v.id, camera_id: v.camera_id },
    { stepMs: 1500, failAt: fail ? 80 : undefined, error: fail ? '프레임 디코딩 실패' : undefined },
  );
  v.task_id = task.task_id;
  return task;
}

const emptyCounts = (): VideoStatusCounts => ({ queued: 0, running: 0, done: 0, failed: 0 });

export const videoHandlers = [
  // 녹화 영상 목록·분석 상태·진행률 · 관리자 · SYS01-004, 005 (cursor)
  http.get(
    '/api/videos',
    withMock(({ request }) => {
      requireAdmin(requireUser(request));
      settleTasks();
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const cameraId = url.searchParams.get('camera_id');
      const scope = url.searchParams.get('scope') ?? 'global';
      const caseId = url.searchParams.get('case_id');
      const list = db.state.videos
        .filter((v) => (scope === 'case' ? v.case_id !== null : v.case_id === null))
        .filter((v) => !caseId || v.case_id === caseId)
        .filter((v) => !status || STATUS[v.status] === status)
        .filter((v) => !cameraId || v.camera_id === cameraId)
        .sort(videoSort)
        .map(toServerVideo);
      return HttpResponse.json<S['VideoPage']>(cursorPage(list, request));
    }),
  ),

  // 전역 녹화 영상 전체 현황 · 관리자 · R7 (목록 필터와 무관하게 전체 모집단)
  http.get(
    '/api/videos/stats',
    withMock(({ request }) => {
      requireAdmin(requireUser(request));
      settleTasks();
      const total = emptyCounts();
      const byCamera = new Map<number, VideoStatusCounts>();
      for (const v of db.state.videos.filter((x) => x.case_id === null)) {
        const s = STATUS[v.status];
        total[s] += 1;
        const cid = Number(v.camera_id);
        const c = byCamera.get(cid) ?? emptyCounts();
        c[s] += 1;
        byCamera.set(cid, c);
      }
      const sum = (c: VideoStatusCounts) => c.queued + c.running + c.done + c.failed;
      return HttpResponse.json<ServerVideoStats>({
        total: sum(total),
        by_status: total,
        by_camera: [...byCamera]
          .sort((a, b) => a[0] - b[0])
          .map(([camera_id, by_status]) => ({ camera_id, total: sum(by_status), by_status })),
        as_of: new Date().toISOString(),
      });
    }),
  ),

  // 녹화 영상 업로드·분석 접수 · 관리자 · SYS01-004 (전역 카메라만)
  http.post(
    '/api/videos',
    withMock(async ({ request }) => {
      const user = requireUser(request);
      requireAdmin(user);
      const form = await request.formData();
      const cameraId = String(form.get('camera_id') ?? '');
      if (!cameraId) return validationError('camera_id');
      const file = checkFile(form.get('file'));
      const recordedAt = checkRecordedAt(form.get('recorded_start_at'));
      const camera = db.state.cameras.find((c) => c.id === cameraId);
      if (!camera) throw new MockError(422, 'CAMERA_NOT_FOUND', '카메라를 찾을 수 없어요.');
      if (camera.source !== 'FIXED')
        throw new MockError(409, 'CASE_CAMERA_NOT_ALLOWED', '사건 영상 카메라에는 올릴 수 없어요.');
      const video: Video = {
        id: `video-${nextId(db.state.videos.map((v) => v.id.replace(/\D/g, '')))}-up`,
        camera_id: camera.id,
        camera_code: camera.code,
        file_name: file.name,
        recorded_at: recordedAt,
        duration_sec: null,
        status: 'WAITING',
        progress: 0,
        error_message: null,
        task_id: null,
        case_id: null,
        uploaded_at: nowKst(),
      };
      startAnalysis(video, file.name);
      // 같은 카메라 녹화 시각이 겹치면 경고만
      const overlap = db.state.videos.some(
        (v) => v.camera_id === camera.id && v.case_id === null && v.recorded_at === recordedAt,
      );
      db.state.videos.push(video);
      addAudit(user.id, 'VIDEO_UPLOAD', `녹화 영상 등록 ${cameraName(camera, '')}`);
      db.save();
      return HttpResponse.json<S['VideoAccepted']>(
        accepted(
          video,
          overlap
            ? [
                {
                  code: 'RECORDING_OVERLAP',
                  message: '같은 카메라에 녹화 시각이 겹치는 영상이 있어요.',
                  related_video_ids: [],
                },
              ]
            : [],
        ),
        { status: 202 },
      );
    }),
  ),

  // 영상 상세·분석 현황 · 관리자(사건 영상은 맡은 사건 담당자도)
  http.get(
    '/api/videos/:videoId',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      settleTasks();
      const v = findVideo(String(params.videoId));
      if (!v) throw new MockError(404, 'RESOURCE_NOT_FOUND', '영상을 찾을 수 없어요.');
      if (v.case_id) requireCaseAccess(user, v.case_id);
      else requireAdmin(user);
      return HttpResponse.json<S['Video']>(toServerVideo(v));
    }),
  ),

  // 실패한 영상 분석 재처리 · 관리자 · SYS01-005 (새 task_id)
  http.post(
    '/api/videos/:videoId/analysis',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      requireAdmin(user);
      const v = findVideo(String(params.videoId));
      if (!v) throw new MockError(404, 'RESOURCE_NOT_FOUND', '영상을 찾을 수 없어요.');
      await readJson<S['VideoRetryRequest']>(request);
      if (v.status === 'DONE')
        throw new MockError(409, 'ANALYSIS_ALREADY_DONE', '이미 분석이 끝난 영상이에요.');
      if (v.status !== 'FAILED')
        throw new MockError(409, 'QUERY_UPDATE_IN_PROGRESS', '분석 중인 영상이에요.');
      v.status = 'WAITING';
      v.progress = 0;
      v.error_message = null;
      startAnalysis(v);
      addAudit(user.id, 'VIDEO_UPLOAD', `분석 재처리 영상 #${videoPubId(v)}`);
      db.save();
      return HttpResponse.json<S['VideoAccepted']>(accepted(v), { status: 202 });
    }),
  ),

  // 사건에 추가한 영상 목록 · 사용자(맡은 사건만) · SYS02-009
  http.get(
    '/api/cases/:caseId/videos',
    withMock(({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      settleTasks();
      const list = db.state.videos
        .filter((v) => v.case_id === c.id)
        .sort(videoSort)
        .map(toServerVideo);
      return HttpResponse.json<S['VideoPage']>(cursorPage(list, request));
    }),
  ),

  // 사건 영상 추가(사설 CCTV, 블랙박스 등) · 사용자(맡은 사건만) · SYS02-009
  // 사건 전용 카메라와 영상을 함께 만든다(화각 입력 없음)
  http.post(
    '/api/cases/:caseId/videos',
    withMock(async ({ request, params }) => {
      const user = requireUser(request);
      const c = requireCaseAccess(user, String(params.caseId));
      requireOpenCase(c);
      const form = await request.formData();
      const file = checkFile(form.get('file'));
      const lng = Number(form.get('longitude'));
      const lat = Number(form.get('latitude'));
      const direction = Number(form.get('direction_deg'));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return validationError('latitude');
      if (!Number.isFinite(direction)) return validationError('direction_deg');
      const recordedAt = checkRecordedAt(form.get('recorded_start_at'));
      const count = db.state.cameras.filter((x) => x.case_id === c.id).length;
      const name = String(form.get('camera_name') ?? '').trim() || `사건 영상 ${count + 1}`;

      const camera: Camera = {
        id: nextId(db.state.cameras.map((x) => x.id)),
        code: `P${count + 1}`,
        name,
        location: { lat, lng },
        direction_deg: ((direction % 360) + 360) % 360,
        fov_deg: 90,
        source: 'CASE',
        case_id: c.id,
        video_count: 1,
        analyzed: false,
      };
      const video: Video = {
        id: `video-case-${c.id}-${count + 1}`,
        camera_id: camera.id,
        camera_code: camera.code,
        file_name: file.name,
        recorded_at: recordedAt,
        duration_sec: null,
        status: 'WAITING',
        progress: 0,
        error_message: null,
        task_id: null,
        case_id: c.id,
        uploaded_at: nowKst(),
      };
      startAnalysis(video, file.name);
      db.state.cameras.push(camera);
      db.state.videos.push(video);
      addAudit(user.id, 'VIDEO_UPLOAD', `사건 영상 추가 ${camera.code} ${name}`, c.id);
      db.save();
      return HttpResponse.json<S['VideoAccepted']>(accepted(video), { status: 202 });
    }),
  ),
];

export const caseOfVideo = (v: Video) => (v.case_id ? findCase(v.case_id) : undefined);
