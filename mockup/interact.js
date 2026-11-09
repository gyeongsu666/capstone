/* =====================================================================
   ReFind 동작(인터랙션) 공통 모듈
   서버 없이 브라우저 localStorage로 화면 사이 사건 진행 상태를 공유한다.
   shell.js 다음에 불러온다.
   ===================================================================== */

/* ---------- 토스트 ---------- */
function toast(msg, kind = 'ok', ms = 2600) {
  const ic = { ok: ICON.check, info: ICON.info, warn: ICON.warn, err: ICON.x }[kind] || ICON.info;
  const col = { ok: 'var(--acc)', info: 'var(--acc)', warn: 'var(--mid)', err: '#F87171' }[kind];
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div'); box.id = 'toasts';
    box.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:100;align-items:center';
    document.body.appendChild(box);
  }
  const t = document.createElement('div'); t.className = 'toast'; t.style.position = 'static';
  t.innerHTML = ic.replace('<svg', `<svg style="color:${col}"`) + `<span>${msg}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- 사건 진행 상태 ---------- */
const STORE_KEY = 'refind-ws-v1';   // v2(지도 중심) 시안 전용 저장소 — 기존 시안과 섞이지 않음
const DEMO_DEFAULT = () => ({
  case: { no: 'RF-1108-04', type: '아동', last: '14:30', place: '중앙도서관 북문', memo: '빨간 점퍼, 청바지, 노란 운동화, 키 약 120cm' },
  // 신고 지점: 보호자 신고 내용(영상 아님). acc = 정확함 | 근처 | 모름, tol = 시각 오차(분)
  report: { cam: '07', t: '14:30', acc: '근처', tol: 10 },
  // 확정 장면: 시스템이 찾은 후보를 담당자가 확인한 CCTV 장면만 들어간다
  confirmed: [{ cam: '12', t: '14:22:40', score: 90.5 }, { cam: '07', t: '14:30:12', score: 91.0 }, { cam: '09', t: '14:36:05', score: 88.4 }, { cam: '15', t: '14:41:22', score: 91.3 }],
  absent: [{ cam: '10', t: '14:37–14:45' }],
  temp: [{ cam: '16', t: '14:44:50', score: 88.1 }],
  done: { report: true, 'next:07': true, 'prev:07': true, 'next:09': true },
  threshold: 70,
  now: '14:53',
  alerts: [{ cam: '13', t: '14:52:41', score: 92.4 }],
  pending: [{ cam: '17', t: '14:51:10', score: 76.3 }, { cam: '19', t: '14:49:55', score: 71.8 }],
  unread: 7,
  closed: null,
});
const FRESH_CASE = () => ({
  ...DEMO_DEFAULT(), confirmed: [], absent: [], temp: [], done: {},
  unread: 3,   // 실시간 감시 알림(CAM-13 등)은 시연을 위해 그대로 둔다
});
const Store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || DEMO_DEFAULT(); } catch (e) { return DEMO_DEFAULT(); } },
  set(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); },
  reset(fresh) { this.set(fresh ? FRESH_CASE() : DEMO_DEFAULT()); },
};
const byTime = (a, b) => a.t.localeCompare(b.t);
const toSec = (t) => { const [h, m, s = 0] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const fmtDur = (sec) => `${Math.floor(sec / 60)}분 ${String(Math.round(sec % 60)).padStart(2, '0')}초`;
function setUnread(n) { const e = document.getElementById('unread'); if (e) { e.textContent = n; e.style.display = n ? '' : 'none'; } }
function caseTop(s, extra = {}) {
  return { case: s.case.no, meta: `${s.case.type} · 신고: ${s.report.t} ${s.report.acc === '모름' ? '장소 모름' : CAM[s.report.cam][3] + (s.report.acc === '근처' ? ' 근처' : '')}`, clock: s.now, unread: s.unread,
    badge: s.closed ? '<span class="bdg gray">종결</span>' : '<span class="bdg ok">진행 중</span>', ...extra };
}

/* ---------- 후보 데이터 (검색 구간별) ----------
   [카메라, 등장, 퇴장, 유사도, 진입, 이탈, 경로 불일치 사유, 실루엣 키] */
const LOOK = {
  T: TARGET,
  a: ['#A94F48', '#3B4A5E', { child: true }], b: ['#B05A46', '#44546B', { child: true, shoe: '#C4A43A' }],
  c: ['#9C4B4B', '#2F3B4A'], d: ['#B3584E', '#3D4F66', { child: true }], e: ['#B85C52', '#41526A'],
  f: ['#8E5A50', '#3A4658', { child: true }],
};
const CANDS = {
  // 신고 지점·시각(±오차) 기준 첫 검색: 담당자가 CCTV를 보기 전에 시스템이 먼저 찾는다
  'report': [['07', '14:30:12', '14:30:41', 91.0, '남', '동', null, 'T'], ['08', '14:31:40', '14:31:58', 81.2, '북', '남', '방향 불일치 · 신고 지점에서 반대 방향으로 이동', 'a'], ['24', '14:33:15', '14:33:30', 76.0, '동', '서', null, 'c'], ['04', '14:26:11', '14:26:30', 72.3, '남', '북', null, 'b']],
  'next:07': [['09', '14:36:05', '14:36:29', 88.4, '남서', '북동', null, 'T'], ['08', '14:31:40', '14:31:58', 81.2, '북', '남', '방향 불일치 · 북문으로 나간 뒤 남측으로 재진입', 'a'], ['24', '14:33:15', '14:33:30', 76.0, '동', '서', null, 'c']],
  'prev:07': [['12', '14:22:40', '14:22:48', 90.5, '서', '북', null, 'T'], ['04', '14:26:11', '14:26:30', 79.3, '남', '북', null, 'b']],
  'next:09': [['15', '14:41:22', '14:41:48', 91.3, '남', '북', null, 'T'], ['14', '14:43:10', '14:43:31', 86.7, '동', '서', null, 'a'], ['11', '14:38:02', '14:38:20', 82.4, '북', '남', null, 'b'],
    ['19', '14:39:47', '14:40:05', 77.9, '남', '동', null, 'c'], ['10', '14:37:15', '14:37:40', 79.8, '북', '남', '이동 시간 불일치 · 1분 10초 만에 도착 불가', 'd'], ['17', '14:47:33', '14:47:58', 74.5, '서', '동', '방향 불일치 · 진입 방향이 이전 이탈과 반대', 'e']],
  'next:15': [['16', '14:44:50', '14:45:02', 88.1, '남서', '북동', null, 'T'], ['19', '14:43:02', '14:43:20', 72.4, '동', '서', '방향 불일치 · 북쪽으로 이탈했는데 서쪽에서 진입', 'c'], ['13', '14:47:10', '14:47:31', 71.0, '북', '남', '이동 시간 불일치 · 5분 48초 만에 도착 어려움', 'f']],
  'prev:12': [['05', '14:18:31', '14:18:50', 84.2, '남', '동', null, 'T'], ['06', '14:17:02', '14:17:15', 73.9, '서', '동', null, 'f']],
};
/* 확정 장면이 하나도 없으면 신고 지점이 검색 기준이 된다 */
function reportScene(s) { return { cam: s.report.cam, t: s.report.t + ':00', report: true }; }
function candidatesFor(key) {
  return (CANDS[key] || []).map(([cam, t, t2, score, inn, out, why, look]) => ({ cam, t, t2, score, inn, out, why, look: LOOK[look], name: CAM[cam][3] }));
}

/* ---------- 도보 길 네트워크 최단 경로 ---------- */
const CAMNODE = { '01': 'G', '02': 'A1', '03': 'F', '04': 'F', '05': 'S', '06': 'S', '07': 'L', '08': 'R1', '09': 'H', '10': 'W', '11': 'E', '12': 'S', '13': 'N3', '14': 'GY', '15': 'D',
  '16': 'D2', '17': 'BU', '18': 'N4', '19': 'N2', '20': 'E2', '21': 'G', '22': 'G', '23': 'N1', '24': 'N1' };
const ADJ = (() => {
  const a = {};
  EDGE.forEach(([x, y]) => { const d = Math.hypot(NODE[x][0] - NODE[y][0], NODE[x][1] - NODE[y][1]); (a[x] = a[x] || []).push([y, d]); (a[y] = a[y] || []).push([x, d]); });
  return a;
})();
function dijkstra(src) {
  const dist = {}, prev = {}, left = new Set(Object.keys(NODE));
  Object.keys(NODE).forEach(k => dist[k] = Infinity); dist[src] = 0;
  while (left.size) {
    let u = null; left.forEach(k => { if (u === null || dist[k] < dist[u]) u = k; }); left.delete(u);
    (ADJ[u] || []).forEach(([v, w]) => { if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; } });
  }
  return { dist, prev };
}
function camPath(c1, c2) {
  const a = CAMNODE[c1], b = CAMNODE[c2], { dist, prev } = dijkstra(a), ns = [b];
  while (ns[0] !== a && prev[ns[0]]) ns.unshift(prev[ns[0]]);
  const pts = [[CAM[c1][0], CAM[c1][1]], ...ns.map(n => NODE[n]), [CAM[c2][0], CAM[c2][1]]];
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { pts, len };
}
const PX2M = 0.62;                // 시안 지도 1px ≈ 0.62m
const ptsStr = (pts) => pts.map(p => p.join(',')).join(' ');
function inPoly(x, y, poly) {
  const p = poly.split(' ').map(s => s.split(',').map(Number)); let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (((p[i][1] > y) !== (p[j][1] > y)) && (x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) c = !c;
  }
  return c;
}

/* ---------- 슬라이더 드래그 (0~1 값을 onChange로) ---------- */
function bindSlider(el, onChange, onEnd) {
  const tr = el.querySelector('.tr');
  const set = (e) => { const r = tr.getBoundingClientRect(); onChange(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); };
  el.style.cursor = 'pointer';
  el.addEventListener('pointerdown', (e) => { set(e); el.setPointerCapture(e.pointerId); el.onpointermove = set; });
  el.addEventListener('pointerup', () => { el.onpointermove = null; onEnd && onEnd(); });
}
function setSlider(el, v) { el.querySelector('.tr i').style.width = v * 100 + '%'; el.querySelector('.kn').style.left = v * 100 + '%'; }

/* ---------- 지도 확대·축소·드래그 ----------
   box: .mapbox 요소, view: {x, y, w} 상태 객체(다시 그려도 유지). 지도 좌표계는 1200×800.
   드래그 직후의 클릭은 view.moved = true 로 알려 주므로 클릭 처리 쪽에서 무시하면 된다. */
function enablePanZoom(box, view) {
  const svg = box.querySelector('svg'), W = 1200, H = 800, MIN = 220;
  const fix = () => { view.w = Math.min(W, Math.max(MIN, view.w)); const h = view.w * H / W;
    view.x = Math.min(W - view.w * .4, Math.max(-view.w * .6, view.x)); view.y = Math.min(H - h * .4, Math.max(-h * .6, view.y)); };
  const apply = () => { fix(); svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.w * H / W}`); view.onChange && view.onChange(); };
  const toMap = (cx, cy) => { const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  const zoomAt = (f, px, py) => { const nw = Math.min(W, Math.max(MIN, view.w * f)), k = nw / view.w;
    view.x = px - (px - view.x) * k; view.y = py - (py - view.y) * k; view.w = nw; apply(); };
  apply();
  svg.style.cursor = 'grab'; svg.style.touchAction = 'none';
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = toMap(e.clientX, e.clientY); zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, { passive: false });
  let d = null;
  svg.addEventListener('pointerdown', (e) => { d = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y, id: e.pointerId }; view.moved = false; });
  svg.addEventListener('pointermove', (e) => {
    if (!d) return;
    if (!view.moved && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 5) { view.moved = true; svg.setPointerCapture(d.id); svg.style.cursor = 'grabbing'; }
    if (!view.moved) return;
    const m = svg.getScreenCTM(); view.x = d.x - (e.clientX - d.sx) / m.a; view.y = d.y - (e.clientY - d.sy) / m.d; apply();
  });
  const end = () => { d = null; svg.style.cursor = 'grab'; };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  // 확대/축소/전체 보기 버튼
  const z = document.createElement('div'); z.className = 'zoom'; z.style.cssText = 'right:8px;top:8px;bottom:auto';
  z.innerHTML = '<span data-z="in" title="확대" style="cursor:pointer">+</span><span data-z="out" title="축소" style="cursor:pointer">−</span><span data-z="all" title="전체 보기" style="cursor:pointer;font-size:13px">⤢</span>';
  z.onclick = (e) => { const t = e.target.closest('[data-z]'); if (!t) return; const cx = view.x + view.w / 2, cy = view.y + view.w * H / W / 2;
    if (t.dataset.z === 'all') { view.x = 0; view.y = 0; view.w = W; apply(); } else zoomAt(t.dataset.z === 'in' ? 1 / 1.4 : 1.4, cx, cy); };
  box.appendChild(z);
}

/* ---------- 영상 플레이어 재생 버튼 (이벤트 위임) ---------- */
const PAUSE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/></svg>';
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pb-play'); if (!btn) return;
  const pb = btn.closest('.pb');
  if (pb._timer) { clearInterval(pb._timer); pb._timer = null; btn.innerHTML = ICON.play.replace('<svg', '<svg width="14" height="14"'); return; }
  let pos = +pb.dataset.pos; if (pos >= 100) pos = 0;
  btn.innerHTML = PAUSE_SVG;
  pb._timer = setInterval(() => {
    pos = Math.min(100, pos + 1.2); pb.dataset.pos = pos;
    pb.querySelector('.pb-fill').style.width = pos + '%'; pb.querySelector('.pb-kn').style.left = pos + '%';
    if (pos >= 100) { clearInterval(pb._timer); pb._timer = null; btn.innerHTML = ICON.play.replace('<svg', '<svg width="14" height="14"'); }
  }, 80);
});
