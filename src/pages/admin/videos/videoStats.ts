import type { VideoView } from '@/api/view';

/** 카메라별 영상 상태 요약 */
export interface CameraVideoStats {
  total: number;
  done: number;
  processing: number;
  waiting: number;
  failed: number;
}

export function statsByCamera(videos: VideoView[]): Record<string, CameraVideoStats> {
  const out: Record<string, CameraVideoStats> = {};
  for (const v of videos) {
    const s = (out[v.cameraId] ??= { total: 0, done: 0, processing: 0, waiting: 0, failed: 0 });
    s.total += 1;
    s[v.status === 'done' ? 'done' : v.status] += 1;
  }
  return out;
}
