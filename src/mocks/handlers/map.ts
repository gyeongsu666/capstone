import { http, HttpResponse } from 'msw';
import type {
  Camera,
  CameraCreateRequest,
  CameraUpdateRequest,
  DangerZone,
  DangerZoneCreateRequest,
  DangerZoneUpdateRequest,
  TargetType,
  TaskAccepted,
  WalkEdge,
  WalkEdgeUpdateRequest,
} from '@/api/types';
import { addAudit, db, newId } from '@/mocks/db';
import { createTask, settleTasks, taskProgress } from '@/mocks/db/tasks';
import {
  MockError,
  readJson,
  requireAdmin,
  requireCaseAccess,
  requireUser,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

/** 영상 수·분석 완료 여부는 영상 표에서 계산 */
export function withVideoStats(c: Camera): Camera {
  const videos = db.state.videos.filter((v) => v.camera_id === c.id);
  return { ...c, video_count: videos.length, analyzed: videos.some((v) => v.status === 'DONE') };
}

const TARGET_TYPES: TargetType[] = ['MISSING', 'CRIMINAL'];
let walkRecalcTaskId: string | null = null;

const requireAdminUser = (request: Request) => {
  const user = requireUser(request);
  requireAdmin(user);
  return user;
};

function findCamera(id: string) {
  const c = db.state.cameras.find((x) => x.id === id && x.source === 'FIXED');
  if (!c) throw new MockError(404, 'NOT_FOUND', '카메라를 찾을 수 없어요.');
  return c;
}

function requireUniqueCode(code: string, exceptId?: string) {
  if (db.state.cameras.some((c) => c.code === code && c.id !== exceptId))
    throw new MockError(409, 'CODE_TAKEN', `${code}는 이미 쓰는 코드예요.`);
}

function validArea(area: unknown) {
  const a = area as { type?: string; coordinates?: unknown[] } | undefined;
  return (
    !!a &&
    (a.type === 'Polygon' || a.type === 'MultiPolygon') &&
    Array.isArray(a.coordinates) &&
    a.coordinates.length > 0
  );
}

export const mapHandlers = [
  // 카메라 목록(모든 지도) · 사용자 · SYS01-001
  // case_id를 넣으면 그 사건의 사건 영상 카메라도 포함(맡은 사건만)
  http.get(
    '/api/cameras',
    withMock(({ request }) => {
      const user = requireUser(request);
      const caseId = new URL(request.url).searchParams.get('case_id');
      if (caseId) requireCaseAccess(user, caseId);
      settleTasks();
      const cameras = db.state.cameras
        .filter((c) => c.source === 'FIXED' || (caseId !== null && c.case_id === caseId))
        .map(withVideoStats);
      return HttpResponse.json<Camera[]>(cameras);
    }),
  ),

  // 카메라 등록 · 관리자 · SYS01-001
  http.post(
    '/api/cameras',
    withMock(async ({ request }) => {
      const user = requireAdminUser(request);
      const b = await readJson<CameraCreateRequest>(request);
      if (!b.code?.trim()) return validationError('code');
      if (!b.name?.trim()) return validationError('name');
      if (!b.location || typeof b.location.lat !== 'number') return validationError('location');
      if (typeof b.direction_deg !== 'number') return validationError('direction_deg');
      if (typeof b.fov_deg !== 'number') return validationError('fov_deg');
      const code = b.code.trim().toUpperCase();
      requireUniqueCode(code);
      const camera: Camera = {
        id: newId('cam'),
        code,
        name: b.name.trim(),
        location: b.location,
        direction_deg: b.direction_deg,
        fov_deg: b.fov_deg,
        source: 'FIXED',
        case_id: null,
        video_count: 0,
        analyzed: false,
      };
      db.state.cameras.push(camera);
      addAudit(user.id, 'SETTINGS_CHANGE', `카메라 등록 ${code} ${camera.name}`);
      db.save();
      return HttpResponse.json<Camera>(withVideoStats(camera), { status: 201 });
    }),
  ),

  // 카메라 수정 · 관리자 · SYS01-001
  http.patch(
    '/api/cameras/:cameraId',
    withMock(async ({ request, params }) => {
      const user = requireAdminUser(request);
      const c = findCamera(String(params.cameraId));
      const b = await readJson<CameraUpdateRequest>(request);
      if (b.code !== undefined) {
        const code = b.code.trim().toUpperCase();
        if (!code) return validationError('code');
        requireUniqueCode(code, c.id);
        c.code = code;
      }
      if (b.name !== undefined) c.name = b.name.trim();
      if (b.location) c.location = b.location;
      if (typeof b.direction_deg === 'number') c.direction_deg = b.direction_deg;
      if (typeof b.fov_deg === 'number') c.fov_deg = b.fov_deg;
      addAudit(user.id, 'SETTINGS_CHANGE', `카메라 수정 ${c.code}`);
      db.save();
      return HttpResponse.json<Camera>(withVideoStats(c));
    }),
  ),

  // 카메라 삭제 · 관리자 · SYS01-001
  http.delete(
    '/api/cameras/:cameraId',
    withMock(({ request, params }) => {
      const user = requireAdminUser(request);
      const c = findCamera(String(params.cameraId));
      if (db.state.videos.some((v) => v.camera_id === c.id))
        throw new MockError(409, 'CAMERA_HAS_VIDEOS', '등록된 영상이 있어 삭제할 수 없어요.');
      db.state.cameras = db.state.cameras.filter((x) => x.id !== c.id);
      db.state.walk_edges = db.state.walk_edges.filter(
        (e) => e.from_camera_id !== c.id && e.to_camera_id !== c.id,
      );
      addAudit(user.id, 'SETTINGS_CHANGE', `카메라 삭제 ${c.code}`);
      db.save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // 도보 구간 목록 · 관리자 · SYS01-002
  http.get(
    '/api/walk-edges',
    withMock(({ request }) => {
      requireAdminUser(request);
      const detourOnly = new URL(request.url).searchParams.get('detour_only') === 'true';
      const edges = detourOnly
        ? db.state.walk_edges.filter((e) => e.detour_suspected)
        : db.state.walk_edges;
      return HttpResponse.json<WalkEdge[]>(edges);
    }),
  ),

  // 도보 경로 다시 계산 · 관리자 · SYS01-002
  http.post(
    '/api/walk-edges/recalculate',
    withMock(({ request }) => {
      const user = requireAdminUser(request);
      const running = walkRecalcTaskId
        ? db.state.tasks.find((t) => t.task_id === walkRecalcTaskId)
        : undefined;
      if (running && !['SUCCESS', 'FAILURE'].includes(taskProgress(running).status))
        throw new MockError(409, 'TASK_RUNNING', '이미 다시 계산하고 있어요.');
      const task = createTask('WALK_ROUTE_CALC', { kind: 'none' }, { stepMs: 1500 });
      walkRecalcTaskId = task.task_id;
      addAudit(user.id, 'SETTINGS_CHANGE', '도보 경로 다시 계산');
      db.save();
      return HttpResponse.json<TaskAccepted>({ task_id: task.task_id }, { status: 202 });
    }),
  ),

  // 구간 보정값 수정 · 관리자 · SYS01-002
  http.patch(
    '/api/walk-edges/:edgeId',
    withMock(async ({ request, params }) => {
      const user = requireAdminUser(request);
      const e = db.state.walk_edges.find((x) => x.id === params.edgeId);
      if (!e) throw new MockError(404, 'NOT_FOUND', '구간을 찾을 수 없어요.');
      const b = await readJson<WalkEdgeUpdateRequest>(request);
      if (b.corrected_distance_m !== undefined) e.corrected_distance_m = b.corrected_distance_m;
      if (b.corrected_minutes !== undefined) e.corrected_minutes = b.corrected_minutes;
      addAudit(user.id, 'SETTINGS_CHANGE', `도보 구간 보정 ${e.id}`);
      db.save();
      return HttpResponse.json<WalkEdge>(e);
    }),
  ),

  // 위험 지역 목록(모든 지도) · 사용자 · SYS01-003
  http.get(
    '/api/danger-zones',
    withMock(({ request }) => {
      requireUser(request);
      return HttpResponse.json<DangerZone[]>(db.state.danger_zones);
    }),
  ),

  // 위험 지역 등록 · 관리자 · SYS01-003
  http.post(
    '/api/danger-zones',
    withMock(async ({ request }) => {
      const user = requireAdminUser(request);
      const b = await readJson<DangerZoneCreateRequest>(request);
      if (!b.name?.trim()) return validationError('name');
      if (!b.target_type || !TARGET_TYPES.includes(b.target_type))
        return validationError('target_type');
      if (!validArea(b.area)) return validationError('area');
      const zone: DangerZone = {
        id: newId('zone'),
        name: b.name.trim(),
        target_type: b.target_type,
        area: b.area!,
      };
      db.state.danger_zones.push(zone);
      addAudit(user.id, 'SETTINGS_CHANGE', `위험 지역 등록 ${zone.name}`);
      db.save();
      return HttpResponse.json<DangerZone>(zone, { status: 201 });
    }),
  ),

  // 위험 지역 수정 · 관리자 · SYS01-003
  http.patch(
    '/api/danger-zones/:zoneId',
    withMock(async ({ request, params }) => {
      const user = requireAdminUser(request);
      const z = db.state.danger_zones.find((x) => x.id === params.zoneId);
      if (!z) throw new MockError(404, 'NOT_FOUND', '위험 지역을 찾을 수 없어요.');
      const b = await readJson<DangerZoneUpdateRequest>(request);
      if (b.name !== undefined) z.name = b.name.trim();
      if (b.target_type && TARGET_TYPES.includes(b.target_type)) z.target_type = b.target_type;
      if (b.area && validArea(b.area)) z.area = b.area;
      addAudit(user.id, 'SETTINGS_CHANGE', `위험 지역 수정 ${z.name}`);
      db.save();
      return HttpResponse.json<DangerZone>(z);
    }),
  ),

  // 위험 지역 삭제 · 관리자 · SYS01-003
  http.delete(
    '/api/danger-zones/:zoneId',
    withMock(({ request, params }) => {
      const user = requireAdminUser(request);
      const z = db.state.danger_zones.find((x) => x.id === params.zoneId);
      if (!z) throw new MockError(404, 'NOT_FOUND', '위험 지역을 찾을 수 없어요.');
      db.state.danger_zones = db.state.danger_zones.filter((x) => x.id !== z.id);
      addAudit(user.id, 'SETTINGS_CHANGE', `위험 지역 삭제 ${z.name}`);
      db.save();
      return new HttpResponse(null, { status: 204 });
    }),
  ),
];
