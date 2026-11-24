// 시연용: "다시 검색"이 끝날 때 지금 기준점 뒤에 새 가짜 후보를 만든다(개발 패널에서 켜고 끔)
import type { Reason } from '@/mocks/db/legacyTypes';
import { db, findCase, newId } from '@/mocks/db';
import type { DbCandidate } from '@/mocks/db/schema';
import { currentAnchor, findScene } from '@/mocks/db/tracking';
import { makeScene, START_ANCHOR } from '@/mocks/scenario/tracking';

const COLORS = ['darkred', 'crimson', 'orange', 'pink', 'red', 'blue'];

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function randomReasons(travel: number): Reason[] {
  return pick<Reason[]>([
    [{ kind: 'ROUTE_OK', text: `이동 시간 ${travel}분 맞음` }],
    [
      { kind: 'ROUTE_OK', text: '경로 일관' },
      { kind: 'OVERLAP', text: '사람 겹침' },
    ],
    [{ kind: 'TIME_SHORT', text: '이동 시간 부족' }],
    [{ kind: 'ROUTE_OK', text: '옷 비슷함' }],
    [{ kind: 'DIRECTION_MISMATCH', text: '방향 반대' }],
  ]);
}

/** 지금 기준점(마지막 확정 장면, 없으면 실종 시각) 뒤 몇 분 사이에 다른 카메라에서 찍힌 후보 */
export function addFakeCandidates(caseId: string, count: number) {
  const c = findCase(caseId);
  if (!c || count <= 0) return;
  const anchor = currentAnchor(caseId);
  const anchorCand =
    anchor === START_ANCHOR ? undefined : db.state.candidates.find((x) => x.id === anchor);
  const anchorScene = anchorCand ? findScene(anchorCand.scene_id) : undefined;
  const baseMs = new Date(anchorScene?.start_at ?? c.missing_at).getTime();

  // 분석이 끝난 고정 CCTV(기준 카메라 제외)
  const analyzed = new Set(
    db.state.videos.filter((v) => v.status === 'DONE').map((v) => v.camera_id),
  );
  const cameras = db.state.cameras.filter(
    (cam) => cam.source === 'FIXED' && analyzed.has(cam.id) && cam.id !== anchorScene?.camera_id,
  );
  if (!cameras.length) return;

  for (let i = 0; i < count; i++) {
    const cam = pick(cameras);
    const travel = Math.round(rand(3, 15));
    // 미래 시각이 되지 않게
    const atMs = Math.min(baseMs + travel * 60_000, Date.now() - 60_000);
    const scene = makeScene(db.state.r, cam.code, (atMs - db.state.r) / 60_000, pick(COLORS), {
      camId: cam.id,
    });
    scene.id = newId('scene-fake');
    db.state.scenes.push(scene);
    const candidate: DbCandidate = {
      id: newId('cand-fake'),
      case_id: caseId,
      scene_id: scene.id,
      status: 'PENDING',
      variants: {
        [anchor]: {
          similarity: Math.round(rand(0.55, 0.82) * 100) / 100,
          reasons: randomReasons(travel),
          out_of_filter: false,
          travel_minutes: travel,
          expected_minutes: Math.max(1, travel - 1),
        },
      },
      pinned: false,
    };
    db.state.candidates.push(candidate);
  }
}
