/* ReFind 화면 시안 공통 모듈: 사이드바·상단바·캠퍼스 지도·인물/영상 플레이스홀더 */

const Q = new URLSearchParams(location.search);

/* ---------- 화면 비율 맞춤: 1440×900 화면을 창 크기에 맞게 비율 유지로 확대·축소 ---------- */
window.__scale = 1;
function fitScreen() {
  // 높이 900 기준으로 배율을 정하고, 가로는 창 너비만큼 늘려 빈 여백 없이 채운다 (최소 가로 1280)
  const b = document.body; if (!b) return;
  let s = innerHeight / 900;
  if (innerWidth / s < 1280) s = innerWidth / 1280;
  window.__scale = s;
  b.style.width = innerWidth / s + 'px'; b.style.height = innerHeight / s + 'px';
  b.style.transform = `scale(${s})`;
}
addEventListener('DOMContentLoaded', fitScreen); addEventListener('resize', fitScreen); addEventListener('load', fitScreen);

/* ---------- 아이콘 (stroke) ---------- */
const I = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICON = {
  map: I('<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>'),
  video: I('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
  dash: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  folder: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  route: I('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>'),
  target: I('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  bell: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  cam: I('<path d="M4 8h10l4-3v14l-4-3H4z"/>'),
  poly: I('<path d="M5 6 18 4l2 11-9 5-7-6z"/><circle cx="5" cy="6" r="1.4" fill="currentColor"/><circle cx="18" cy="4" r="1.4" fill="currentColor"/><circle cx="20" cy="15" r="1.4" fill="currentColor"/>'),
  cursor: I('<path d="m5 3 14 7-6 2-2 6z"/>'),
  trash: I('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  check: I('<path d="m5 12 4.5 4.5L19 7"/>'),
  x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  warn: I('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  play: I('<path d="M7 5v14l12-7z" fill="currentColor"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  refresh: I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  clock: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  arrowR: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  arrowL: I('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  chev: I('<path d="m9 6 6 6-6 6"/>'),
  eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  flag: I('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  pin: I('<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>'),
  shield: I('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
};

/* ---------- 사이드바 + 상단바 ---------- */
const NAV = [
  ['환경 설정', [['camera', '지도·카메라 배치', 'map', '02_camera.html'], ['video', '영상 등록', 'video', '03_video.html']]],
  ['수색', [
    ['cases', '사건 목록', 'dash', '01_cases.html'],
    ['case', '사건 등록', 'folder', '04_case_new.html'],
    ['ws', '사건 수색', 'target', '05_workspace.html'],
  ]],
];

function shell(active, top = {}) {
  const side = document.querySelector('.side');
  side.innerHTML = `
    <div class="logo"><i></i>ReFind</div>
    <div class="org"><b>대학 캠퍼스 수색</b><span>실종자 동선 추적 시스템</span></div>
    ${NAV.map(([g, items]) => `<div class="grp">${g}</div>` +
      items.map(([k, label, ic, href]) => `<a class="nav ${k === active ? 'on' : ''}" href="${href}">${ICON[ic]}${label}</a>`).join('')).join('')}
    <div class="foot"><b>담당자 &nbsp;김수현</b><span>단일 담당자 관제 환경</span><a href="00_시안목록.html" style="display:block;margin-top:8px;font-size:11px;color:var(--mute)">시안 목록 · 시연 데이터 초기화</a></div>`;

  const t = document.querySelector('.top');
  const caseHtml = top.case
    ? `<span class="case">${top.case}</span><span class="sep"></span><span class="meta">${top.meta || ''}</span>${top.badge || '<span class="bdg ok">진행 중</span>'}`
    : `<span class="case">${top.title || '전체 사건'}</span><span class="sep"></span><span class="meta">${top.meta || '선택된 사건 없음'}</span>`;
  t.innerHTML = `${caseHtml}
    <div class="right">
      <span><i class="dot"></i>실시간 처리 지연 <b class="num" style="color:var(--txt)">${top.delay || '2.4'}초</b></span>
      <span class="num">2026.11.08 ${top.clock || '14:53'}</span>
      <span class="bell">${ICON.bell.replace('<svg', '<svg width="16" height="16"')}미확인 <em id="unread">${top.unread ?? 7}</em></span>
    </div>`;
}

/* ---------- 캠퍼스 지도 데이터 (viewBox 0 0 1200 800) ---------- */
const CAM = {
  '01': [600, 702, -90, '정문'], '02': [548, 668, -60, '본관 남측'], '03': [648, 506, -120, '분수대 광장'],
  '04': [552, 486, -30, '분수대 서측'], '05': [338, 536, -90, '학생회관 정문'], '06': [248, 470, 0, '학생회관 서측'],
  '07': [606, 312, -90, '중앙도서관 북문'], '08': [606, 452, 90, '중앙도서관 남측'], '09': [748, 306, 0, '인문관 앞'],
  '10': [482, 594, -90, '본관 서측'], '11': [812, 504, -90, '공학관 보행로'], '12': [432, 462, 0, '학생회관 동측'],
  '13': [1012, 472, -90, '공학관 동측'], '14': [168, 268, -90, '체육관 서측'], '15': [896, 206, -90, '생활관 입구'],
  '16': [996, 92, -40, '생활관 뒤 산책로'], '17': [1074, 684, -150, '버스정류장'], '18': [262, 334, -60, '체육관 남측'],
  '19': [832, 196, 180, '인문관 북측'], '20': [902, 566, 180, '공학관 남측'], '21': [764, 716, -120, '정문 동측'],
  '22': [440, 716, -60, '정문 서측'], '23': [470, 224, -90, '공사장 인근'], '24': [500, 382, 0, '도서관 서측'],
};
const NODE = {
  G: [600, 722], A1: [600, 626], W: [482, 610], F: [600, 488], S: [432, 476], M: [700, 420], L: [606, 300],
  H: [750, 296], E: [812, 488], D: [896, 192], D2: [996, 82], GY: [168, 262], BU: [1074, 700], N1: [432, 300],
  N2: [830, 186], N3: [1012, 488], N4: [262, 262], R1: [600, 452], T1: [1130, 34], E2: [902, 580],
};
const EDGE = [['G','A1'],['A1','W'],['A1','F'],['F','R1'],['F','S'],['F','E'],['R1','M'],['M','H'],['L','H'],['L','N1'],
  ['N1','S'],['N1','N4'],['N4','GY'],['H','N2'],['N2','D'],['D','D2'],['E','N3'],['N3','D'],['N3','BU'],['G','BU'],
  ['W','S'],['E','H'],['E','E2'],['E2','BU'],['D2','T1'],['R1','L']];
const DANGER = {
  construct: { name: '공사장(북측)', pts: '398,108 566,98 576,196 410,206' },
  road: { name: '큰 도로(남측 순환로)', pts: '0,748 1200,748 1200,800 0,800' },
  hill: { name: '뒷산 산책로(북동측)', pts: '1050,0 1200,0 1200,300 1120,250 1060,150' },
};

const P = (n) => NODE[n].join(',');
const routeStr = (ns) => ns.map(P).join(' ');

function camGlyph(id, o = {}) {
  const [x, y, a, name] = CAM[id];
  const r = o.r || 30, f = (o.fov || 60) / 2, rad = (d) => (d * Math.PI) / 180;
  const x1 = x + r * Math.cos(rad(a - f)), y1 = y + r * Math.sin(rad(a - f));
  const x2 = x + r * Math.cos(rad(a + f)), y2 = y + r * Math.sin(rad(a + f));
  const col = o.color || '#89AD99';
  return `<g opacity="${o.dim ? .35 : 1}">
    <path d="M${x} ${y}L${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z" fill="${col}" fill-opacity="${o.sel ? .32 : .16}" stroke="${col}" stroke-opacity="${o.sel ? .9 : .35}" stroke-width="1"/>
    ${o.sel ? `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${col}" stroke-width="2"/>` : ''}
    <circle cx="${x}" cy="${y}" r="5.5" fill="${col}" stroke="#131C18" stroke-width="2"/>
    ${o.label !== false ? `<text x="${x + 9}" y="${y - 8}" font-size="11" fill="${o.sel ? '#DEE7E0' : '#8FA197'}" font-weight="${o.sel ? 700 : 500}">${o.name ? name : 'CAM-' + id}</text>` : ''}
  </g>`;
}

function mapSVG(inner = '', o = {}) {
  const B = [
    ['중앙도서관', 520, 322, 172, 112], ['학생회관', 250, 404, 160, 104], ['공학관', 830, 404, 170, 72],
    ['인문관', 690, 214, 120, 66], ['체육관', 186, 182, 160, 70], ['생활관', 920, 112, 120, 70],
    ['본관', 500, 640, 80, 64], ['', 620, 640, 80, 64], ['공학관 별관', 840, 520, 150, 44], ['', 286, 560, 120, 50],
  ];
  const showCams = o.cams !== false;
  return `<svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid meet" font-family="Pretendard,'Malgun Gothic',sans-serif">
    <defs>
      <pattern id="hatch" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="#EF4444" fill-opacity=".07"/><line x1="0" y1="0" x2="0" y2="10" stroke="#EF4444" stroke-opacity=".55" stroke-width="2.4"/></pattern>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#1C2923" stroke-width="1"/></pattern>
      <radialGradient id="pulse"><stop offset="0" stop-color="#EF4444" stop-opacity=".55"/><stop offset="1" stop-color="#EF4444" stop-opacity="0"/></radialGradient>
      <marker id="arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10z" fill="#DEE7E0"/></marker>
      <marker id="arrA" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10z" fill="#9FD1B4"/></marker>
    </defs>
    <rect width="1200" height="800" fill="#16211C"/><rect width="1200" height="800" fill="url(#grid)"/>
    <path d="M1040 0H1200V320C1150 290 1090 250 1060 170 1040 110 1030 50 1040 0Z" fill="#1A2B21"/>
    <path d="M0 0H140V120C100 150 40 140 0 160Z" fill="#1A2B21"/>
    <circle cx="600" cy="488" r="44" fill="#1B2A23" stroke="#2E4037"/><circle cx="600" cy="488" r="16" fill="#1E3A3A" stroke="#2F5050"/>
    <text x="600" y="548" text-anchor="middle" font-size="11" fill="#6E7F75">분수대 광장</text>
    <rect x="0" y="752" width="1200" height="44" fill="#212D27"/><line x1="0" y1="774" x2="1200" y2="774" stroke="#3A4B41" stroke-dasharray="18 14"/>
    <text x="40" y="790" font-size="11" fill="#6E7F75">남측 순환로 (차도)</text>
    <path d="M600 752V724" stroke="#2C3B33" stroke-width="16"/>
    ${EDGE.map(([a, b]) => `<line x1="${NODE[a][0]}" y1="${NODE[a][1]}" x2="${NODE[b][0]}" y2="${NODE[b][1]}" stroke="#26352D" stroke-width="10" stroke-linecap="round"/>`).join('')}
    ${EDGE.map(([a, b]) => `<line x1="${NODE[a][0]}" y1="${NODE[a][1]}" x2="${NODE[b][0]}" y2="${NODE[b][1]}" stroke="#2F4038" stroke-width="2" stroke-linecap="round"/>`).join('')}
    ${B.map(([n, x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#212E28" stroke="#34463C"/>${n ? `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="12.5" fill="#7F9187" font-weight="600">${n}</text>` : ''}`).join('')}
    <rect x="1040" y="672" width="64" height="20" rx="3" fill="#212E28" stroke="#34463C"/><text x="1072" y="686" text-anchor="middle" font-size="10" fill="#7F9187">버스정류장</text>
    <text x="600" y="744" text-anchor="middle" font-size="12" fill="#8FA197" font-weight="700">정문</text>
    <text x="1130" y="120" text-anchor="middle" font-size="12" fill="#5F7A68" font-weight="600">뒷산</text>
    ${o.danger ? Object.entries(DANGER).map(([k, d]) => `<polygon points="${d.pts}" fill="url(#hatch)" stroke="#EF4444" stroke-opacity=".8" stroke-width="1.5" ${o.dangerSel === k ? 'stroke-width="3"' : ''}/>` +
      (o.dangerLabel !== false ? `<text x="${d.pts.split(' ')[0].split(',')[0] * 1 + (k === 'road' ? 1040 : 12)}" y="${d.pts.split(' ')[0].split(',')[1] * 1 + (k === 'road' ? -8 : 22)}" font-size="11" fill="#F87171" font-weight="700">${d.name}</text>` : '')).join('') : ''}
    ${o.under || ''}
    ${showCams ? Object.keys(CAM).map((id) => camGlyph(id, { label: o.camLabels ?? false, dim: o.dimCams && !(o.keep || []).includes(id), ...(o.camOpt?.[id] || {}) })).join('') : ''}
    ${inner}
  </svg>`;
}

/* ---------- 인물 썸네일 (비식별 실루엣, 옷 색상만) ---------- */
function person(top = '#B4574D', bottom = '#3F5269', o = {}) {
  const bg = o.bg || '#2A3A32';
  return `<svg viewBox="0 0 60 90" preserveAspectRatio="xMidYMid slice">
    <rect width="60" height="90" fill="${bg}"/>
    <rect y="66" width="60" height="24" fill="#24322B"/>
    <circle cx="30" cy="20" r="${o.child ? 8 : 9}" fill="#7C8C83"/>
    <path d="M${o.child ? 19 : 17} 32q13-6 ${o.child ? 22 : 26} 0l3 24h-${o.child ? 28 : 32}z" fill="${top}"/>
    <path d="M${o.child ? 21 : 20} 55h${o.child ? 18 : 20}l-1 26h-7l-2-16-2 16h-7z" fill="${bottom}"/>
    ${o.shoe ? `<rect x="20" y="80" width="8" height="4" rx="1" fill="${o.shoe}"/><rect x="32" y="80" width="8" height="4" rx="1" fill="${o.shoe}"/>` : ''}
  </svg>`;
}
const TARGET = ['#B4574D', '#3F5269', { child: true, shoe: '#D3B23F' }];
const thumb = (w, h, args, tag) => `<div class="thumb" style="width:${w}px;height:${h}px">${person(...args)}${tag ? `<div class="tag">${tag}</div>` : ''}</div>`;

/* ---------- CCTV 프레임 플레이스홀더 ---------- */
function videoSVG(o = {}) {
  const ppl = o.people || [];
  return `<svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%;background:#1B2420">
    <rect width="640" height="360" fill="#1B2420"/>
    <path d="M0 210 640 190V360H0Z" fill="#222D28"/>
    <path d="M120 360 290 196M520 360 360 194M0 290 640 260" stroke="#2C3A33" stroke-width="2"/>
    <rect x="${o.bx ?? 40}" y="40" width="200" height="160" fill="#25312B" stroke="#30403A"/>
    <rect x="${(o.bx ?? 40) + 20}" y="70" width="50" height="40" fill="#2D3B35"/><rect x="${(o.bx ?? 40) + 110}" y="70" width="50" height="40" fill="#2D3B35"/>
    <rect x="430" y="60" width="160" height="134" fill="#23302A" stroke="#30403A"/>
    ${ppl.map((p) => `<g transform="translate(${p.x} ${p.y}) scale(${p.s || 1})">
        <circle cx="0" cy="-58" r="7" fill="#7C8C83"/><path d="M-11 -48q11-5 22 0l3 26h-28z" fill="${p.top}"/>
        <path d="M-9 -22h18l-1 22h-6l-2-13-2 13h-6z" fill="${p.bottom}"/></g>
      ${p.box ? `<rect x="${p.x - 20 * (p.s || 1)}" y="${p.y - 70 * (p.s || 1)}" width="${40 * (p.s || 1)}" height="${74 * (p.s || 1)}" fill="none" stroke="${p.box}" stroke-width="${p.sel ? 2.5 : 1.5}" ${p.sel ? '' : 'stroke-dasharray="4 3"'}/>
        ${p.lab ? `<rect x="${p.x - 20 * (p.s || 1)}" y="${p.y - 70 * (p.s || 1) - 18}" width="${p.lab.length * 7 + 12}" height="16" fill="${p.box}"/><text x="${p.x - 20 * (p.s || 1) + 6}" y="${p.y - 70 * (p.s || 1) - 6}" font-size="10.5" font-weight="700" fill="#131C18">${p.lab}</text>` : ''}` : ''}`).join('')}
    <rect x="10" y="10" width="${(o.cam || 'CAM-07').length * 14 + 175}" height="22" fill="rgba(0,0,0,.55)"/>
    <text x="18" y="25" font-size="12" fill="#E6EEE8" font-family="Consolas,monospace">${o.cam || 'CAM-07'}  ${o.time || '2026-11-08 14:30:12'}</text>
    ${o.live ? `<circle cx="612" cy="21" r="5" fill="#EF4444"/><text x="568" y="25" font-size="11" fill="#E6EEE8" font-weight="700">LIVE</text>` : ''}
  </svg>`;
}

function playerBar(pos = 40, marks = [[30, 52]], t = '00:14 / 00:41') {
  return `<div class="pb" data-pos="${pos}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#141D19;border-top:1px solid var(--line)">
    <span class="pb-play" style="color:var(--txt);display:flex;cursor:pointer">${ICON.play.replace('<svg', '<svg width="14" height="14"')}</span>
    <div style="flex:1;height:5px;background:#2B3A32;border-radius:3px;position:relative">
      ${marks.map(([a, b]) => `<i style="position:absolute;left:${a}%;width:${b - a}%;top:-2px;bottom:-2px;background:rgba(137,173,153,.45);border-radius:2px"></i>`).join('')}
      <i class="pb-fill" style="position:absolute;left:0;width:${pos}%;top:0;bottom:0;background:var(--acc);border-radius:3px"></i>
      <i class="pb-kn" style="position:absolute;left:${pos}%;top:-4px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--txt)"></i>
    </div>
    <span class="cap num">${t}</span><span class="cap">1x</span></div>`;
}
