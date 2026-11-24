// 관리자 데이터: 녹화 영상 15개, 이용 기록 약 20건 (docs/mock-scenario.md "관리자 데이터")
import type { AuditAction, Video } from '@/mocks/db/legacyTypes';
import { atR } from '@/mocks/db/time';
import type { DbAuditLog } from '@/mocks/db/schema';
import { cameraId } from '@/mocks/scenario/map';

export function createVideos(r: number): Video[] {
  const DAY = 24 * 60;
  const v = (
    code: string,
    file: string,
    status: Video['status'],
    progress: number,
    extra: Partial<Video> = {},
  ): Video => ({
    id: `video-${code.toLowerCase()}-${file.includes('0900') ? 'main' : file.split('_')[1]}`,
    camera_id: cameraId(code),
    camera_code: code,
    file_name: file,
    recorded_at: atR(r, -6 * 60),
    duration_sec: status === 'DONE' ? 7200 : null,
    status,
    progress,
    error_message: null,
    task_id: null,
    case_id: null,
    uploaded_at: atR(r, -2 * DAY),
    ...extra,
  });
  // C3·C4·C2의 1019_0900 영상은 각각 진행 중 62% / 대기 / 실패. 장면은 1018 영상(완료)에서 나온 것으로 본다
  return [
    v('C2', 'C2_1019_0900.mp4', 'FAILED', 35, {
      id: 'video-c2-1019',
      error_message: '프레임 디코딩 실패',
    }),
    v('C3', 'C3_1019_0900.mp4', 'PROCESSING', 62, {
      id: 'video-c3-1019',
      uploaded_at: atR(r, -30),
    }),
    v('C4', 'C4_1019_0900.mp4', 'WAITING', 0, { id: 'video-c4-1019', uploaded_at: atR(r, -25) }),
    ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'].map((code) =>
      v(code, `${code}_1018_0900.mp4`, 'DONE', 100, { id: `video-${code.toLowerCase()}-main` }),
    ),
    v('C1', 'C1_1017_1400.mp4', 'DONE', 100, {
      id: 'video-c1-1017',
      recorded_at: atR(r, -2 * DAY),
      uploaded_at: atR(r, -3 * DAY),
    }),
  ];
}

export function createAuditLogs(
  r: number,
  users: { admin: string; user1: string; user2: string },
  cases: { main: string; second: string },
): DbAuditLog[] {
  const rows: [number, string, AuditAction, string, string | null][] = [
    [-2 * 24 * 60, users.admin, 'LOGIN', '로그인', null],
    [-2 * 24 * 60 + 5, users.admin, 'ACCOUNT_CHANGE', '계정 생성 user2 (이수색, 사용자)', null],
    [-2 * 24 * 60 + 8, users.admin, 'VIDEO_UPLOAD', '녹화 영상 등록 C1_1017_1400.mp4', null],
    [-24 * 60, users.admin, 'SETTINGS_CHANGE', '유사도 기준 기본값 0.65 → 0.60', null],
    [-150, users.user1, 'LOGIN', '로그인', null],
    [-140, users.user1, 'CASE_CREATE', '사건 등록 2026-032', cases.second],
    [-78, users.user1, 'LOGIN', '로그인', null],
    [-75, users.user1, 'CASE_CREATE', '사건 등록 2026-031', cases.main],
    [-74, users.user1, 'SEARCH', '후보 검색 (유사도 기준 0.60)', cases.main],
    [-60, users.user1, 'DECISION', 'C1 확정', cases.main],
    [-58, users.user1, 'VIDEO_VIEW', 'C10 장면 열람', cases.main],
    [-55, users.user1, 'DECISION', 'C10 제외', cases.main],
    [-50, users.user1, 'DECISION', 'C2 확정', cases.main],
    [-49, users.user1, 'REVERT', 'C2 확정 번복', cases.main],
    [-48, users.user1, 'DECISION', 'C2 확정', cases.main],
    [-40, users.user2, 'LOGIN', '로그인', null],
    [-35, users.user2, 'VIDEO_VIEW', 'C3 장면 열람', cases.main],
    [-30, users.user2, 'DECISION', 'C3 확정', cases.main],
    [-30, users.admin, 'VIDEO_UPLOAD', '녹화 영상 등록 C3_1019_0900.mp4', null],
    [-25, users.admin, 'VIDEO_UPLOAD', '녹화 영상 등록 C4_1019_0900.mp4', null],
  ];
  return rows
    .map(([m, user, action, detail, caseId], i) => ({
      id: `log-seed-${i}`,
      at: atR(r, m),
      user_id: user,
      action,
      case_id: caseId,
      detail,
    }))
    .reverse();
}
