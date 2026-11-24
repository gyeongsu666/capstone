import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePendingCount } from '@/api/search';
import { playAlertSound, showBrowserNotification } from '@/utils/alertSignals';

/**
 * 미처리 출현 알림 수(R2 pending-count)를 모든 화면에서 폴링하고, 새 알림이 생기면 알림음 + 브라우저 알림.
 * 사이드바 숫자 배지에 쓸 값을 돌려준다.
 */
export function useAlertNotifier() {
  const navigate = useNavigate();
  const { data } = usePendingCount();
  const prev = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    if (!data) return;
    const now = new Map(data.byCase.map((x) => [x.caseId, x.count]));
    // 처음 받은 값은 기준으로만 쓴다(화면을 열자마자 소리가 나지 않게)
    if (prev.current) {
      for (const [caseId, count] of now) {
        if (count > (prev.current.get(caseId) ?? 0)) {
          playAlertSound();
          showBrowserNotification(
            '실시간 출현 알림',
            '실종자로 보이는 사람이 나타났어요. 눌러서 확인하세요.',
            () => navigate(`/cases/${caseId}/search-area`),
          );
          break;
        }
      }
    }
    prev.current = now;
  }, [data, navigate]);

  return data;
}
