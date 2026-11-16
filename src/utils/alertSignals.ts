// 출현 알림 신호: 알림음(Web Audio, 파일 없이) + 브라우저 알림

let audioCtx: AudioContext | null = null;

/** 짧은 두 음 알림음. 브라우저가 소리를 막으면 조용히 넘어간다 */
export function playAlertSound() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.22;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.21);
    });
  } catch {
    // 소리 재생 불가
  }
}

export const notificationSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

/** 브라우저 알림 권한 요청. 사용자 동작(예: 실시간 감시 시작 버튼) 안에서 부른다 */
export async function requestNotificationPermission() {
  if (!notificationSupported() || Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    // 무시
  }
}

/** 브라우저 알림. 누르면 창을 앞으로 가져오고 onClick 실행 */
export function showBrowserNotification(title: string, body: string, onClick?: () => void) {
  if (!notificationSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: 'refind-alert' });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // 무시
  }
}
