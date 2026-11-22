// =====================================================================================================================
// หน้าแผนที่: วาดแผนที่ประเทศไทยเป็น SVG (เส้นขอบประมาณจากพิกัดจริง ไม่ได้ใช้ไฟล์ภาพ) ปักหมุดสถานที่จาก PLACES
// เลือกหมุดเพื่อดูรายละเอียด แล้วกด "ไปเที่ยวงานนี้" จะแสดงหน้า loading แล้วไปที่ play.html?loc=<id>
// ด้านหลังมีโคมลอยขึ้นช้าๆ แต่ละใบมีคำอธิษฐาน (ของผู้เล่นจริงจาก Firebase หรือข้อความตัวอย่าง)
// =====================================================================================================================
(async () => {
const $ = (id) => document.getElementById(id);
const LD = Loader('loading');
await LD.step('กำลังโหลดตัวอักษร', 15);

// ---------------------------------------------------------------------------------------------- projection
// ลองจิจูด/ละติจูด เป็นพิกัดใน SVG: 1 องศา = S หน่วย (ใกล้เส้นศูนย์สูตร ใช้แบบตรงๆ ได้)
const S = 40, LON0 = 96.9, LAT0 = 20.85;
const px = (lon, lat) => [(lon - LON0) * S, (LAT0 - lat) * S];
// เส้นขอบประเทศ (ลองจิจูด, ละติจูด) ตามเข็มนาฬิกาจากแม่สาย
const BORDER = [
  [99.88, 20.43], [100.09, 20.35], [100.4, 20.27], [100.52, 20.05], [100.55, 19.55], [100.95, 19.6], [101.25, 19.55], [101.2, 19.1], [101.3, 18.7], [101.05, 18.35],
  [101.15, 17.9], [101.55, 17.75], [101.75, 17.95], [102.1, 18.2], [102.6, 17.95], [103.05, 17.98], [103.35, 18.35], [103.7, 18.38], [104.0, 18.1], [104.45, 17.65],
  [104.8, 17.35], [104.75, 16.9], [104.75, 16.45], [105.05, 16.1], [105.4, 15.95], [105.6, 15.6], [105.5, 15.2], [105.6, 14.95], [105.2, 14.35], [104.7, 14.4],
  [104.1, 14.38], [103.6, 14.42], [103.1, 14.3], [102.7, 14.05], [102.55, 13.7], [102.4, 13.4], [102.35, 12.95], [102.6, 12.6], [102.78, 12.3], [102.95, 11.95],
  [102.92, 11.62], [102.7, 12.05], [102.45, 12.2], [102.2, 12.45], [101.9, 12.65], [101.45, 12.65], [101.1, 12.68], [100.9, 12.65], [100.88, 13.0], [100.95, 13.35],
  [100.85, 13.5], [100.55, 13.5], [100.25, 13.45], [100.0, 13.35], [99.98, 13.0], [99.95, 12.6], [99.85, 12.15], [99.75, 11.75], [99.55, 11.3], [99.4, 10.9],
  [99.2, 10.5], [99.15, 10.05], [99.25, 9.6], [99.4, 9.25], [99.85, 9.25], [100.05, 8.95], [100.1, 8.45], [100.3, 8.0], [100.45, 7.55], [100.6, 7.15],
  [100.95, 6.9], [101.3, 6.88], [101.65, 6.65], [102.1, 6.25], [101.8, 5.85], [101.55, 5.8], [101.15, 5.65], [101.05, 6.1], [100.75, 6.45], [100.35, 6.55],
  [100.15, 6.7], [99.7, 7.1], [99.4, 7.5], [99.1, 7.9], [98.8, 8.1], [98.6, 8.35], [98.4, 8.3], [98.28, 8.6], [98.25, 9.0], [98.45, 9.55],
  [98.55, 9.95], [98.7, 10.35], [98.95, 10.75], [99.25, 11.2], [99.55, 11.7], [99.35, 12.2], [99.15, 12.7], [99.15, 13.2], [98.85, 13.65], [98.55, 14.1],
  [98.25, 14.6], [98.35, 15.1], [98.55, 15.4], [98.55, 15.95], [98.75, 16.35], [98.55, 16.75], [98.2, 17.2], [97.85, 17.65], [97.7, 18.2], [97.4, 18.55],
  [97.35, 19.0], [97.75, 19.45], [97.85, 19.85], [98.2, 19.75], [98.6, 19.7], [99.0, 19.9], [99.3, 20.1], [99.55, 20.15],
];
const RIVERS = [
  [[98.95, 19.3], [98.99, 18.79], [98.95, 18.3], [99.05, 17.6], [99.5, 16.9], [99.85, 16.2], [100.12, 15.7]],                  // ปิง
  [[100.05, 18.9], [100.0, 18.0], [99.82, 17.05], [100.0, 16.4], [100.12, 15.7]],                                                 // ยม
  [[100.12, 15.7], [100.2, 15.1], [100.55, 14.4], [100.55, 14.0], [100.5, 13.75], [100.58, 13.52]],                               // เจ้าพระยา
];
const ISLES = [[98.35, 7.95, 0.1, 0.24], [100.03, 9.5, 0.13, 0.12], [102.35, 12.05, 0.07, 0.15], [99.05, 7.6, 0.06, 0.08]];
// เส้นโค้งผ่านทุกจุด (Catmull-Rom เป็น Bezier): ขอบแผนที่จึงนุ่มนวลกว่าเส้นตรงต่อกัน
function smooth(pts, closed) {
  const P = pts.map((p) => px(p[0], p[1])), n = P.length, at = (i) => P[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), k = 1 / 6;
    d += `C${(p1[0] + (p2[0] - p0[0]) * k).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * k).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * k).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * k).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + (closed ? 'Z' : '');
}
const svg = $('map'), NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
// แผนที่แบบเกมมือถือ: โลกใหญ่กว่าจอ ลากหรือเลื่อนดูได้ แผ่นดินนูนหนามีขอบผา ชายฝั่งน้ำตื้นและฟองคลื่น ภูเขาลูกกลม ต้นไม้ นาข้าว
// เมฆฟูล้อมขอบ เรือแล่น หมุดสถานที่เป็นป้ายวงกลมใหญ่ที่เด้งลอยขึ้นมาจากพื้น (หมุดเป็น HTML วางในพิกัดเดียวกับแผนที่)
const BX0 = -420, BY0 = -120, BW = 1210, BH = 880;
svg.setAttribute('viewBox', `${BX0} ${BY0} ${BW} ${BH}`);
const defs = el('defs', {});
const grad = (id, stops, x2 = 0, y2 = 1) => { const g = el('linearGradient', { id, x1: 0, y1: 0, x2, y2 }, defs); stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g)); };
const rgrad = (id, stops, cx = '45%', cy = '40%', r = '75%') => { const g = el('radialGradient', { id, cx, cy, r }, defs); stops.forEach(([o, c, a = 1]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, g)); };
rgrad('seaG', [[0, '#1b5a78'], [0.6, '#123e5c'], [1, '#0a2640']]);
grad('landG', [[0, '#7da35a'], [0.55, '#638c47'], [1, '#4f7639']]);
grad('cliffG', [[0, '#7a5a3a'], [1, '#4a3420']]);
grad('ridgeL', [[0, '#9bbd78'], [1, '#5f8a45']]); grad('ridgeD', [[0, '#4d7337'], [1, '#3a5a2a']]);
rgrad('glowG', [[0, '#ffd27a', 0.75], [0.4, '#ffb347', 0.28], [1, '#ff9a3c', 0]], '50%', '50%', '50%');
rgrad('moonG', [[0, '#fff3d0', 0.2], [1, '#fff3d0', 0]], '62%', '25%', '60%');
// a fine grain over the land, so that it reads as ground and not as a flat colour
const tex = el('filter', { id: 'grain', x: 0, y: 0, width: '100%', height: '100%' }, defs);
el('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.035, numOctaves: 3, seed: 7, result: 'n' }, tex);
el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 -.12', result: 'a' }, tex);
el('feComposite', { in: 'a', in2: 'SourceGraphic', operator: 'in', result: 'g' }, tex);
el('feBlend', { in: 'SourceGraphic', in2: 'g', mode: 'multiply' }, tex);
const soft = el('filter', { id: 'soft', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs); el('feGaussianBlur', { stdDeviation: 9 }, soft);
const R = (a, b) => a + Math.random() * (b - a);
const g = (cls) => el('g', cls ? { class: cls } : {});
// the sea at night: deep blue, a faint path of moonlight, slow ripples
el('rect', { x: BX0, y: BY0, width: BW, height: BH, fill: 'url(#seaG)' });
el('rect', { x: BX0, y: BY0, width: BW, height: BH, fill: 'url(#moonG)' });
{ const w = g('waves'); for (let i = 0; i < 80; i++) { const x = R(BX0 + 20, BX0 + BW - 20), y = R(BY0 + 20, BY0 + BH - 20); el('path', { d: `M${x},${y} q4 -3 8 0 t8 0`, fill: 'none', stroke: 'rgba(200,230,255,.18)', 'stroke-width': 1.4, 'stroke-linecap': 'round', style: `animation-delay:${R(0, 4).toFixed(2)}s` }, w); } }
const land = smooth(BORDER, true);
// shallows round the coast, a thin line of surf, the land with a low dark edge under it, its grain, a pale rim where the moon catches it
el('path', { d: land, fill: 'none', stroke: 'rgba(70,160,180,.28)', 'stroke-width': 34, 'stroke-linejoin': 'round' });
el('path', { d: land, fill: 'none', stroke: 'rgba(220,240,255,.35)', 'stroke-width': 7, 'stroke-linejoin': 'round', 'stroke-dasharray': '1 9', 'stroke-linecap': 'round', class: 'foam' });
el('path', { d: land, fill: 'url(#cliffG)', transform: 'translate(0 7)' });
el('path', { d: land, fill: 'url(#landG)', stroke: '#2f4626', 'stroke-width': 1.4, 'stroke-linejoin': 'round', filter: 'url(#grain)' });
el('path', { d: land, fill: 'none', stroke: 'rgba(230,245,200,.22)', 'stroke-width': 2, 'stroke-linejoin': 'round', transform: 'translate(-1 -1)' });
for (const [lon, lat, rx, ry] of ISLES) { const [x, y] = px(lon, lat); el('ellipse', { cx: x, cy: y, rx: rx * S + 9, ry: ry * S + 9, fill: 'rgba(70,160,180,.28)' }); el('ellipse', { cx: x, cy: y + 3, rx: rx * S + 2, ry: ry * S + 2, fill: '#4a3420' }); el('ellipse', { cx: x, cy: y, rx: rx * S + 2, ry: ry * S + 2, fill: 'url(#landG)', stroke: '#2f4626', 'stroke-width': 1 }); }
// the central plain a little paler (rice), the rivers
for (const [lon, lat, rx, ry] of [[100.2, 15.3, 1.1, 1.4], [103.4, 15.9, 1.6, 0.9]]) { const [x, y] = px(lon, lat); el('ellipse', { cx: x, cy: y, rx: rx * S, ry: ry * S, fill: 'rgba(200,210,120,.18)', filter: 'url(#soft)' }); }
for (const r of RIVERS) { el('path', { d: smooth(r, false), fill: 'none', stroke: 'rgba(30,60,40,.5)', 'stroke-width': 4.4, 'stroke-linecap': 'round' }); el('path', { d: smooth(r, false), fill: 'none', stroke: '#6fb8d8', 'stroke-width': 2.4, 'stroke-linecap': 'round' }); }
// ranges of hills in the north and west, lit from one side
const ridge = (lon, lat, s) => { const [x, y] = px(lon, lat), w = 13 * s, h = 15 * s;
  el('path', { d: `M${x - w},${y} Q${x - w * 0.35},${y - h * 0.7} ${x},${y - h} Q${x + w * 0.4},${y - h * 0.6} ${x + w},${y} Z`, fill: 'url(#ridgeD)' });
  el('path', { d: `M${x - w},${y} Q${x - w * 0.35},${y - h * 0.7} ${x},${y - h} Q${x - w * 0.05},${y - h * 0.4} ${x + w * 0.15},${y} Z`, fill: 'url(#ridgeL)' }); };
const range = (pts) => { for (const [lon, lat, s] of pts) ridge(lon, lat, s); };
range([[98.15, 19.85, 1.1], [98.45, 19.55, 1.3], [98.75, 19.95, 1], [99.35, 19.75, 1.2], [99.7, 19.4, 0.9], [100.3, 19.2, 1.15], [100.75, 18.75, 1], [101.0, 18.25, 0.9], [98.35, 18.6, 1.2], [98.55, 18.1, 1.35], [98.3, 17.6, 1.1], [98.75, 17.25, 1],
  [99.25, 18.05, 0.8], [101.3, 17.3, 0.8], [101.7, 16.85, 0.7], [98.75, 16.4, 1], [98.85, 15.8, 0.9], [98.95, 15.1, 0.85], [99.15, 14.5, 0.8], [99.35, 13.7, 0.7], [102.0, 14.5, 0.6], [98.85, 9.7, 0.7], [99.2, 8.8, 0.65], [100.95, 6.0, 0.55]]);
// forest as clusters of soft dark dots
const grove = (lon, lat, n) => { const [x, y] = px(lon, lat); for (let i = 0; i < n; i++) { const cx = x + R(-16, 16), cy = y + R(-10, 10), r = R(2.6, 4.2); el('circle', { cx, cy: cy + 1.2, r, fill: 'rgba(20,40,20,.45)' }); el('circle', { cx, cy, r, fill: '#3f6b33' }); } };
for (const [lon, lat, n] of [[103.6, 16.3, 6], [104.3, 15.4, 5], [102.6, 15.2, 6], [103.0, 17.4, 5], [104.3, 17.0, 4], [101.6, 14.7, 5], [102.4, 13.0, 5], [99.95, 8.1, 5], [100.6, 7.0, 5], [99.6, 12.8, 4], [98.6, 10.4, 4], [100.4, 17.6, 5], [101.0, 16.2, 5]]) grove(lon, lat, n);
// names on the water, boats with a lamp at the stern
el('text', { class: 'sea', x: px(101.5, 10.4)[0], y: px(101.5, 10.4)[1] }).textContent = 'อ่าวไทย';
el('text', { class: 'sea', x: px(95.2, 11.8)[0], y: px(95.2, 11.8)[1] }).textContent = 'ทะเลอันดามัน';
const boat = (lon, lat, cls) => { const [x, y] = px(lon, lat), b = g('boat ' + cls); el('path', { d: `M${x - 11},${y} L${x + 11},${y} L${x + 7},${y + 5} L${x - 7},${y + 5} Z`, fill: '#3a2a1c' }, b); el('circle', { cx: x - 9, cy: y - 2, r: 5, fill: 'url(#glowG)' }, b); el('circle', { cx: x - 9, cy: y - 2, r: 1.3, fill: '#ffe3a0' }, b); };
boat(102.2, 9.3, 'b1'); boat(96.6, 9.0, 'b2'); boat(104.2, 11.6, 'b3'); boat(100.9, 12.2, 'b2');
// thin mist drifting over the land and the sea
const mist = (x, y, s, cls = '') => el('ellipse', { cx: x, cy: y, rx: 90 * s, ry: 22 * s, fill: 'rgba(220,230,255,.10)', filter: 'url(#soft)', class: 'mist ' + cls });
for (const [x, y, s, c] of [[-120, 90, 1.2, ''], [420, 140, 1.4, 'd2'], [460, 520, 1.1, ''], [-200, 430, 1.3, 'd2'], [150, 300, 0.9, ''], [80, 560, 1.0, 'd2']]) mist(x, y, s, c);
// the edges of the world fade into the night
{ const v = el('radialGradient', { id: 'vig', cx: '42%', cy: '45%', r: '70%' }, defs); el('stop', { offset: 0.55, 'stop-color': '#050c18', 'stop-opacity': 0 }, v); el('stop', { offset: 1, 'stop-color': '#050c18', 'stop-opacity': 0.75 }, v);
  el('rect', { x: BX0, y: BY0, width: BW, height: BH, fill: 'url(#vig)', 'pointer-events': 'none' }); }
// a warm glow on the ground at each place of the festival
for (const p of PLACES) { const [x, y] = px(p.lon, p.lat); el('circle', { cx: x, cy: y, r: 34, fill: 'url(#glowG)', class: 'cityglow' }); }

// ---------------------------------------------------------------------------------------------- pins and the card
const NAMES = { krathong: 'ลอยกระทง', lantern: 'ปล่อยโคมลอย' };
// what is drawn in each pin's badge: a sky lantern where they go up, a lotus krathong where they float
const ICON = {
  lantern: '<svg viewBox="0 0 40 40"><path d="M11 8 h18 l-3 22 h-12 z" fill="#ffb347"/><path d="M11 8 h18 l-3 22 h-12 z" fill="url(#none)" stroke="#ffe2a0" stroke-width="1.2" stroke-linejoin="round" opacity=".7"/><path d="M14 12 h12" stroke="#fff3c4" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="20" cy="31" rx="3.2" ry="2.2" fill="#fff6d0"/></svg>',
  krathong: '<svg viewBox="0 0 40 40"><path d="M6 26 q14 8 28 0 z" fill="#5d9b48"/><path d="M20 11 q-5 8 0 15 q5 -7 0 -15 z" fill="#ffa6c0"/><path d="M11 16 q0 9 8 10 q-1 -7 -8 -10 z M29 16 q0 9 -8 10 q1 -7 8 -10 z" fill="#ffc6d6"/><rect x="19.2" y="4" width="1.6" height="7" rx=".8" fill="#fff3c4"/><ellipse cx="20" cy="3.6" rx="1.6" ry="2.4" fill="#ffd27a"/></svg>',
};
const world = $('world'), view = $('view'), pinLayer = $('pins'), pinEls = [];
let chosen = null;
function show(p) {
  chosen = p;
  for (const e of pinEls) if (e.dataset.id) e.classList.toggle('on', e.dataset.id === p.id);
  $('cVenue').textContent = p.venue; $('cName').textContent = p.name; $('cBlurb').textContent = p.blurb;
  $('cTags').innerHTML = ''; p.modes.forEach((m, i) => { const s = document.createElement('span'); s.textContent = NAMES[m]; if (i === 0) s.className = 'main'; $('cTags').appendChild(s); });
  $('cSteps').innerHTML = ''; for (const s of p.steps) { const li = document.createElement('li'); li.textContent = s; $('cSteps').appendChild(li); }
  $('card').classList.add('on'); document.body.classList.add('picked');
  try { history.replaceState(null, '', '#' + p.id); } catch (_) { /* file:// */ }
}
$('cClose').addEventListener('click', () => { $('card').classList.remove('on'); document.body.classList.remove('picked'); chosen = null; for (const e of pinEls) e.classList.remove('on'); });
PLACES.forEach((p, i) => {
  const [x, y] = px(p.lon, p.lat);
  const b = document.createElement('button'); b.className = 'mpin'; b.dataset.id = p.id; b.style.setProperty('--d', (0.3 + i * 0.25) + 's');
  b.setAttribute('aria-label', `${p.name}: ${p.venue}`); b.wx = x; b.wy = y;
  b.innerHTML = `<span class="ring"></span><span class="shadow"></span><span class="fl"><span class="lbl"></span><span class="badge">${ICON[p.modes[0]]}</span><span class="tail"></span></span>`;
  b.querySelector('.lbl').textContent = p.short;
  b.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); return; } show(p); focusOn(x, y); });
  pinLayer.appendChild(b); pinEls.push(b);
});

// ---------------------------------------------------------------------------------------------- the camera: drag to move, wheel / pinch / + − to zoom
// The world is laid out at K pixels a map unit, then moved by (ox, oy) and scaled by Z. Pins keep their size whatever the zoom (--z).
let K = 2, Z = 1, ox = 0, oy = 0, dragged = false;
const ZMAX = 3;
// as far out as the map still fills the whole view (no edge of the world, no empty page round it)
const zMin = () => Math.max(view.clientWidth / (BW * K), view.clientHeight / (BH * K));
function layout() {
  const vw = view.clientWidth, vh = view.clientHeight;
  K = Math.min(2.6, Math.max(1.1, vh / 420, vw / 1000));
  world.style.width = BW * K + 'px'; world.style.height = BH * K + 'px';
  for (const b of pinEls) { b.style.left = (b.wx - BX0) * K + 'px'; b.style.top = (b.wy - BY0) * K + 'px'; }
}
function pan(x, y) {
  const vw = view.clientWidth, vh = view.clientHeight, ww = BW * K * Z, wh = BH * K * Z;
  ox = ww > vw ? Math.min(0, Math.max(vw - ww, x)) : (vw - ww) / 2; oy = wh > vh ? Math.min(0, Math.max(vh - wh, y)) : (vh - wh) / 2;
  world.style.transform = `translate(${ox.toFixed(1)}px,${oy.toFixed(1)}px) scale(${Z.toFixed(3)})`; world.style.setProperty('--z', Z.toFixed(3));
}
// zoom to z keeping the point (cx, cy) of the view where it is
function zoomAt(z, cx, cy) { z = Math.min(ZMAX, Math.max(zMin(), z)); const wx = (cx - ox) / Z, wy = (cy - oy) / Z; Z = z; pan(cx - wx * Z, cy - wy * Z); }
const glide = (f) => { world.classList.add('glide'); f(); clearTimeout(glide.t); glide.t = setTimeout(() => world.classList.remove('glide'), 450); };
// bring a point of the map to the middle of the part of the view not under the card
function focusOn(x, y, smooth = true) {
  const vw = view.clientWidth, vh = view.clientHeight, open = $('card').classList.contains('on'), side = vw > 860 && open ? 400 : 0, low = vw <= 860 && open ? vh * 0.42 : 0;
  const go = () => pan((vw - side) / 2 - (x - BX0) * K * Z, (vh - low) / 2 + 30 - (y - BY0) * K * Z);
  if (smooth) glide(go); else go();
}
const ptrs = new Map(); let drag = null, pinch = null;
view.addEventListener('pointerdown', (e) => {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: Z }; drag = null; dragged = true; }
  else { drag = { x: e.clientX, y: e.clientY, ox, oy, id: e.pointerId }; dragged = false; }
});
addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()], r = view.getBoundingClientRect(); zoomAt(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return; }
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragged && Math.hypot(dx, dy) > 6) { dragged = true; view.classList.add('grab'); }
  if (dragged) pan(drag.ox + dx, drag.oy + dy);
});
const endPtr = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { drag = null; view.classList.remove('grab'); setTimeout(() => { dragged = false; }, 0); } };
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
view.addEventListener('wheel', (e) => {
  e.preventDefault(); const r = view.getBoundingClientRect();
  if (e.deltaY) zoomAt(Z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);      // the wheel (and a trackpad's pinch) zooms,
  if (e.deltaX) pan(ox - e.deltaX, oy);                                                                                         // a sideways swipe moves
}, { passive: false });
const zoomBy = (f) => glide(() => zoomAt(Z * f, view.clientWidth / 2, view.clientHeight / 2));
$('zIn').addEventListener('click', () => zoomBy(1.35)); $('zOut').addEventListener('click', () => zoomBy(1 / 1.35));
addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') zoomBy(1.35); else if (e.key === '-') zoomBy(1 / 1.35);
  const m = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] }[e.key]; if (m) { e.preventDefault(); glide(() => pan(ox + m[0], oy + m[1])); }
});
addEventListener('resize', () => { layout(); Z = Math.min(ZMAX, Math.max(zMin(), Z)); pan(ox, oy); });
layout(); if (view.clientWidth < 860) Z = 0.72; Z = Math.max(zMin(), Z);
// Where the map starts: where the player is, if the browser will say (and it is in Thailand); Bangkok until then, and if it will not.
const HOME = [100.5, 13.75];
focusOn(...px(HOME[0], HOME[1]), false);
const inThailand = (lon, lat) => lon > 97.2 && lon < 105.8 && lat > 5.5 && lat < 20.6;
function whereAmI() {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok([p.coords.longitude, p.coords.latitude]), () => ok(null), { timeout: 8000, maximumAge: 6 * 3600e3, enableHighAccuracy: false });
  });
}
function markMe(lon, lat) {
  const [x, y] = px(lon, lat), m = document.createElement('div'); m.className = 'me'; m.innerHTML = '<i></i><span>คุณ</span>';
  m.style.left = (x - BX0) * K + 'px'; m.style.top = (y - BY0) * K + 'px'; m.wx = x; m.wy = y; pinLayer.appendChild(m); pinEls.push(m);
}
const go = () => {
  if (!chosen) return;
  $('ldTitle').textContent = chosen.name; $('ldSub').textContent = chosen.venue;
  LD.root.classList.remove('off'); LD.step('กำลังเดินทางไป' + chosen.short, 5).then(() => { location.href = 'play.html?loc=' + encodeURIComponent(chosen.id); });
};
$('cGo').addEventListener('click', go);
// กลับมาจากหน้าเกม (ปุ่มย้อนกลับของเบราว์เซอร์ใช้ภาพเดิมจาก cache): ซ่อนหน้า loading อีกครั้ง
addEventListener('pageshow', (e) => { if (e.persisted) LD.root.classList.add('off'); });

if (!navigator.gpu) { $('gpuNote').textContent = 'เบราว์เซอร์นี้ไม่รองรับ WebGPU ซึ่งเกมต้องใช้ ลองเปิดด้วย Chrome หรือ Edge รุ่นล่าสุด'; $('gpuNote').hidden = false; }

// ---------------------------------------------------------------------------------------------- load: fonts, wishes
await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((ok) => setTimeout(ok, 2500))]);
await LD.step('กำลังรับคำอธิษฐานจากทั่วประเทศ', 55);
await Wishes.load({ timeout: 3500 });
Counter($('wCount'));      // how many have been floated and let go, all over the country
await LD.step('พร้อมแล้ว', 100);
LD.done();
document.body.classList.add('ready');
const pre = placeById(location.hash.slice(1)); if (pre) { show(pre); focusOn(...px(pre.lon, pre.lat), false); }
// hot reload (bun run dev): the view is kept across the reload
window.liveKeep = () => { try { sessionStorage.setItem('lk.map', JSON.stringify({ ox, oy, Z })); } catch (_) { /* not kept */ } };
let kept = null; try { kept = JSON.parse(sessionStorage.getItem('lk.map') || 'null'); sessionStorage.removeItem('lk.map'); } catch (_) { /* none */ }
if (kept) { Z = Math.max(zMin(), kept.Z); pan(kept.ox, kept.oy); }
whereAmI().then((at) => { if (!at || !inThailand(at[0], at[1])) return; markMe(at[0], at[1]); if (!chosen && !kept) focusOn(...px(at[0], at[1])); });

Wishes.poll(60000);
})();
