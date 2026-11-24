// 지도: 카메라·보조 지점, 도보 그래프, 위험 지역 (openapi.json 모양)
import { http, HttpResponse } from 'msw';
import type { S } from '@/api/server';
import type { Camera, GeoJSONArea, WalkEdge } from '@/mocks/db/legacyTypes';
import { addAudit, db } from '@/mocks/db';
import type { DbDangerZone } from '@/mocks/db/schema';
import { createTask, settleTasks, taskProgress } from '@/mocks/db/tasks';
import { distanceM } from '@/mocks/scenario/geometry';
import {
  cursorPage,
  MockError,
  readJson,
  requireAdmin,
  requireCaseAccess,
  requireUser,
  requireVersion,
  validationError,
  withMock,
} from '@/mocks/handlers/utils';

type DbCamera = Camera & { version?: number };
type DbEdge = WalkEdge & { version?: number };

const DANGER_KINDS = ['water', 'steep_slope', 'road', 'construction', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high'] as const;
const CREATED_AT = '2026-11-01T00:00:00Z';
let walkRecalcTaskId: string | null = null;

const requireAdminUser = (request: Request) => {
  const user = requireUser(request);
  requireAdmin(user);
  return user;
};

const nextId = (ids: string[]) => String(Math.max(0, ...ids.map((x) => Number(x) || 0)) + 1);

/** "C3 학생회관" → code C3 + 이름. 코드로 시작하지 않으면 code는 비운다 */
function parseCameraName(full: string) {
  const m = /^([A-Za-z]{1,3}\d{1,4})\s+(.+)$/.exec(full.trim());
  return m ? { code: m[1].toUpperCase(), name: m[2] } : { code: '', name: full.trim() };
}

const validPoint = (p: unknown): p is S['GeoPoint'] => {
  const g = p as S['GeoPoint'] | undefined;
  return !!g && g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length === 2;
};

const validPolygon = (p: unknown): p is S['GeoPolygon'] => {
  const g = p as S['GeoPolygon'] | undefined;
  return (
    !!g &&
    g.type === 'Polygon' &&
    Array.isArray(g.coordinates) &&
    Array.isArray(g.coordinates[0]) &&
    g.coordinates[0].length >= 4
  );
};

// ---------- 서버 모양으로 ----------

export function toServerCamera(c: DbCamera): S['Camera'] {
  return {
    node_id: Number(c.id),
    camera_id: Number(c.id),
    kind: 'camera',
    name: c.code ? `${c.code} ${c.name}` : c.name,
    location: { type: 'Point', coordinates: [c.location.lng, c.location.lat] },
    direction_deg: c.direction_deg,
    field_of_view_deg: c.fov_deg,
    edge_node_map: null,
    has_stream: false,
    version: c.version ?? 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function toServerEdge(e: DbEdge): S['WalkEdge'] {
  const manual = e.corrected_minutes !== null && e.corrected_distance_m !== null;
  const from = db.state.cameras.find((c) => c.id === e.from_camera_id);
  const to = db.state.cameras.find((c) => c.id === e.to_camera_id);
  const straight = from && to ? distanceM(from.location, to.location) : null;
  return {
    edge_id: Number(e.id),
    from_node_id: Number(e.from_camera_id),
    to_node_id: Number(e.to_camera_id),
    distance_m: manual ? e.corrected_distance_m! : e.api_distance_m,
    duration_s: (manual ? e.corrected_minutes! : e.api_minutes) * 60,
    geometry:
      e.path.length >= 2
        ? { type: 'LineString', coordinates: e.path.map((p) => [p.lng, p.lat]) }
        : null,
    source: manual ? 'manual' : 'api',
    status: 'ok',
    suspected_detour: e.detour_suspected,
    detour_ratio: straight ? Math.round((e.api_distance_m / straight) * 100) / 100 : null,
    correction_factor: 1,
    version: e.version ?? 1,
    updated_at: CREATED_AT,
  };
}

function toServerZone(z: DbDangerZone): S['DangerZone'] {
  return {
    zone_id: Number(z.id),
    name: z.name,
    kind: z.kind,
    severity: z.severity,
    description: z.description,
    geometry: z.area as S['GeoPolygon'],
    version: z.version,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function findCamera(id: string) {
  const c = db.state.cameras.find((x) => x.id === id && x.source === 'FIXED');
  if (!c) throw new MockError(404, 'CAMERA_NOT_FOUND', '카메라를 찾을 수 없어요.');
  return c as DbCamera;
}

function findZone(id: string) {
  const z = db.state.danger_zones.find((x) => x.id === id);
  if (!z) throw new MockError(404, 'RESOURCE_NOT_FOUND', '위험 지역을 찾을 수 없어요.');
  return z;
}

export const mapHandlers = [
  // 카메라·보조 지점 목록(모든 지도) · 사용자 · SYS01-001
  // case_id를 넣으면 그 사건 전용 카메라(사건 영상)도 포함(맡은 사건만, 아니면 404)
  http.get(
    '/api/cameras',
    withMock(({ request }) => {
      const user = requireUser(request);
      const url = new URL(request.url);
      const caseId = url.searchParams.get('case_id');
      const kind = url.searchParams.get('kind');
      if (caseId) requireCaseAccess(user, caseId);
      settleTasks();
      const list = db.state.cameras
        .filter((c) => c.source === 'FIXED' || (caseId !== null && c.case_id === caseId))
        .filter(() => !kind || kind === 'camera')
        .map(toServerCamera);
      return HttpResponse.json<S['CameraPage']>(cursorPage(list, request));
    }),
  ),

  // 카메라·보조 지점 등록 · 관리자 · SYS01-001
  http.post(
    '/api/cameras',
    withMock(async ({ request }) => {
      const user = requireAdminUser(request);
      const b = await readJson<S['CameraCreateRequest']>(request);
      if (b.kind !== 'camera') return validationError('kind', '가짜 서버는 카메라만 등록해요.');
      if (!b.name?.trim()) return validationError('name');
      if (!validPoint(b.location)) return validationError('location');
      if (typeof b.direction_deg !== 'number') return validationError('direction_deg');
      if (typeof b.field_of_view_deg !== 'number') return validationError('field_of_view_deg');
      const { code, name } = parseCameraName(b.name);
      const [lng, lat] = b.location.coordinates;
      const camera: DbCamera = {
        id: nextId(db.state.cameras.map((c) => c.id)),
        code,
        name,
        location: { lat, lng },
        direction_deg: b.direction_deg,
        fov_deg: b.field_of_view_deg,
        source: 'FIXED',
        case_id: null,
        video_count: 0,
        analyzed: false,
        version: 1,
      };
      db.state.cameras.push(camera);
      addAudit(user.id, 'SETTINGS_CHANGE', `카메라 등록 ${b.name.trim()}`);
      db.save();
      return HttpResponse.json<S['CameraCreated']>(
        { camera: toServerCamera(camera), route_task: null },
        { status: 201 },
      );
    }),
  ),

  // 카메라·보조 지점 수정 · 관리자 · SYS01-001
  http.patch(
    '/api/cameras/:nodeId',
    withMock(async ({ request, params }) => {
      const user = requireAdminUser(request);
      const c = findCamera(String(params.nodeId));
      const b = await readJson<S['CameraPatch']>(request);
      requireVersion(c.version ?? 1, b.expected_version);
      if (b.name !== undefined) {
        if (!b.name.trim()) return validationError('name');
        Object.assign(c, parseCameraName(b.name));
      }
      if (b.location !== undefined) {
        if (!validPoint(b.location)) return validationError('location');
        c.location = { lat: b.location.coordinates[1], lng: b.location.coordinates[0] };
      }
      if (typeof b.direction_deg === 'number') c.direction_deg = b.direction_deg;
      if (typeof b.field_of_view_deg === 'number') c.fov_deg = b.field_of_view_deg;
      c.version = (c.version ?? 1) + 1;
      addAudit(user.id, 'SETTINGS_CHANGE', `카메라 수정 ${toServerCamera(c).name}`);
      db.save();
      return HttpResponse.json<S['Camera']>(toServerCamera(c));
    }),
  ),

  // 카메라·보조 지점 삭제 · 관리자 · SYS01-001
  http.delete(
    '/api/cameras/:nodeId',
    withMock(({ request, params }) => {
      const user = requireAdminUser(request);
      const c = findCamera(String(params.nodeId));
      if (db.state.videos.some((v) => v.camera_id === c.id))
        throw new MockError(
          409,
          'NODE_LOCATION_REFERENCED',
          '등록된 영상이 있어 삭제할 수 없어요.',
        );
      db.state.cameras = db.state.cameras.filter((x) => x.id !== c.id);
      db.state.walk_edges = db.state.walk_edges.filter(
        (e) => e.from_camera_id !== c.id && e.to_camera_id !== c.id,
      );
      addAudit(user.id, 'SETTINGS_CHANGE', `카메라 삭제 ${toServerCamera(c).name}`);
      db.save();
      return HttpResponse.json<S['DeletedResponse']>({ id: c.id, deleted: true });
    }),
  ),

  // 도보 구간 목록·우회 의심 · 관리자 · SYS01-002
  http.get(
    '/api/walk-graph',
    withMock(({ request }) => {
      requireAdminUser(request);
      const url = new URL(request.url);
      const detour = url.searchParams.get('suspected_detour');
      const nodeId = url.searchParams.get('node_id');
      const list = db.state.walk_edges
        .filter((e) => detour === null || String(e.detour_suspected) === detour)
        .filter((e) => !nodeId || e.from_camera_id === nodeId || e.to_camera_id === nodeId)
        .map(toServerEdge);
      return HttpResponse.json<S['WalkEdgePage']>(cursorPage(list, request));
    }),
  ),

  // 도보 경로 다시 계산 · 관리자 · SYS01-002
  http.post(
    '/api/walk-graph/recalculations',
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
      return HttpResponse.json<S['TaskAccepted']>(
        { task_id: task.task_id, status: 'queued', status_url: `/api/tasks/${task.task_id}` },
        { status: 202 },
      );
    }),
  ),

  // 구간 거리·시간 직접 보정 · 관리자 · SYS01-002 (source=manual로 저장)
  http.patch(
    '/api/walk-graph/:edgeId',
    withMock(async ({ request, params }) => {
      const user = requireAdminUser(request);
      const e = db.state.walk_edges.find((x) => x.id === params.edgeId) as DbEdge | undefined;
      if (!e) throw new MockError(404, 'RESOURCE_NOT_FOUND', '구간을 찾을 수 없어요.');
      const b = await readJson<S['WalkEdgePatch']>(request);
      requireVersion(e.version ?? 1, b.expected_version);
      if (b.distance_m !== undefined) {
        if (typeof b.distance_m !== 'number' || b.distance_m <= 0)
          return validationError('distance_m', '0보다 커야 해요.');
        e.corrected_distance_m = Math.round(b.distance_m);
      }
      if (b.duration_s !== undefined) {
        if (typeof b.duration_s !== 'number' || b.duration_s <= 0)
          return validationError('duration_s', '0보다 커야 해요.');
        e.corrected_minutes = Math.round(b.duration_s / 60);
      }
      e.corrected_distance_m ??= e.api_distance_m;
      e.corrected_minutes ??= e.api_minutes;
      e.version = (e.version ?? 1) + 1;
      addAudit(user.id, 'SETTINGS_CHANGE', `도보 구간 보정 ${e.id}`);
      db.save();
      return HttpResponse.json<S['WalkEdge']>(toServerEdge(e));
    }),
  ),

  // 위험 지역 목록(모든 지도) · 사용자 · SYS01-003
  http.get(
    '/api/danger-zones',
    withMock(({ request }) => {
      requireUser(request);
      const kind = new URL(request.url).searchParams.get('kind');
      const list = db.state.danger_zones.filter((z) => !kind || z.kind === kind).map(toServerZone);
      return HttpResponse.json<S['DangerZonePage']>(cursorPage(list, request));
    }),
  ),

  // 위험 지역 등록 · 관리자 · SYS01-003
  http.post(
    '/api/danger-zones',
    withMock(async ({ request }) => {
      const user = requireAdminUser(request);
      const b = await readJson<S['DangerZoneCreateRequest']>(request);
      if (!b.name?.trim()) return validationError('name');
      if (!b.kind || !DANGER_KINDS.includes(b.kind)) return validationError('kind');
      if (!b.severity || !SEVERITIES.includes(b.severity)) return validationError('severity');
      if (!validPolygon(b.geometry)) return validationError('geometry', '꼭짓점 3개 이상');
      const zone: DbDangerZone = {
        id: nextId(db.state.danger_zones.map((z) => z.id)),
        name: b.name.trim(),
        kind: b.kind,
        severity: b.severity,
        description: b.description?.trim() ?? '',
        area: b.geometry as GeoJSONArea,
        version: 1,
      };
      db.state.danger_zones.push(zone);
      addAudit(user.id, 'SETTINGS_CHANGE', `위험 지역 등록 ${zone.name}`);
      db.save();
      return HttpResponse.json<S['DangerZone']>(toServerZone(zone), { status: 201 });
    }),
  ),

  // 위험 지역 수정 · 관리자 · SYS01-003
  http.patch(
    '/api/danger-zones/:zoneId',
    withMock(async ({ request, params }) => {
      const user = requireAdminUser(request);
      const z = findZone(String(params.zoneId));
      const b = await readJson<S['DangerZonePatch']>(request);
      requireVersion(z.version, b.expected_version);
      if (b.name !== undefined) z.name = b.name.trim();
      if (b.kind && DANGER_KINDS.includes(b.kind)) z.kind = b.kind;
      if (b.severity && SEVERITIES.includes(b.severity)) z.severity = b.severity;
      if (b.description !== undefined) z.description = b.description;
      if (b.geometry !== undefined) {
        if (!validPolygon(b.geometry)) return validationError('geometry', '꼭짓점 3개 이상');
        z.area = b.geometry as GeoJSONArea;
      }
      z.version += 1;
      addAudit(user.id, 'SETTINGS_CHANGE', `위험 지역 수정 ${z.name}`);
      db.save();
      return HttpResponse.json<S['DangerZone']>(toServerZone(z));
    }),
  ),

  // 위험 지역 삭제 · 관리자 · SYS01-003
  http.delete(
    '/api/danger-zones/:zoneId',
    withMock(({ request, params }) => {
      const user = requireAdminUser(request);
      const z = findZone(String(params.zoneId));
      db.state.danger_zones = db.state.danger_zones.filter((x) => x.id !== z.id);
      addAudit(user.id, 'SETTINGS_CHANGE', `위험 지역 삭제 ${z.name}`);
      db.save();
      return HttpResponse.json<S['DeletedResponse']>({ id: z.id, deleted: true });
    }),
  ),
];
