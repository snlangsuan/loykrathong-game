// =====================================================================================================================
// ลอยกระทง: เดินเที่ยวงานคืนวันเพ็ญในสถานที่ที่เลือกจากแผนที่ (play.html?loc=<id>, ดู js/places.js)
// วาดด้วย engine เดียวกับ Endless (js/engine.js: WebGPU วาดด้วยโค้ดทั้งหมด ไม่มีไฟล์ภาพ ไม่มีโมเดล): ใบไม้แบบ instanced ท่อ กล่อง
// shadow map, HDR, bloom, tone map. หน้านี้ใส่ของตัวเองลงในช่องที่ engine เปิดไว้: ไฟดวงเล็กๆ จำนวนมาก แม่น้ำหรือสระที่สะท้อนไฟ
// กระทงที่ลอยอยู่ โคมลอย ดอกไม้ไฟ ผู้คนในงาน
//
// สิ่งที่ผู้เล่นทำ: ซื้อกระทงหรือโคมที่ร้าน · ถือไปที่ท่าน้ำหรือลานโคม · จุดธูปเทียน · กดอธิษฐาน (พิมพ์คำอธิษฐาน)
// · กดตกลงแล้วกระทงจะลอยออกไป หรือโคมจะพองลมร้อนแล้วลอยขึ้นฟ้า
// กระทงและโคมที่ลอยอยู่ใกล้ๆ มีบอลลูนแสดงคำอธิษฐาน ดึงจาก API (js/wishes.js) หรือสุ่มจากข้อความตัวอย่างถ้าดึงไม่ได้
// =====================================================================================================================
// A phone or tablet: fewer lamps per pixel, a smaller shadow map, fewer trees and krathongs, leaves thinned sooner, and touch controls.
const MOBILE = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
// LOW: the light way of drawing, for phones (or ?q=low; ?q=high forces the full picture).
const QP = new URLSearchParams(location.search).get('q'), LOW = QP ? QP === 'low' : MOBILE;
// TOON: the painted look of a stylised game (bright, clean, saturated, blue haze, a brighter night); ?look=real for the original darker, grittier picture
const TOON = new URLSearchParams(location.search).get('look') !== 'real';
(async () => {
const $ = (id) => document.getElementById(id);
const PL = placeById(new URLSearchParams(location.search).get('loc'));
if (!PL) { location.replace('index.html'); return; }
const HAS_K = PL.modes.includes('krathong'), HAS_L = PL.modes.includes('lantern'), MAIN = PL.modes[0], RIVER = PL.water === 'river';
document.title = `ลอยกระทง · ${PL.short}`;
const LD = Loader('loading');
$('ldTitle').textContent = PL.name; $('ldSub').textContent = PL.venue;
if (new URLSearchParams(location.search).has('debug')) $('hud').style.display = 'block';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
await LD.step('กำลังเตรียมการ์ดจอ', 4);
const wishesP = Wishes.load({ timeout: 4000 });      // (fetched while the world is being built)
if (typeof Engine === 'undefined') { LD.error('โหลด engine.js ไม่สำเร็จ'); return; }
const { clamp, mix, sm, fract, vnoise, fbm, rng, mul, view, cross, nrm3, makeTree, makePalm, makeSugarPalm, makeBanana, mkB, addGableRoof,
  makeBush, LONGTAIL, SALA } = Engine;
const { sin, cos, abs, min, max, floor, hypot, atan2, PI } = Math, TAU = PI * 2;
const GPU = await Engine.boot({ shadow: LOW ? 2048 : 4096, aa: LOW ? 1 : 4 }).catch((e) => { console.error(e); return null; });
if (!GPU) {
  $('err').style.display = 'none';
  LD.error('เบราว์เซอร์หรืออุปกรณ์นี้ยังไม่รองรับ <b>WebGPU</b> ซึ่งเกมต้องใช้วาดภาพ<br>ลองเปิดด้วย Chrome หรือ Edge รุ่นล่าสุดบนคอมพิวเตอร์ หรือ Safari 26 ขึ้นไป<br><a class="btn sm" href="index.html">← กลับแผนที่</a>');
  return;
}
const { device, Q, HDR, DEPTH, AA } = GPU;

// --------------------------------------------------------------------------------------------------------- the land
// Level ground beside the water. x runs along the water, z toward it: the gate is at z = -66, the bank at about z = 46.
// A river runs on past both ends; a pond (ตระพัง) ends some way off to either side. WL: the level of the water. NL: how many lamps at once.
const NL = LOW ? 10 : 40, WL = -0.9, PCF = LOW ? 0 : 1, PX = 105;
const NEARHILL = PL.far === 'city' ? 0.12 : PL.id === 'chiangmai' ? 1.7 : 0.8;
const bankZ = (x) => 46 + 1.6 * sin(x * 0.045 + 1) * sm(10, 30, abs(x));
const farZ = RIVER ? (x) => 136 + 5 * sin(x * 0.021 + 2) : (x) => 100 + 3 * sin(x * 0.05 + 1);
const wetK = (x) => (RIVER ? 1 : 1 - sm(PX - 22, PX, abs(x)));
// ground height; gw[0] is set to 1 where the point is under water
const gw = [0];
function ground(x, z) {
  gw[0] = 0;
  const out = max(sm(60, 120, abs(x)), sm(68, 120, -z));
  let h = (fbm(x * 0.05 + 3, z * 0.05, 3) - 0.5) * 0.12 + out * (fbm(x * 0.012 + 9, z * 0.012, 3) - 0.4) * 5;
  const b = bankZ(x), f = farZ(x);
  h = mix(h, -2.8, sm(b - 1.5, b + 6, z) * (1 - sm(f - 8, f + 1.5, z)) * wetK(x));
  h += sm(f, f + 60, z) * (2 + fbm(x * 0.01, z * 0.01, 3) * 9) * NEARHILL;
  if (h < WL) { h = WL; gw[0] = 1; }
  return h;
}
// The pier (ท่าน้ำ): a wooden deck out from the bank, four steps down, a landing just above the water.
const PIER = { x: 2.4, z0: 42.5, z1: 54, zs: 57, zp: 62.2, y: 0.5, py: WL + 0.32 };
const EDGE = 59.4;      // from here on the landing the water is within reach
const surf = (x, z) => {
  if (abs(x) < 3.2 && z > PIER.zs - 0.05 && z < PIER.zp + 0.2) return PIER.py;
  if (abs(x) < PIER.x && z > PIER.z0 - 1.3 && z <= PIER.zs) {
    if (z < PIER.z0) return mix(ground(x, z), PIER.y, (z - (PIER.z0 - 1.3)) / 1.3);
    if (z < PIER.z1) return PIER.y;
    return PIER.y - (floor((z - PIER.z1) / 0.75) + 1) * 0.27;
  }
  return ground(x, z);
};

// --------------------------------------------------------------------------------------------------------- shaders
// The shaders are the engine's (engine.js); this is what the fair puts in the places it leaves open.
// Uniforms as this page uses them: sun: the moon's direction · fog: z cloud · camM: z how many lamps are lit · (the rest as the engine says)
const f1 = (v) => (+v).toFixed(3);
const WGSL = {
  // fwA, fwB: two fireworks (azimuth, elevation, age, seed) · lp: a lamp's place and reach · lc: its colour and how fast it falls off
  uniforms: /* wgsl */`, fwA: vec4f, fwB: vec4f,
  lp: array<vec4f, ${NL}>, lc: array<vec4f, ${NL}>`,
  // the level of the water, and what differs from place to place
  common: /* wgsl */`
const WL = ${WL};
const PLACE: i32 = ${PL.idx};
const SKYL: f32 = ${f1(PL.sky)};
const HILLS: f32 = ${f1(PL.hills)};
const CITY: f32 = ${PL.far === 'city' ? '1.0' : '0.0'};
const COURT: f32 = ${PL.temple === 'ruin' || PL.temple === 'park' ? '0.0' : '1.0'};
const TOON: f32 = ${TOON ? '1.0' : '0.0'};
// A block of a person: the engine's unit cube, sized, tilted forward or back about its own middle (b.w, pitch) and turned (a.w, yaw).
// v: the place on the block, -1..1 each way (so that a face can be painted on the front of the head); ln: which face of the block this is.
struct BKO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) v: vec3f, @location(3) @interpolate(flat) ln: vec3f, @location(4) @interpolate(flat) m: vec4f };
@vertex fn vsBlock(@location(0) p: vec3f, @location(1) nv: vec3f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) m: vec4f) -> BKO {
  var o: BKO; let ct = cos(b.w); let st = sin(b.w); let cy = cos(a.w); let sy = sin(a.w);
  let q = p * b.xyz; let q1 = vec3f(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct); let n1 = vec3f(nv.x, nv.y * ct - nv.z * st, nv.y * st + nv.z * ct);
  let rel = a.xyz - g.cam.xyz + vec3f(q1.x * cy + q1.z * sy, q1.y, -q1.x * sy + q1.z * cy);
  o.n = vec3f(n1.x * cy + n1.z * sy, n1.y, -n1.x * sy + n1.z * cy); o.wp = rel + g.cam.xyz; o.v = p * 2.; o.ln = nv; o.m = m; o.cp = g.vp * vec4f(rel, 1.);
  return o;
}
`,
  // the v of a tube's skin: height above the ground for bark, but along its own length for a made thing (materials from 8 up)
  barkV: 'mix(p.y + g.cam.y, v.z, step(7.5, h.y) * (1. - plant))',
  // the painted look: leaves a clean, saturated green, a little toward blue
  leafTint: TOON ? '  { let lm = dot(col, vec3f(.3, .6, .1)); col = mix(vec3f(lm), col, 1.55) * vec3f(1.05, 1.25, 1.0) * 1.2; }' : '',
  bloom: TOON ? 0.3 : 0.22,
  // the painted look, last of all: more colour, shadows lifted toward blue-violet, highlights warmed, a soft S-curve
  grade: TOON ? `  { let lm = dot(c, vec3f(.2126, .7152, .0722)); c = mix(vec3f(lm), c, 1.32);
    c += vec3f(.020, .026, .062) * (1. - ss(0., .45, lm));
    c = mix(c, c * vec3f(1.06, 1.0, .9), ss(.45, .95, lm));
    c = mix(c, c * c * (3. - 2. * c), .35); }` : '',
  // fsTerrain: the engine has laid turf and bare earth (alb, bump, gloss, wet; n the normal). Paint the fair's ground over it
  ground: /* wgsl */`
  // Inside the walls the ground is swept earth (among the ruins it is left to grass), with grass at the edges, along the water and on the lawn.
  let court = (1. - ss(56.5, 58.5, abs(P.x))) * ss(-67.5, -65.5, P.y) * (1. - ss(45., 47., P.y));
  let lawn = max(max(1. - ss(12., 14.5, length(P - vec2f(34., 16.)) + rag * 8.), ss(50., 53., abs(P.x) + rag * 8.)), max(ss(36.5, 39., P.y + rag * 8.), 1. - ss(-62., -59.5, P.y - rag * 8.)));
  var earth = mix(vec3f(.33, .27, .19), vec3f(.25, .195, .135), pn(P * .23)) * (.78 + .4 * n3) * (.9 + .2 * n5);
  earth *= 1. + .07 * nk * sin((P.x * .9 + P.y * .35 + n2 * 2.) * 9.);                         // the marks of the broom
  earth = mix(earth, soil * 1.15, .35);
  alb = mix(alb, mix(earth, mix(soil, grass, ss(-.03, .03, tfv - .30 + rag)), lawn), court * COURT);
  // the walks, paved in square tiles with a kerb of grey stone
  var dp = sdb(P, vec2f(0., -10.5), vec2f(2.7, 56.));                 // from the gate to the pier
  dp = min(dp, sdb(P, vec2f(-6., -16.), vec2f(15., 2.2)));            // across to the hall
  dp = min(dp, sdb(P, vec2f(-27., -16.), vec2f(8.2, 11.)));           // round the hall
  dp = min(dp, sdb(P, vec2f(-30., 18.), vec2f(7.5, 7.5)));            // round the chedi
  dp = min(dp, sdb(P, vec2f(-30., 3.), vec2f(1.8, 8.)));              // between the two
  dp = min(dp, sdb(P, vec2f(11.5, -21.), vec2f(5., 25.)));            // under the stalls
  dp = min(dp, sdb(P, vec2f(13., 16.), vec2f(11., 1.6)));             // out to the lawn
  dp = min(dp, sdb(P, vec2f(0., 42.2), vec2f(52., 2.)));              // the walk along the water
  if (PLACE == 0) { dp = min(dp, sdb(P, vec2f(0., 34.5), vec2f(57., 10.))); }      // Rama VIII park: the wide concrete promenade by the river
  let pave = (1. - ss(-.04, .04, dp)) * court;
  let ft = 1. - ss(.5, 1.4, px * 5.); let tq = fract(Pf / .5); let joint = mix(.8, ss(0., .05, min(min(tq.x, 1. - tq.x), min(tq.y, 1. - tq.y))), ft);
  var tile = mix(vec3f(.37, .21, .14), vec3f(.29, .17, .12), mix(.5, h2(floor(Pf / .5)), ft));
  if (PLACE == 0) { let cq = fract(Pf / 1.5); let cj = mix(.8, ss(0., .03, min(min(cq.x, 1. - cq.x), min(cq.y, 1. - cq.y))), ft); tile = mix(vec3f(.46, .45, .42), vec3f(.40, .39, .37), mix(.5, h2(floor(Pf / 1.5) + 7.), ft)) * (.75 + .25 * cj); }
  else if (COURT < .5) { tile = mix(vec3f(.40, .20, .11), vec3f(.30, .15, .09), mix(.5, h2(floor(Pf / .5) + 3.), ft)) * (.8 + .25 * step(.35, vn(Pf * 9.))); }      // laterite slabs, pitted
  alb = mix(alb, tile * (.8 + .3 * n4) * (.62 + .38 * joint) * (.85 + .3 * n2), pave);
  alb = mix(alb, vec3f(.44, .43, .40) * (.8 + .3 * n4), court * ss(-.04, .04, dp) * (1. - ss(.2, .26, dp)));
  bump = mix(bump, .3, pave); gloss = mix(gloss, .2, pave);
  // down the bank the earth is dark and wet
  let mud = ss(.0, -.55, wp.y);
  alb = mix(alb, mix(vec3f(.13, .10, .07), vec3f(.07, .09, .05), ss(.3, .7, n2)) * (.7 + .5 * n3), mud); gloss = mix(gloss, .4, mud);
  if (TOON > .5) {      // the painted look: a lawn of clean, even green, the fine grit gone
    let toonG = mix(vec3f(.05, .13, .03), vec3f(.09, .2, .05), n1) * mix(.85, 1.1, n2);
    alb = mix(alb, toonG, ss(.25, .75, tfv - .3 + rag + .5) * (1. - pave) * .75);
    let lm = dot(alb, vec3f(.3, .6, .1)); alb = mix(vec3f(lm), alb, 1.3); bump *= .35;
  }
  n = normalize(n - vec3f(bx + fbx * nk * 1.4, 0., bz + fbz * nk * 1.4) * bump);
`,
  // fsTerrain: the engine has the moon and the shadow (L, V, ndl, sh, E). Light the ground, lay the water over it, return the pixel
  groundLight: /* wgsl */`
  var c = alb * (E * ndl + sky(n) + head(wp, n));
  c += E * pow(max(dot(n, normalize(V + L)), 0.), 24.) * ndl * gloss;
  // The water: dark, slow, its ripples mirroring the sky, the moon in a long broken path, and every lamp on the bank as a wavering streak.
  let lake = ss(.35, .65, i.w);
  if (lake > .01) {
    let t = g.cam.w; let calm = .35 + .65 / (1. + dcam * .012);
    let w1 = vec2f(vn(P * .8 + vec2f(t * .30, t * .10)) - .5, vn(P * .8 + vec2f(9., -t * .26)) - .5);
    let w2 = vec2f(vn(P * 2.9 - vec2f(t * .5, 0.)) - .5, vn(P * 2.9 + vec2f(3., t * .6)) - .5);
    let w3 = (vec2f(vn(P * 9. + vec2f(t, 0.)), vn(P * 9. + vec2f(5., t))) - .5) * (1. - ss(.5, 1.4, px * 9.));
    let wn = normalize(vec3f((w1.x + w2.x * .5 + w3.x * .25) * .34 * calm, 1., (w1.y + w2.y * .5 + w3.y * .25) * .34 * calm));
    let R = reflect(-V, wn);
    var refl = mix(horizon(R), g.zen.rgb, pow(ss(0., .8, max(R.y, 0.)), .55));
    refl += vec3f(.9, .42, .16) * .06 * CITY * (1. - .6 * TOON) * exp(-max(R.y, 0.) * 9.);
    let rl = max(dot(R, L), 0.);
    refl += g.sunCol.rgb * (pow(rl, 900.) * 55. + pow(rl, 120.) * .9 + pow(rl, 12.) * .08);
    var gl = vec3f(0.); let cnt = i32(g.camM.z);
    for (var k = 0; k < cnt; k++) {
      let v = g.lp[k].xyz - wp; let d2 = dot(v, v); if (d2 > 22500.) { continue; }
      let s = max(dot(R, v * inverseSqrt(max(d2, 1e-4))), 0.);
      gl += g.lc[k].rgb * ((pow(s, 260.) * 5. + pow(s, 30.) * .07) / (1. + d2 * .0035));
    }
    let fr = .03 + .97 * pow(1. - max(dot(V, wn), 0.), 5.);
    let deep = mix(vec3f(.004, .008, .009), vec3f(.006, .03, .04), TOON);
    c = mix(c, mix(c * .12 + deep, refl * (1. + .35 * TOON), fr) + gl * (.3 + .7 * fr), lake);
  }
  return vec4f(fogged(c, wp), 1.);
`,
  // fsBranch: the materials of the things made of tubes here (krathongs, candles, sky lanterns, ruins), then the light. mi is the material + 1.
  branchLight: /* wgsl */`
  var emi = vec3f(0.); let mi = i32(i.m + .5); let v = i.uv.y; let flk = .9 + .1 * sin(g.cam.w * 9. + i.wp.x * 3.); let glw = (1. - v) * (1. - v);
  if (mi == 9) { alb = vec3f(.9, .62, .3); emi = vec3f(1., .40, .09) * (.22 + 1.5 * glw) * flk; }      // a sky lantern's paper, lit by the flame at its mouth
  else if (mi == 10) { alb = vec3f(1.); emi = vec3f(1., .60, .18) * 14.; }                                              // a flame
  else if (mi == 11) { alb = mix(vec3f(.04, .13, .025), vec3f(.08, .21, .04), fur) * (.7 + .5 * v); }                  // folded banana leaf
  else if (mi == 12) { alb = vec3f(.92, .50, .04) * (.75 + .4 * fur); }                                                // marigold
  else if (mi == 13) { alb = mix(vec3f(.85, .30, .45), vec3f(.95, .72, .76), v); }                                     // lotus pink
  else if (mi == 14) { alb = mix(vec3f(.42, .12, .55), vec3f(.75, .55, .85), v); }                                     // orchid
  else if (mi == 15) { alb = vec3f(.88, .80, .50); }                                                                   // candle wax
  else if (mi == 16) { alb = vec3f(.62, .44, .22) * (.8 + .3 * fur); }                                                 // bread
  else if (mi == 17) { alb = vec3f(.20, .10, .06); }                                                                   // incense
  else if (mi == 18) { alb = vec3f(.80, .36, .05) * (.8 + .3 * fur); }                                                 // saffron cloth
  else if (mi == 19) { alb = vec3f(.90, .88, .84); }                                                                   // white petals
  else if (mi == 20) { alb = vec3f(.62, .06, .06); }                                                                   // red cloth
  else if (mi == 21) { alb = vec3f(.80, .76, .68) * (.85 + .2 * fur); }                                                // lantern paper, not yet lit
  else if (mi == 24) { alb = vec3f(.8, .2, .12); emi = vec3f(1., .16, .06) * (.25 + 1.6 * glw) * flk; }                // a red sky lantern, lit
  else if (mi == 25) { alb = vec3f(.95, .7, .25); emi = vec3f(1., .56, .10) * (.3 + 1.7 * glw) * flk; }               // gold, lit
  else if (mi == 26) { let lo = ss(.35, .65, vn(vec2f(i.uv.x * 7., v * 5.))); alb = vec3f(.95, .9, .8); emi = mix(vec3f(1., .72, .45), vec3f(1., .38, .52), lo * .7) * (.28 + 1.6 * glw) * flk; }      // printed with lotuses, lit
  else if (mi == 27) { alb = vec3f(.62, .09, .07) * (.85 + .2 * fur); }                                                // red paper, not yet lit
  else if (mi == 28) { alb = vec3f(.82, .60, .20) * (.85 + .2 * fur); }                                                // gold paper
  else if (mi == 29) { alb = mix(vec3f(.84, .80, .72), vec3f(.78, .45, .55), ss(.4, .6, vn(vec2f(i.uv.x * 7., v * 5.))) * .6); }      // lotus print
  else if (mi == 30) { alb = mix(vec3f(.30, .14, .08), vec3f(.50, .27, .15), ss(.25, .75, vn(i.wp.xy * 2.3 + i.wp.z * 1.7))) * (.75 + .35 * vn(vec2f(i.uv.x * 40., i.uv.y * 30.))) * (.8 + .2 * step(.33, vn(i.wp.xz * 11. + i.wp.y * 9.))); }      // laterite: rust red, pitted
  else if (mi == 31) { alb = vec3f(.64, .62, .56) * (.78 + .3 * vn(i.wp.xy * 1.7 + i.wp.z)); alb = mix(alb, vec3f(.27, .26, .23), ss(.58, .82, vn(i.wp.xz * .9 + i.wp.y * 1.3)) * .7); }      // old stucco, darkened with age
  else if (mi == 32) { alb = vec3f(.85, .7, .3); emi = vec3f(1., .72, .32) * .8; }                                    // a cable of the bridge, floodlit
  else if (mi == 33) { alb = vec3f(.80, .78, .74) * (.85 + .2 * fur); emi = vec3f(1., .88, .66) * (.28 + .12 * v); }      // white concrete or plaster under floodlights (the bridge's pylon, the fort)
  let E = g.sunCol.rgb * shadow(i.wp + n * .08);
  var c = alb * (E * max(dot(nb, L), 0.) + sky(nb) * .8 + head(i.wp, nb)) + emi;
`,
  // fsBox: this page's own box materials, as further arms of the chain of box materials
  boxMats: /* wgsl */`
  else if (mat == 50) {      // a paper lantern lit from inside: brightest round its middle, the ribs showing darker
    let hh = max(i.m.z * .5, .01); let v = clamp(i.lp.y / hh, -1., 1.);
    var lc = vec3f(1., .26, .08); if (sd > .22) { lc = vec3f(1., .58, .12); } if (sd > .46) { lc = vec3f(1., .80, .42); } if (sd > .68) { lc = vec3f(1., .25, .32); } if (sd > .86) { lc = vec3f(.40, .9, .48); }
    let fl = .88 + .12 * sin(g.cam.w * (4. + sd * 7.) + sd * 40.);
    alb = lc * .5; emi = lc * (.7 + 1.7 * (1. - v * v)) * fl * (.8 + .2 * step(.25, fract(uv.x / .065)));
    if (abs(i.ln.y) > .5) { emi *= .5; }
  }
  else if (mat == 51) { alb = vec3f(.80, .36, .05) * (.85 + .2 * vn(uv * 9.)); }      // saffron cloth
  else if (mat == 52) { alb = vec3f(.84, .81, .74) * (.9 + .1 * vn(uv * 30.)); }      // folded lantern paper
  else if (mat >= 53 && mat <= 57) {      // the people at the fair, built of boxes. m.z: .45 x how tall this one is, m.w: .45 x how dark the skin; q: the place on the box, in an adult's metres
    let q = i.lp * (.45 / i.m.z); let tone = i.m.w / .45; let skin = mix(vec3f(.60, .40, .27), vec3f(.34, .21, .13), tone);
    if (mat == 53) {             // a head (sd: over .5 a woman, her hair long): hair over the crown, the sides and the back, two eyes and a mouth in front
      alb = skin; let woman = step(.5, sd); var hair = vec3f(.032, .028, .026); if (fract(sd * 13.) > .86) { hair = vec3f(.42, .42, .43); }
      var line = mix(.0, -.2, woman);
      if (i.ln.z > .5) { line = .072 - .03 * woman * ss(.06, .1, abs(q.x)); } else if (i.ln.z < -.5) { line = mix(-.05, -.2, woman); }
      if (i.ln.y > .5 || (abs(i.ln.y) < .5 && q.y > line)) { alb = hair * (.8 + .5 * vn(vec2f(uv.x * 160., uv.y * 9.))); }
      else if (i.ln.z > .5) {
        let e = vec2f(abs(q.x) - .046, q.y - .012); if (dot(e, e) < .00034) { alb = vec3f(.02); }
        if (abs(q.x) < .032 && abs(q.y + .058 - q.x * q.x * 14.) < .0055) { alb = skin * vec3f(.55, .3, .3); }
      }
    }
    else if (mat == 54) { alb = cloth(sd) * (.88 + .14 * vn(uv * 60.)); if (i.ln.y > .5) { alb = mix(alb, skin, step(length(q.xz), .07)); } }
    else if (mat == 56) { alb = cloth(sd) * (.88 + .14 * vn(uv * 60.)); if (q.y < .05) { alb = skin; } }
    else if (mat == 55) { alb = mix(vec3f(.045, .055, .085), vec3f(.20, .17, .13), fract(sd * 5.3)) * (.85 + .2 * vn(uv * 50.)); if (q.y < -.31) { alb = mix(skin, vec3f(.03), step(.4, fract(sd * 9.1))); } }
    else {                       // a pha sin: a tube skirt, dark, fine upright stripes, a broad patterned band at the hem
      alb = cloth(fract(sd * 3.1)) * .42 * (.85 + .15 * sin(uv.x * 260. * (.45 / i.m.z)));
      if (q.y < -.17) { alb = mix(alb, vec3f(.62, .47, .14), step(.5, fract(q.y * 38.)) * .8); }
    }
  }
  else if (mat == 58) {      // laterite blocks in courses: rust red, pitted, the joints worn deep
    let bq = vec2f(uv.x / .56 + .5 * floor(uv.y / .3), uv.y / .3); let bf = fract(bq);
    let jt = ss(0., .05, min(min(bf.x, 1. - bf.x) * .56, min(bf.y, 1. - bf.y) * .3));
    alb = mix(vec3f(.30, .14, .08), vec3f(.50, .27, .15), h2(floor(bq) + sd * 7.)) * (.72 + .4 * vn(uv * 6.)) * mix(1., .55 + .45 * jt, fN) * (.82 + .18 * step(.32, vn(uv * 26.)));
  }
  else if (mat == 59) { alb = vec3f(.64, .62, .56) * (.78 + .3 * vn(uv * 1.6 + sd * 5.)); alb = mix(alb, vec3f(.27, .26, .23), ss(.58, .82, vn(uv * .8 + sd * 9.)) * .7); }      // old stucco
  else if (mat == 60) {      // dark lacquered teak, stencilled in gold (ลายคำ)
    alb = vec3f(.11, .04, .025) * (.8 + .3 * vn(vec2f(uv.x * 3., uv.y * 30.)));
    let st = ss(.62, .7, vn(uv * 9. + sd * 3.)) * step(.5, fract(uv.y * 1.6 + .25)); alb = mix(alb, vec3f(.86, .62, .14), st * .85); gloss = .35 + st * .3;
  }
  else if (mat == 61) { alb = vec3f(.42, .03, .05) * (.8 + .2 * sin(uv.x * 30.)); let gb = step(fract(uv.y * .9), .07); alb = mix(alb, vec3f(.86, .64, .16), gb); emi = alb * .35; }      // the stage's backdrop: red velvet, bands of gold, lit from the front
  else if (mat == 62) { alb = vec3f(.2, 0., 0.); emi = vec3f(1., .04, .02) * 12. * step(.55, fract(g.cam.w * .45 + sd)); }      // a red light on a tall building, blinking
  else if (mat == 63) {      // a coloured bulb
    var bc = vec3f(1., .75, .35); if (sd > .3) { bc = vec3f(1., .25, .35); } if (sd > .5) { bc = vec3f(.35, .7, 1.); } if (sd > .7) { bc = vec3f(.5, 1., .45); } if (sd > .85) { bc = vec3f(.9, .45, 1.); }
    alb = bc * .5; emi = bc * 7. * (.85 + .15 * sin(g.cam.w * 3. + sd * 50.));
  }
  else if (mat == 65) {      // a city tower: bands of glass between the floors, some windows lit (warm or cool white), most dark at this hour
    var hx = i.lp.x; if (abs(i.ln.x) > .5) { hx = i.lp.z; }
    let y0 = i.lp.y + i.m.z * .5; let cw = mix(1.6, 2.8, fract(sd * 7.)); let fx = fract(hx / cw + .5); let fy = fract(y0 / 3.4); let fl = floor(y0 / 3.4); let cl = floor(hx / cw + .5);
    let win = step(.12, fx) * step(fx, .88) * step(.30, fy) * step(fy, .86) * (1. - step(.5, abs(i.ln.y)));
    let wall = mix(vec3f(.30, .31, .33), vec3f(.55, .52, .47), fract(sd * 3.3)) * (.75 + .25 * vn(vec2f(hx * .3 + sd * 9., y0 * .05)));
    let hr = h2(vec2f(cl + sd * 31., fl + sd * 17.)); let lit = step(.72, hr) * step(.2, h2(vec2f(floor(cl / 3.) + sd * 5., floor(fl / 2.))));
    let wc = mix(vec3f(1., .72, .42), vec3f(.75, .85, 1.), step(.9, hr));
    alb = mix(wall, vec3f(.03, .045, .06), win); emi = wc * lit * win * .9 * (1. - ss(.62, .86, fy) * .4); gloss = win * .6;
    if (sd > .55 && abs(i.ln.y) < .5) {      // flats: a balcony on every floor, its slab pale, a railing of bars, plants and washing in some
      let fb = fract(y0 / 3.4); let slab = step(fb, .08); let rail = step(.08, fb) * step(fb, .3);
      alb = mix(alb, vec3f(.72, .71, .68), slab); alb = mix(alb, mix(alb * .6, vec3f(.62, .62, .6), step(.5, fract(hx * 5.))), rail * .8);
      alb = mix(alb, pal2(h2(vec2f(floor(hx / cw + .5), fl + sd * 7.))), rail * step(.86, h2(vec2f(floor(hx / cw + .5) * 3.1, fl))) * .7);
    }
    if (i.ln.y > .5) { alb = vec3f(.2, .2, .21); }
  }
  else if (mat == 66) {      // a clipped hedge: small leaves in many greens, darker low down where the light does not reach
    var lq = uv * 9.; if (abs(i.ln.y) > .5) { lq = i.lp.xz * 9.; } let lv = vn(lq) * .6 + vn(lq * 2.7) * .4;
    alb = mix(vec3f(.025, .07, .02), vec3f(.08, .19, .05), lv) * (.6 + .5 * ss(-.5, .5, i.lp.y / max(i.m.z, .1)));
    if (TOON > .5) { alb = mix(vec3f(dot(alb, vec3f(.3, .6, .1))), alb, 1.4) * vec3f(1., 1.15, .95); }
  }
  else if (mat == 67) {      // a sign board with Thai lettering from the page's atlas (seed: which sign); the board is 7.5 times as wide as it is high
    let slot = i32(sd + .5); let hh = max(i.m.z, .01); var u = i.lp.x / (hh * 7.5) + .5; if (i.ln.z < -.5) { u = 1. - u; }
    let v = .5 - i.lp.y / hh; let cell = vec2f(f32(slot % 2), f32(slot / 2));
    var q = vec2f(clamp(u, .004, .996), clamp(v, .02, .98)); if (abs(i.ln.z) < .5) { q = vec2f(.02, .5); }
    alb = textureSampleLevel(tSign, sSign, (cell + q) / vec2f(2., 16.), 0.).rgb; emi = alb * night * 1.1; gloss = .25;
  }
  else if (mat == 68) {      // a colonial palace front: cream-yellow render, white pilasters between bays, cornices, tall arched windows, floodlit
    let hh = i.m.z * .5; let y0 = i.lp.y + hh; var hx = i.lp.x; if (abs(i.ln.x) > .5) { hx = i.lp.z; }
    let fx = fract(hx / 3.6 + .5); let fy = fract(y0 / 5.); let fl = floor(y0 / 5.);
    alb = vec3f(.86, .72, .40) * (.9 + .1 * vn(uv * 1.5 + sd * 9.));
    let trim = max(step(min(fx, 1. - fx), .07), max(step(fy, .07), step(.95, fy)) * step(.5, y0));
    alb = mix(alb, vec3f(.93, .91, .85), trim);
    let q = vec2f(fx - .5, fy - .42); let win = step(abs(q.x), .17) * step(-.27, q.y) * select(step(length(vec2f(q.x, q.y - .1)), .17), 1., q.y < .1);
    let lit = step(.45, h2(vec2f(floor(hx / 3.6 + .5) + sd * 13., fl + 3.)));
    alb = mix(alb, vec3f(.05, .06, .08), win * step(.5, abs(i.ln.y) * -1. + 1.));
    emi = alb * (.16 + .14 * ss(9., 0., y0)) * (1. - win) + vec3f(1., .75, .42) * win * lit * night * 1.1;
    if (i.ln.y > .5) { alb = vec3f(.5, .48, .44); emi = vec3f(0.); }
  }
  else if (mat == 64) { alb = vec3f(.6, .58, .54) * (.85 + .2 * vn(uv * 2.)); emi = vec3f(1., .78, .45) * .22 * (.8 + .2 * vn(uv * .5)); }      // concrete under floodlights
`,
  // fragment-side functions of the page's own. head() and fsSky are asked for by the engine; the rest is the lamps, the glow on the water and the fireworks
  scene: /* wgsl */`
// the lamps: every lantern, bulb and candle near enough lights what is round it, fading to nothing at its reach
fn lamps(wp: vec3f, n: vec3f) -> vec3f {
  var c = vec3f(0.); let cnt = i32(g.camM.z);
  for (var k = 0; k < cnt; k++) {
    let l = g.lp[k]; let v = l.xyz - wp; let d2 = dot(v, v); let r2 = l.w * l.w; if (d2 > r2) { continue; }
    let a = 1. - d2 / r2; c += g.lc[k].rgb * (a * a / (1. + d2 * g.lc[k].w)) * (max(dot(n, v * inverseSqrt(max(d2, 1e-4))), 0.) * .8 + .2);
  }
  return c;
}
fn head(wp: vec3f, n: vec3f) -> vec3f { return lamps(wp, n); }
// what people wear to the fair: white and cream most of all, then strong plain colours
fn cloth(h: f32) -> vec3f {
  var c = vec3f(.74, .72, .66); if (h > .26) { c = vec3f(.62, .13, .12); } if (h > .38) { c = vec3f(.13, .25, .50); } if (h > .50) { c = vec3f(.76, .48, .08); }
  if (h > .62) { c = vec3f(.16, .38, .24); } if (h > .74) { c = vec3f(.68, .32, .46); } if (h > .86) { c = vec3f(.38, .21, .48); } return c;
}
fn sdb(P: vec2f, c: vec2f, h: vec2f) -> f32 { let q = abs(P - c) - h; return max(q.x, q.y); }
// a soft patch of light laid on the water under each candle (drawn added to the picture): m.x how bright, m.y and m.z its size
@fragment fn fsGlow(i: XO) -> @location(0) vec4f {
  let q = vec2f(i.lp.x / (i.m.y * .5), i.lp.z / (i.m.z * .5)); let r2 = dot(q, q); if (r2 > 1. || i.ln.y < .5) { discard; }
  let t = g.cam.w; let a = (1. - r2) * (1. - r2);
  let rip = ss(.30, .62, vn(vec2f(i.wp.x * 6. + t * .7, i.wp.z * 6. - t * .5))) * (.6 + .4 * vn(i.wp.xz * 17. + t));
  let d = distance(g.cam.xyz, i.wp);
  return vec4f(vec3f(1., .52, .15) * (a * rip * i.m.x * exp(-d * g.fog.x)), 1.);
}
// a firework: a ring of sparks flung out from one point, sagging as they slow, each trailing a little light
fn firework(rd: vec3f, F: vec4f) -> vec3f {
  if (F.z <= 0. || F.z > 3.4) { return vec3f(0.); }
  let C = vec3f(cos(F.y) * cos(F.x), sin(F.y), cos(F.y) * sin(F.x)); let dc = dot(rd, C); if (dc < .93) { return vec3f(0.); }
  let T1 = normalize(cross(C, vec3f(0., 1., 0.))); let T2 = cross(T1, C);
  var q = vec2f(dot(rd, T1), dot(rd, T2)) / dc; let a = F.z;
  let R = .15 * (1. - exp(-a * 2.2)); q.y += .010 * a * a;
  let ang = atan2(q.y, q.x); let n = 44.; let id = round(ang / 6.2832 * n); let ca = id / n * 6.2832;
  let hr = h2(vec2f(id + 60., F.w * 91.)); let rk = R * (.45 + .55 * hr); let rr = length(q);
  let dq = q - vec2f(cos(ca), sin(ca)) * rk;
  let spark = exp(-dot(dq, dq) / .0000035);
  let across = sin(ang - ca) * rr; let trail = exp(-across * across / .0000012) * ss(rk * .5, rk, rr) * step(rr, rk);
  let fade = ss(3.4, 1.0, a) * ss(0., .08, a); let hue = fract(F.w * 7.3);
  var col = vec3f(1., .72, .32); if (hue < .25) { col = vec3f(1., .28, .22); } else if (hue < .5) { col = vec3f(.42, 1., .52); } else if (hue < .7) { col = vec3f(.55, .62, 1.); }
  return col * ((spark * 7. + trail * 1.1) * fade * (.6 + .4 * sin(a * 31. + hr * 50.)) + exp(-rr * rr / .0005) * 4. * ss(.3, 0., a));
}
// the hills on the horizon (how high they rise, in radians, toward hd); at Chiang Mai the mountains are high, highest toward Doi Suthep
const DOI = vec2f(-.41, .91);
fn ridge(hd: vec2f) -> f32 {
  var m = (.018 + .05 * fbm(hd * 2.3 + 3.) + .01 * fbm(hd * 11. + 7.)) * HILLS;
  if (PLACE == 2) { m *= .55 + 1.15 * pow(max(dot(hd, DOI), 0.), 2.); }
  return m;
}
@group(0) @binding(3) var tSign: texture_2d<f32>;
@group(0) @binding(4) var sSign: sampler;
// ---- the people, in the painted style: clean colours, light in two tones with a soft edge, a rim of light round them against the night
fn skinC(t: f32) -> vec3f { return mix(vec3f(.86, .62, .48), vec3f(.56, .36, .25), t); }
fn hairC(h: f32) -> vec3f { var c = vec3f(.035, .03, .045); if (h > .78) { c = vec3f(.13, .075, .05); } if (h > .93) { c = vec3f(.30, .18, .10); } if (h > .985) { c = vec3f(.62, .62, .66); } return c; }
fn festC(h: f32) -> vec3f {      // what people wear to the fair: cream and white most, then clear festive colours
  var c = vec3f(.92, .88, .80); if (h > .24) { c = vec3f(.88, .28, .30); } if (h > .36) { c = vec3f(.22, .40, .82); } if (h > .48) { c = vec3f(.96, .72, .22); }
  if (h > .60) { c = vec3f(.26, .66, .52); } if (h > .72) { c = vec3f(.94, .56, .70); } if (h > .84) { c = vec3f(.56, .40, .82); } if (h > .93) { c = vec3f(.98, .55, .25); } return c;
}
@fragment fn fsBlock(i: BKO) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let v = i.v; let ln = i.ln; var alb = vec3f(.5);
  let front = ln.z > .5; let side = abs(ln.x) > .5;
  // the place on the face in a grid of 12 x 12 (0, 0 at the lower left): faces and patterns are drawn in it like pixel art
  var fu = v.x; if (side) { fu = v.z; } if (abs(ln.y) > .5) { fu = v.x; }
  let gx = floor(clamp(fu * .5 + .5, 0., .999) * 12.); let gy = floor(clamp(v.y * .5 + .5, 0., .999) * 12.);
  if (mat == 0) { alb = skinC(sd); }                                                     // skin (sd: how dark)
  else if (mat == 1) { alb = hairC(sd) * (1. + .25 * step(.6, v.y) * step(.5, ln.z)); }  // hair
  else if (mat == 2 || mat == 3) {                                                       // a shirt or a blouse; the neck showing at the collar; 3: a sabai over one shoulder
    alb = festC(sd);
    if (mat == 3 && abs(ln.y) < .5) { let d = v.x * .6 + v.y * .8 - .1; if (abs(d) < .38) { alb = festC(fract(sd * 7.31 + .37)) * (.88 + .12 * step(.5, fract((v.x - v.y) * 3.))); } if (abs(abs(d) - .38) < .07) { alb = vec3f(.95, .74, .26); } }
    if (front && v.y > .72 && abs(v.x) < .28 - (1. - v.y) * .6) { alb = skinC(i.m.z); }
    if (ln.y > .5) { alb = mix(alb, skinC(i.m.z), step(length(v.xz * vec2f(1., 1.6)), .5)); }
  }
  else if (mat == 4) {                                                                   // a pha sin: fine upright stripes, a broad patterned hem
    alb = festC(fract(sd * 3.1)) * .62 * (.86 + .14 * step(.5, fract(fu * 6.)));
    if (v.y < -.55 && i.m.w < .5) { alb = mix(vec3f(.92, .70, .24), vec3f(.55, .12, .14), step(.5, fract(gx * .5 + gy * .5))); }
  }
  else if (mat == 5) { alb = mix(vec3f(.12, .14, .22), vec3f(.36, .28, .20), sd); if (v.y > .82) { alb *= .5; } }      // trousers, a belt at the top
  else if (mat == 6) { alb = vec3f(.10, .08, .08); if (v.y < -.5) { alb = vec3f(.6, .58, .55); } }                       // shoes, pale soles
  else {                                                                                 // the head (8: long hair): a face in pixels on the front, hair over the rest
    alb = skinC(sd); let hair = hairC(fract(sd * 17.31)); var hm = 0.;
    if (front) {
      hm = step(9., gy) + step(8., gy) * (step(gx, 2.) + step(9., gx) + step(abs(gx - 5.5), .6)) + (step(gx, 0.) + step(11., gx)) * step(mix(5., 1., f32(mat == 8)), gy);
      let ex = step(abs(gx - 3.5), .6) + step(abs(gx - 7.5), .6);
      if (ex > .5 && gy >= 4. && gy <= 6.) { alb = select(vec3f(.26, .15, .09), vec3f(.04, .03, .05), gy > 5.5); if ((gx == 3. || gx == 7.) && gy == 5.) { alb = vec3f(1.); } }
      if (gy == 3. && (gx == 2. || gx == 9.)) { alb = mix(alb, vec3f(1., .5, .5), .55); }
      if (gy == 2. && (gx == 5. || gx == 6.)) { alb = vec3f(.6, .24, .24); }
    } else if (side) { hm = step(mix(5., 1., f32(mat == 8)), gy) + step(v.z, -.2); }
    else if (ln.y > .5 || ln.z < -.5) { hm = 1.; }
    if (hm > .5) { alb = hair * (1. + .2 * step(10., gy) * f32(front)); }
  }
  let n = normalize(i.n); let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let band = mix(.3, 1., ss(-.04, .1, dot(n, L)) * shadow(i.wp + n * .06));      // two tones, a soft edge between
  let lm = head(i.wp, n);
  var c = alb * (sky(n) * 1.15 + g.sunCol.rgb * band + min(lm, vec3f(1.8)) * .6);
  c += pow(1. - max(dot(n, V), 0.), 4.) * (g.hor.rgb * 1.3 + min(lm, vec3f(2.)) * .08 + vec3f(.01, .015, .035));      // rim light
  return vec4f(fogged(c, i.wp), 1.);
}
// the sky: a full moon, stars, a little thin cloud, far lanterns rising, now and then a firework
@fragment fn fsSky(i: SO) -> @location(0) vec4f {
  let rd = normalize(g.fwd.xyz + g.right.xyz * (i.q.x * g.right.w) + g.up.xyz * (i.q.y * g.up.w));
  let y = max(rd.y, 0.); let hz = horizon(rd); let t = g.cam.w;
  var c = mix(hz, g.zen.rgb, pow(ss(0., .8, y), .55));
  let sd = max(dot(rd, g.sun.xyz), 0.);
  let cq = (rd.xz * (900. / max(rd.y, .03))) * .00055 + vec2f(t * .0018, 0.);
  let dn = fbm(cq) * .65 + fbm(cq * 3.1 + 5.) * .35;
  var cov = ss(.50, .82, dn) * ss(0., .14, rd.y) * g.fog.z;
  let toonC = ss(.53, .58, dn) * ss(0., .14, rd.y) * g.fog.z;
  let mq2 = normalize(g.sun.xz + vec2f(1e-4)) * .02; let rim = ss(.0, .06, dn - (fbm(cq - mq2) * .65 + fbm((cq - mq2) * 3.1 + 5.) * .35));
  cov = mix(cov, toonC, TOON);
  let sq = rd.xz / max(rd.y, .08) * 150.; let hh = h2(floor(sq)); let sf = fract(sq) - .5;
  c += vec3f(.85, .9, 1.) * step(.9965, hh) * ss(.5, .15, length(sf)) * (.15 + .55 * fract(hh * 311.)) * (.7 + .3 * sin(t * (1. + hh * 9.) + hh * 80.)) * ss(.03, .25, rd.y) * (1. - cov) * (1. - ss(.9, .995, sd)) * (1. - .7 * CITY);
  c += vec3f(.72, .80, 1.) * (pow(sd, 350.) * .20 + pow(sd, 30.) * .03);                     // the glow round the moon
  let cloudCol = mix(g.amb.rgb * 1.6 + vec3f(.5, .56, .7) * (pow(sd, 6.) * .22 + .015), mix(g.zen.rgb * 2.6 + vec3f(.05, .05, .09), vec3f(.62, .66, .86) * (.35 + .65 * pow(sd, 3.)), rim * .55) + vec3f(.04, .045, .08) * ss(.55, .75, dn), TOON);
  c = mix(c, cloudCol, cov * mix(.85, .95, TOON));
  let T1 = normalize(cross(g.sun.xyz, vec3f(0., 1., 0.))); let T2 = cross(T1, g.sun.xyz);
  let mq = vec2f(dot(rd, T1), dot(rd, T2)) / .020; let mr = length(mq);
  let seas = ss(.40, .62, fbm(mq * 1.5 + 4.));
  c = mix(c, vec3f(1., .96, .86) * (5.2 - 2.0 * seas) * (1. - .22 * mr * mr), ss(1., .92, mr) * step(.5, sd) * (1. - cov * .55));
  // sky lanterns let go all over the country round: small warm lights, hundreds of them (thousands at Yi Peng), climbing slowly
  let az = atan2(rd.z, rd.x); var fl = 0.;
  for (var k = 0; k < 3; k++) {
    let fk = f32(k); let sc = mix(140., 330., fk * .5);
    // spaced by angle, so that they lie as evenly overhead as low down: each row (of elevation) takes its spacing round the sky from its own middle,
    // the same all along the row (were it to change smoothly with height, the lanterns would be sheared into slanting streaks)
    let ey = asin(clamp(rd.y, 0., .999)); let off = -t * mix(.035, .015, fk * .5) + fk * 13.; let ly = ey * sc * .55 + off;
    let rowEl = (floor(ly) + .5 - off) / (sc * .55); let lq = vec2f(az / 6.2832 * sc * max(cos(clamp(rowEl, 0., 1.5)), .25), ly);
    let id = floor(lq); let h = h2(id + fk * 31.);
    let ctr = vec2f(.5) + (vec2f(h2(id + 3.1), h2(id + 7.7)) - .5) * vec2f(.7, .3); let d = length((fract(lq) - ctr) * vec2f(1., .29));
    let dens = min((.03 + .09 * ss(.35, .7, fbm(vec2f(az * 1.3 + 2., fk * 5.)))) * SKYL * select(1., ss(.8, 1.6, SKYL), k == 2), .45);
    fl += step(1. - dens, h) * ss(mix(.085, .05, fk * .5), 0., d) * mix(1., .45, fk * .5) * (.75 + .25 * sin(t * 2. + h * 60.));
  }
  c += vec3f(1., .5, .14) * fl * 1.7 * ss(.015, .08, rd.y) * (1. - ss(1.05, 1.4, asin(clamp(rd.y, 0., 1.)))) * (1. - cov * .5);
  c += firework(rd, g.fwA) + firework(rd, g.fwB);
  c += vec3f(.9, .42, .16) * .06 * CITY * (1. - .6 * TOON) * exp(-y * 9.);                                         // the city's glow on the haze
  let hd = normalize(vec3f(rd.x, 0., rd.z) + vec3f(1e-5, 0., 0.)).xz;
  let m1 = ridge(hd);
  c = mix(c, hz * .5, ss(m1 + .003, m1, rd.y));
  if (PLACE == 2) {      // the temple on Doi Suthep: a small gold light just under the top of the ridge
    let e0 = ridge(DOI) - .006; let q = vec3f(DOI.x * cos(e0), sin(e0), DOI.y * cos(e0)); let a = max(dot(rd, q), 0.);
    c += vec3f(1., .68, .3) * (pow(a, 120000.) * 5. + pow(a, 6000.) * .2);
  }
  return vec4f(mix(hz * .8, c, ss(-.02, .02, rd.y)), 1.);
}
`,
};

// --------------------------------------------------------------------------------------------------------- pipelines
await LD.step('กำลังคอมไพล์ shader', 12);
// Signs with real Thai lettering: each sign is drawn with the page's Thai font into one cell of an atlas (a canvas, 2 x 16 cells of 512 x 64),
// sent to the GPU as a texture, and painted on its board by the box material 67 (seed: which cell). SIGNS: [the words, board, letters].
const SIGNS = [], SIGN_TEX = device.createTexture({ size: [1024, 1024], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
const sign = (text, bg = '#b8282e', fg = '#fff6dc') => { SIGNS.push([text, bg, fg]); return SIGNS.length - 1; };
async function drawSigns() {
  await Promise.race([document.fonts.load('700 40px Sarabun'), new Promise((ok) => setTimeout(ok, 2500))]).catch(() => {});
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024; const c = cv.getContext('2d');
  SIGNS.forEach(([text, bg, fg], i) => {
    const x = (i % 2) * 512, y = floor(i / 2) * 64;
    c.fillStyle = bg; c.fillRect(x, y, 512, 64);
    c.strokeStyle = 'rgba(255,240,200,.55)'; c.lineWidth = 3; c.strokeRect(x + 5, y + 5, 502, 54);
    let size = 40; c.font = `700 ${size}px Sarabun, "Noto Sans Thai", Thonburi, sans-serif`;
    while (c.measureText(text).width > 470 && size > 18) { size -= 2; c.font = `700 ${size}px Sarabun, "Noto Sans Thai", Thonburi, sans-serif`; }
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x + 256, y + 35);
  });
  Q.copyExternalImageToTexture({ source: cv }, { texture: SIGN_TEX }, [1024, 1024]);
}
const GFX = await Engine.renderer(GPU, { floats: 92 + NL * 8, pcf: PCF, maxDpr: LOW ? 1 : 1.5, wgsl: WGSL,
  sceneBindings: [{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} }] });
const { UBN, UB, UBS, ubo, uboS, sceneGroup, bgShadow, plScene, LB_BOX, pTerrain, pBranch, pBox, LODN, pLeaf, pSky, pBoxS, pTerrainS,
  pBranchS, pLeafS, pLeafS2, ADD, uFinal, SIDES, tubeI, vbuf, vbTube, ibTube, vbCube, ibCube, mScene, post } = GFX;
const bgScene = sceneGroup(ubo, [{ binding: 3, resource: SIGN_TEX.createView() }, { binding: 4, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }]);
// light added over the picture (the candles' glow on the water): tested against what is already drawn, written to no depth
const pGlow = device.createRenderPipeline({ layout: plScene, vertex: { module: mScene, entryPoint: 'vsBox', buffers: LB_BOX },
  fragment: { module: mScene, entryPoint: 'fsGlow', targets: [{ format: HDR, blend: ADD }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' }, multisample: { count: AA },
  depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'less' } });
// the people are drawn with blocks of their own (vsBlock / fsBlock): the engine's cube and the box layout
const pPart = GFX.scenePipe('vsBlock', 'fsBlock', LB_BOX), pPartS = GFX.shadowPipe('vsBlock', LB_BOX);
let W = 0, H = 0, scale = 1, vMS, vDepth, vScene;
function resize() { ({ W, H, vMS, vDepth, vScene } = GFX.resize(scale)); }
const vShadowT = GFX.vShadow;

// --------------------------------------------------------------------------------------------------------- plants
await LD.step('กำลังปลูกต้นไม้', 26);
const TREES = [
  makeTree(11, { H: 8, r: 0.34, n: [9, 5, 3], ang: [1.1, 0.9, 0.85], crown: 0.32, len0: 0.5, lenR: 0.6, trop: 0.2, wob: 0.2, per: 5, leaf: 0.62, wide: 0.3 }),
  makeTree(23, { H: 10, r: 0.4, n: [10, 5, 3], ang: [1.15, 0.9, 0.85], crown: 0.38, len0: 0.46, lenR: 0.6, trop: 0.18, wob: 0.22, per: 5, leaf: 0.66, wide: 0.3 }),
  makeTree(37, { H: 6.5, r: 0.26, n: [8, 4, 3], ang: [1.2, 0.95, 0.85], crown: 0.28, len0: 0.6, lenR: 0.62, trop: 0.14, wob: 0.26, per: 5, leaf: 0.56, wide: 0.3 }),
  makePalm(71), makePalm(79), makeSugarPalm(91), makeSugarPalm(97), makeBanana(105), makeBush(121, false), makeBush(127, true),
  // a rain tree (จามจุรี): short thick trunk under a wide flat umbrella; and a tall forest tree with a clean bole and a high crown
  makeTree(53, { H: 8.5, r: 0.52, n: [11, 6, 3], ang: [1.38, 1.0, 0.9], crown: 0.34, len0: 0.9, lenR: 0.6, trop: 0.04, wob: 0.26, per: 5, leaf: 0.55, wide: 0.3 }),
  makeTree(67, { H: 17, r: 0.44, n: [10, 5, 3], ang: [1.05, 0.9, 0.85], crown: 0.62, len0: 0.3, lenR: 0.6, trop: 0.2, wob: 0.14, per: 5, leaf: 0.64, wide: 0.3 }),
];

// --------------------------------------------------------------------------------------------------------- krathongs and lanterns
// A krathong is a list of tubes round its own middle: [x0 y0 z0 r0, x1 y1 z1 r1, material]. A tube that ends at radius 0 is a cone, so
// petals, folded leaf points and flower heads are all cones; a very short cone is a disc. Four kinds:
// 0 folded banana leaf with marigolds · 1 a lotus · 2 baked bread (the fish eat it) · 3 orchids
const KNAME = [['กระทงใบตอง', 'ใบตองพับกลีบ ดาวเรืองรอบเทียน'], ['กระทงดอกบัว', 'กลีบบัวสีชมพูซ้อนสองชั้น'], ['กระทงขนมปัง', 'ลอยแล้วปลากินได้ ไม่เหลือขยะ'], ['กระทงกล้วยไม้', 'กล้วยไม้ม่วงกับกลีบขาว']];
function krathongT(kind) {
  const T = [], t = (...a) => T.push(a);
  const ring = (n, r, len, el, mat, y, rad, off = 0) => { for (let k = 0; k < n; k++) { const a = k / n * TAU + off, dx = cos(a), dz = sin(a), q = r + len * cos(el); t(dx * r, y, dz * r, rad, dx * q, y + len * sin(el), dz * q, 0.002, mat); } };
  const bloom = (x, z, mat, s = 1) => { t(x, 0.05, z, 0.016 * s, x, 0.072, z, 0.022 * s, mat); t(x, 0.072, z, 0.022 * s, x, 0.084, z, 0.003, mat); };
  const base = kind === 2 ? 15 : 10;
  t(0, -0.012, 0, 0.112, 0, 0.048, 0, 0.12, base); t(0, 0.048, 0, 0.12, 0, 0.056, 0, 0.003, base);
  if (kind === 0) { ring(14, 0.105, 0.085, 0.85, 10, 0.03, 0.03); ring(10, 0.075, 0.07, 1.15, 10, 0.05, 0.024, 0.3); for (let k = 0; k < 6; k++) bloom(cos(k * 1.047) * 0.058, sin(k * 1.047) * 0.058, 11); bloom(0.03, 0.03, 13, 0.8); bloom(-0.035, 0.02, 18, 0.7); }
  else if (kind === 1) { ring(12, 0.10, 0.09, 0.7, 12, 0.03, 0.034); ring(9, 0.07, 0.085, 1.05, 12, 0.05, 0.03, 0.35); ring(6, 0.04, 0.07, 1.3, 18, 0.055, 0.024, 0.1); bloom(0.03, 0.035, 11, 0.8); bloom(-0.03, 0.03, 11, 0.8); }
  else if (kind === 2) { ring(12, 0.108, 0.035, 0.5, 15, 0.035, 0.032); for (let k = 0; k < 8; k++) bloom(cos(k * 0.785) * 0.075, sin(k * 0.785) * 0.075, [12, 11, 18, 13][k % 4], 0.9); bloom(0.03, 0.03, 12, 0.8); bloom(-0.03, 0.03, 11, 0.8); }
  else { ring(14, 0.105, 0.07, 0.8, 10, 0.03, 0.028); ring(10, 0.08, 0.075, 0.95, 13, 0.05, 0.028, 0.3); ring(7, 0.05, 0.06, 1.25, 18, 0.055, 0.022, 0.1); bloom(0.03, 0.035, 11, 0.8); bloom(-0.032, 0.028, 13, 0.8); }
  t(0, 0.05, 0, 0.011, 0, 0.185, 0, 0.009, 14);
  for (const [ix, iz] of [[-0.03, -0.02], [0.03, -0.025], [0, -0.045]]) t(ix, 0.05, iz, 0.0025, ix * 1.25, 0.26, iz * 1.3, 0.002, 16);
  return T;
}
const KT = [0, 1, 2, 3].map(krathongT);
// Stamps a krathong into the tube list o, starting at tube n; returns the next free tube. lit: a flame on the candle and a glow on each
// incense stick. fs: the flame drawn larger (far off, so that it is never smaller than a pixel). low: only the base, for the far ones.
function putK(o, n, T, x, y, z, yaw, sc, lit, fs = 1, low = false) {
  const c = cos(yaw) * sc, s = sin(yaw) * sc, m = low ? 2 : T.length;
  for (let i = 0; i < m; i++) {
    const a = T[i], k = n * 10; n++;
    o[k] = x + a[0] * c - a[2] * s; o[k + 1] = y + a[1] * sc; o[k + 2] = z + a[0] * s + a[2] * c; o[k + 3] = a[3] * sc;
    o[k + 4] = x + a[4] * c - a[6] * s; o[k + 5] = y + a[5] * sc; o[k + 6] = z + a[4] * s + a[6] * c; o[k + 7] = a[7] * sc; o[k + 8] = -1; o[k + 9] = a[8];
  }
  if (lit) {
    const fy = y + 0.185 * sc; o.set([x, fy, z, 0.012 * sc * fs, x, fy + 0.055 * sc * fs, z, 0.001, -1, 9], n * 10); n++;
    if (!low) for (let i = T.length - 3; i < T.length; i++) { const a = T[i], px = x + a[4] * c - a[6] * s, pz = z + a[4] * s + a[6] * c; o.set([px, y + a[5] * sc, pz, 0.004 * sc, px, y + (a[5] + 0.008) * sc, pz, 0.001, -1, 9], n * 10); n++; }
  }
  return n;
}
// a sky lantern (โคมลอย): a tall paper drum, wider at the top, open below where the flame burns. Four kinds of paper:
// 0 plain white (warm once lit) · 1 red · 2 gold · 3 printed with lotuses. LIT_M, PAPER_M: the tube material lit and not yet lit.
const LNAME = [['โคมขาว', 'กระดาษสาสีขาว แบบดั้งเดิม'], ['โคมแดง', 'สีแดงนำโชค'], ['โคมทอง', 'สีทองสว่างไสว'], ['โคมลายบัว', 'กระดาษสาพิมพ์ลายดอกบัว']];
const LIT_M = [8, 23, 24, 25], PAPER_M = [20, 26, 27, 28];
function putLantern(o, n, x, y, z, s, lit, low = false, kind = 0) {
  const m = lit ? LIT_M[kind] : PAPER_M[kind];
  o.set([x, y, z, 0.25 * s, x, y + 0.85 * s, z, 0.35 * s, -1, m], n * 10); n++;
  if (low) return n;
  o.set([x, y + 0.85 * s, z, 0.35 * s, x, y + 0.92 * s, z, 0.01, -1, m], n * 10); n++;
  if (lit) { o.set([x, y + 0.02, z, 0.07 * s, x, y + 0.2 * s, z, 0.005, -1, 9], n * 10); n++; }
  return n;
}

// --------------------------------------------------------------------------------------------------------- the world
// The land is cut into pieces 64 m square, each with its own ground mesh and its own lists of what stands on it (tubes, boxes, leaves),
// so that what is off the screen need not be drawn and leaves far away can be thinned.
await LD.step('กำลังปั้นพื้นดินและสายน้ำ', 34);
const CH = 64, GN = 32, GS = CH / GN, CX0 = -7, CX1 = 6, CZ0 = -3, CZ1 = 4;
const gridI = new Uint16Array(GN * GN * 6);
for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) { const a = j * (GN + 1) + i, b = a + 1, c = a + GN + 1, d = c + 1; gridI.set([a, c, b, b, c, d], (j * GN + i) * 6); }
const ibGrid = vbuf(gridI, GPUBufferUsage.INDEX);
const chunks = new Map();
const bk = (x, z) => { const cx = clamp(floor(x / CH), CX0, CX1), cz = clamp(floor(z / CH), CZ0, CZ1), k = cx + ',' + cz; let c = chunks.get(k);
  if (!c) { c = { cx, cz, x: (cx + 0.5) * CH, z: (cz + 0.5) * CH, segs: [], far: [], leaves: [], boxes: [] }; chunks.set(k, c); } return c; };
{ const N = GN + 1, M = GN + 3, hg = new Float32Array(M * M), hwet = new Float32Array(M * M);
  for (let cz = CZ0; cz <= CZ1; cz++) for (let cx = CX0; cx <= CX1; cx++) {
    const ox = cx * CH, oz = cz * CH, v = new Float32Array(N * N * 7);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { hg[j * M + i] = ground(ox + (i - 1) * GS, oz + (j - 1) * GS); hwet[j * M + i] = gw[0]; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j + 1) * M + i + 1, nx = hg[k - 1] - hg[k + 1], nz = hg[k - M] - hg[k + M], l = hypot(nx, 2 * GS, nz);
      v.set([ox + i * GS, hg[k], oz + j * GS, nx / l, 2 * GS / l, nz / l, hwet[k]], (j * N + i) * 7);
    }
    bk(ox + 1, oz + 1).vb = vbuf(v);
  } }
const R = rng(20261117 + PL.idx * 977);
const OBST = [], RECT = [], LAMPS = [];      // what stops the walker: circles [x, z, r] and rectangles [x0, z0, x1, z1]; and every lamp
const WARM = [2.6, 1.75, 0.85], LANT = [2.5, 1.25, 0.42], CANDLE = [2.2, 1.05, 0.3];
const lamp = (x, y, z, r, col, k = 0.12, fl = 0) => { const l = { x, y, z, r, c: col, k, fl, ph: LAMPS.length * 1.7, on: 1 }; LAMPS.push(l); return l; };
function plant(T, x, z, turn, sc, thin = 1, twigs = true, solid = 0) {
  if (LOW) { thin = min(4, thin + 1); twigs = false; }      // every other sprig, made wider; no fine twigs
  const b = bk(x, z), y = ground(x, z), c = cos(turn), sn = sin(turn), S = T.segs, Lf = T.leaves;
  const tr = (px, py, pz, o) => { o.push(x + (px * c - pz * sn) * sc, y + py * sc, z + (px * sn + pz * c) * sc); };
  const nS = twigs ? T.nSeg : (T.nSegMid || T.nSeg), lw = [1, 1, 1.5, 1.8, 2.1][thin];
  for (let i = 0; i < nS; i++) {
    const o = i < T.nSegFar ? b.far : b.segs, k = i * 10, made = S[k + 8] < -0.5;
    tr(S[k], S[k + 1], S[k + 2], o); o.push(S[k + 3] * sc); tr(S[k + 4], S[k + 5], S[k + 6], o); o.push(S[k + 7] * sc, made ? (S[k + 8] < -1.5 ? -2 - (-S[k + 8] - 2) * sc : -1) : S[k + 8] * sc, made ? S[k + 9] : S[k + 9] * sc);
  }
  for (let i = 0; i < T.nLeaf; i += thin) { const k = i * 12; tr(Lf[k], Lf[k + 1], Lf[k + 2], b.leaves); b.leaves.push(Lf[k + 3] * sc, Lf[k + 4] + turn, Lf[k + 5], Lf[k + 6] * sc * lw, Lf[k + 7], Lf[k + 8], Lf[k + 9], Lf[k + 10], Lf[k + 11] * sc); }
  if (solid) OBST.push([x, z, solid]);
}
// a box set down square to the world: centre, size, material, seed, tilt, shape (1 gable, 2 afloat), turn
const B0 = (x, y, z, sx, sy, sz, mat, seed = 0, tilt = 0, shape = 0, yaw = 0) => bk(x, z).boxes.push(x, y, z, yaw, sx, sy, sz, tilt, mat, seed, sy, shape);
const T0 = (x0, y0, z0, r0, x1, y1, z1, r1, mat) => bk(x0, z0).far.push(x0, y0, z0, r0, x1, y1, z1, r1, -1, mat);
// a building's own frame: everything is placed by (across, up, forward) from its middle and turned with it
const local = (cx, cy, cz, yaw) => {
  const c = cos(yaw), s = sin(yaw), Wd = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const raw = (lx, ly, lz, dyaw, sx, sy, sz, tilt, mat, seed = 0, h = sy, shape = 0) => { const q = Wd(lx, lz); bk(q[0], q[1]).boxes.push(q[0], cy + ly, q[1], yaw + dyaw, sx, sy, sz, tilt, mat, seed, h, shape); };
  const put = (lx, ly, lz, sx, sy, sz, mat, seed = 0, tilt = 0, shape = 0) => raw(lx, ly, lz, 0, sx, sy, sz, tilt, mat, seed, sy, shape);
  const tube = (lx0, y0, lz0, r0, lx1, y1, lz1, r1, mat) => { const a = Wd(lx0, lz0), b = Wd(lx1, lz1); T0(a[0], cy + y0, a[1], r0, b[0], cy + y1, b[1], r1, mat); };
  const stamp = (B, lx, ly, lz, s1 = 0, s2 = 0, fl = 0) => { for (const b of B) raw(lx + b[0], ly + b[1], lz + b[2], 0, b[3], b[4], b[5], b[6], b[7], b[7] === 1 || b[7] === 9 ? s2 : s1, b[4], fl ? 2 : b[8] || 0); };
  const lmp = (lx, ly, lz, r, col, k, fl) => { const q = Wd(lx, lz); return lamp(q[0], cy + ly, q[1], r, col, k, fl); };
  const block = (lx0, lz0, lx1, lz1) => { const a = Wd(lx0, lz0), b = Wd(lx1, lz1); RECT.push([min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]); };
  return { Wd, raw, put, tube, stamp, lamp: lmp, block, y: cy };
};
// a paper lantern on its string: the lit body, a dark cap above and below, a tassel
const lantern = (x, y, z, sd, s = 1) => { B0(x, y, z, 0.26 * s, 0.34 * s, 0.26 * s, 50, sd, 0, 0, sd * 5); B0(x, y + 0.19 * s, z, 0.17 * s, 0.05 * s, 0.17 * s, 4, 0, 0, 0, sd * 5); B0(x, y - 0.19 * s, z, 0.17 * s, 0.05 * s, 0.17 * s, 4, 0, 0, 0, sd * 5); B0(x, y - 0.33 * s, z, 0.03, 0.22 * s, 0.03, 14); };
// a string hung between two points, sagging, in pieces
const string = (x0, y0, z0, x1, y1, z1, sag, n = 6, r = 0.008) => { for (let i = 0; i < n; i++) { const a = i / n, b = (i + 1) / n; T0(mix(x0, x1, a), mix(y0, y1, a) - sag * 4 * a * (1 - a), mix(z0, z1, a), r, mix(x0, x1, b), mix(y0, y1, b) - sag * 4 * b * (1 - b), mix(z0, z1, b), r, 1); } };
const pushT = (o, src, n) => { for (let i = 0; i < n * 10; i++) o.push(src[i]); };
const tmpK = new Float32Array(80 * 10);
// a chedi's round body as a stack of tubes: [y0, r0, y1, r1, material], scaled by s from a foot at (cx, y, cz)
const profile = (cx, y, cz, s, prof) => { for (const [y0, r0, y1, r1, m] of prof) T0(cx, y + y0 * s, cz, r0 * s, cx, y + y1 * s, cz, r1 * s, m); };
const BELL = (m, sp) => [[1.2, 3.2, 2.6, 3.0, m], [2.6, 2.2, 3.7, 2.55, m], [3.7, 2.55, 4.8, 2.0, m], [4.8, 2.0, 5.8, 0.9, m], [5.8, 0.9, 6.8, 0.5, m], [6.8, 0.42, 11.7, 0.04, sp]];
const RUIN = PL.temple === 'ruin', LANNA = PL.temple === 'lanna', PARK = PL.temple === 'park';

// 1. the wall round the temple, with a post every few metres; open to the water, where a low balustrade runs. Among the ruins: a low wall of laterite.
await LD.step(RUIN ? 'กำลังบูรณะโบราณสถาน' : PARK ? 'กำลังจัดสวนริมน้ำ' : 'กำลังสร้างวัด', 42);
const wall = (x0, z0, x1, z1, hgt = 1.9) => {
  const len = hypot(x1 - x0, z1 - z0), n = max(1, Math.round(len / 6)), ax = abs(x1 - x0) > abs(z1 - z0);
  if (PARK) {      // the edge of the park, where the walker can go no further: a clipped hedge (box hedging), a flowering shrub in it now and then, a lamp post
    const n2 = max(1, Math.round(len / 3));
    for (let i = 0; i < n2; i++) { const t = (i + 0.5) / n2, cx = mix(x0, x1, t), cz = mix(z0, z1, t), l = len / n2 + 0.05, hh = 1.15 + 0.08 * sin(i * 1.7); B0(cx, hh / 2 - 0.05, cz, ax ? l : 0.95, hh, ax ? 0.95 : l, 66, R()); }
    for (let i = 0; i < len / 9; i++) { const t = (i + 0.3 + 0.4 * R()) / (len / 9), x = mix(x0, x1, t) + (ax ? 0 : (x0 > 0 ? -0.9 : 0.9)), z = mix(z0, z1, t) + (ax ? 0.9 : 0); if (z > 22) continue; plant(TREES[9], x, z, R() * TAU, 0.6 + R() * 0.2); }
    for (let i = 1; i < len / 14; i++) { const t = i / (len / 14), x = mix(x0, x1, t), z = mix(z0, z1, t); T0(x, 0, z, 0.06, x, 3.6, z, 0.05, 4); B0(x, 3.75, z, 0.3, 0.3, 0.3, 10); lamp(x, 3.6, z, 10, WARM, 0.1); }
    return;
  }
  if (RUIN) { for (let i = 0; i < n; i++) { const cx = mix(x0, x1, (i + 0.5) / n), cz = mix(z0, z1, (i + 0.5) / n), l = len / n + 0.02, hh = 0.7 + 0.5 * R(); B0(cx, hh / 2 - 0.1, cz, ax ? l : 0.7, hh, ax ? 0.7 : l, 58, R()); } return; }
  for (let i = 0; i < n; i++) { const cx = mix(x0, x1, (i + 0.5) / n), cz = mix(z0, z1, (i + 0.5) / n), l = len / n + 0.02; B0(cx, hgt / 2 - 0.15, cz, ax ? l : 0.3, hgt, ax ? 0.3 : l, 41); B0(cx, hgt - 0.12, cz, ax ? l : 0.46, 0.1, ax ? 0.46 : l, 41); }
  for (let i = 0; i <= n; i++) { const px = mix(x0, x1, i / n), pz = mix(z0, z1, i / n); B0(px, hgt / 2 + 0.05, pz, 0.5, hgt + 0.4, 0.5, 41); B0(px, hgt + 0.3, pz, 0.62, 0.1, 0.62, 41); B0(px, hgt + 0.48, pz, 0.26, 0.28, 0.26, LANNA ? 15 : 41); }
};
wall(-58, -66, -58, 44.6); wall(58, -66, 58, 44.6); wall(-58, -66, -3.4, -66); wall(3.4, -66, 58, -66);
for (const sx of [-1, 1]) {
  if (RUIN) { for (let x = 3.4; x < 56; x += 0.9) { B0(sx * x, 0.22, 44.6, 0.9, 0.44, 0.5, 58, R()); B0(sx * (x + (R() - 0.5) * 0.3), 0.475, 44.6 + (R() - 0.5) * 0.2, 0.035, 0.07, 0.035, 10); } }      // a kerb of laterite set with candles all along it
  else for (let x = 3.2; x < 57; x += 2.4) { B0(sx * x, 0.42, 44.6, 0.2, 1.0, 0.2, 41); if (x + 2.4 < 57) { B0(sx * (x + 1.2), 0.9, 44.6, 2.4, 0.1, 0.16, 41); B0(sx * (x + 1.2), 0.38, 44.6, 2.4, 0.07, 0.1, 41); } }
  for (const x of [12.8, 24.8, 36.8, 48.8]) { T0(sx * x, 0.9, 44.6, 0.05, sx * x, 2.7, 44.6, 0.04, 4); lantern(sx * x, 2.95, 44.6, R(), 1.3); lamp(sx * x, 2.8, 44.4, 11, LANT, 0.1, 0.12); }
  if (RUIN) for (const x of [6.8, 18.8, 30.8, 42.8]) lamp(sx * x, 0.7, 44.3, 7, CANDLE, 0.16, 0.25);
}
// 2. the gate
{ const z = -66;
  if (PARK) {      // the festival's arch: two posts, a lit sign across, lanterns hung under it
    for (const sx of [-1, 1]) { B0(sx * 3.4, 2.4, z, 0.6, 4.8, 0.6, 33, 0.3); B0(sx * 3.4, 0.2, z, 1.0, 0.4, 1.0, 2); lamp(sx * 2.6, 3.4, z + 1.0, 10, LANT, 0.1, 0.1); }
    B0(0, 5.0, z, 7.6, 1.1, 0.3, 67, sign('เทศกาลลอยกระทง กรุงเทพมหานคร', '#7a1420', '#ffe6a8')); B0(0, 5.62, z, 7.8, 0.14, 0.4, 15); B0(0, 4.4, z, 7.6, 0.14, 0.4, 15);
    for (let i = 0; i < 7; i++) lantern(-2.7 + i * 0.9, 3.85 - 0.25 * sin(i / 6 * PI), z + 0.2, R(), 0.9);
  }
  else if (RUIN) { for (const sx of [-1, 1]) { B0(sx * 3.1, 1.3, z, 1.1, 2.6, 1.1, 58, R()); B0(sx * 3.1, 2.75, z, 1.3, 0.3, 1.3, 58, R()); lantern(sx * 2.2, 2.4, z + 0.8, 0.3, 1.2); lamp(sx * 2.2, 2.4, z + 1.0, 10, LANT, 0.1, 0.1); } }
  else {
    for (const sx of [-1, 1]) { B0(sx * 3.1, 1.7, z, 0.9, 3.7, 0.9, 41); B0(sx * 3.1, 0.25, z, 1.2, 0.8, 1.2, 41); lantern(sx * 2.2, 2.75, z + 0.7, 0.3, 1.2); lamp(sx * 2.2, 2.7, z + 1.0, 10, LANT, 0.1, 0.1); }
    B0(0, 3.72, z, 7.4, 0.4, 1.1, LANNA ? 60 : 41);
    if (LANNA) { B0(0, 4.6, z, 8.6, 1.5, 3.4, 9, 0.05, 0, 1); B0(0, 4.0, z, 9.6, 0.5, 3.8, 9, 0.05, 0, 1); for (const sz of [-1, 1]) B0(0, 4.6, z + sz * 0.02, 0.06, 1.4, 3.2, 15, 0, 0, 1); B0(0, 5.6, z, 0.12, 0.9, 0.12, 15); }
    else { B0(0, 4.85, z, 8.2, 1.9, 2.8, 9, 0.05, 0, 1); B0(0, 6.15, z, 0.12, 0.9, 0.12, 15); for (const sz of [-1, 1]) B0(0, 3.95, z + sz * 1.42, 8.2, 0.14, 0.1, 15); }
  }
}
// the ordination hall (อุโบสถ) of a central Thai temple: white, on a plinth, a colonnade down each side, stepped roofs with gilded gables and
// finials, boundary stones at its corners. F: its frame (doors toward local +z); WM: the wall's material (41 whitewash, 64 floodlit).
function thaiHall(F, WM = 41) {
  const put = F.put, raw = F.raw;
  put(0, 0.7, 0, 15.5, 1.2, 9.5, WM); put(0, 4.0, 0, 12.5, 5.4, 6.6, WM);
  for (let i = 0; i < 6; i++) { put(-6 + i * 2.4, 3.7, 3.9, 0.5, 4.8, 0.5, WM); put(-6 + i * 2.4, 3.7, -3.9, 0.5, 4.8, 0.5, WM); if (i < 5) put(-4.8 + i * 2.4, 3.6, 3.32, 1.0, 2.6, 0.08, 14); }
  put(0, 9.05, 0, 9.0, 4.7, 7.6, 9, 0.05, 0, 1);
  for (const ex of [-1, 1]) {
    put(ex * 5.9, 8.55, 0, 3.2, 3.7, 6.4, 9, 0.05, 0, 1); put(ex * 7.53, 8.45, 0, 0.06, 3.3, 5.6, 15, 0, 0, 1);
    for (const [fx, fy] of [[7.5, 10.4], [4.5, 11.4]]) { raw(ex * (fx + 0.2), fy + 0.4, 0, PI / 2, 0.1, 0.95, 0.1, ex * 0.45, 15, 0, 0, 0); raw(ex * (fx + 0.62), fy + 0.98, 0, PI / 2, 0.08, 0.6, 0.08, ex * 0.95, 15, 0, 0, 0); }
    for (const ez of [-1, 1]) put(ex * 7.58, 8.62, ez * 1.6, 0.12, 0.2, 4.95, 15, 0, ez * 0.857);
  }
  for (const ez of [-1, 1]) { put(0, 6.2, ez * 4.5, 15.4, 0.08, 2.5, 9, 0.05, ez * 0.5); put(0, 5.62, ez * 5.62, 15.4, 0.1, 0.28, 33, 0.63); }
  for (let k = 0; k < 3; k++) put(0, 1.13 - k * 0.33, 5.0 + k * 0.5, 5.2, 0.34, 0.5, 2);
  for (const [sx, sz] of [[-9, -6], [-9, 6], [9, -6], [9, 6], [0, -6.6], [-9, 0], [9, 0]]) { put(sx, 0.62, sz, 0.7, 0.7, 0.7, WM); put(sx, 1.4, sz, 0.52, 0.95, 0.14, WM); put(sx, 1.95, sz, 0.3, 0.2, 0.12, 15); }
  for (const lx of [-5.6, 5.6]) { put(lx, 0.42, 7.2, 0.3, 0.25, 0.3, 10); F.lamp(lx, 0.7, 7.4, 17, [2.4, 1.8, 1.0], 0.05); }
  F.block(-8.1, -5.1, 8.1, 6.4);
}
// 3. the hall. It stands along z with its doors toward the walk.
{ const F = local(-27, ground(-27, -16) - 0.3, -16, PI / 2), put = F.put, raw = F.raw;
  if (PARK) { /* the retro market stands here (it is built with the stalls, below) */ }
  else if (PL.temple === 'thai') thaiHall(F);
  else if (LANNA) {      // a Lanna vihara (วิหารล้านนา): low walls of dark teak stencilled in gold, roofs sweeping low in three tiers, gilded gables
    put(0, 0.7, 0, 15.5, 1.2, 9.5, 41); put(0, 3.0, 0, 12.5, 3.4, 6.6, 60, 0.3);
    for (let i = 0; i < 6; i++) for (const ez of [-1, 1]) put(-6 + i * 2.4, 3.0, ez * 3.9, 0.42, 3.4, 0.42, 60, 0.7);
    put(0, 5.25, 0, 16.6, 1.0, 11.4, 9, 0.05, 0, 1);                 // the lowest skirt of roof, all round
    for (const ex of [-1, 1]) { put(ex * 5.4, 6.1, 0, 3.6, 2.4, 10.0, 9, 0.05, 0, 1); put(ex * 7.22, 6.1, 0, 0.06, 2.3, 9.2, 15, 0, 0, 1); }
    put(0, 7.2, 0, 7.6, 3.6, 9.0, 9, 0.05, 0, 1); for (const ex of [-1, 1]) put(ex * 3.82, 7.2, 0, 0.06, 3.5, 8.4, 15, 0, 0, 1);
    put(0, 9.08, 0, 7.8, 0.14, 0.22, 15);
    for (const ex of [-1, 1]) { raw(ex * 4.0, 9.3, 0, PI / 2, 0.1, 0.9, 0.1, ex * 0.5, 15, 0, 0, 0); raw(ex * 7.4, 7.6, 0, PI / 2, 0.1, 0.8, 0.1, ex * 0.5, 15, 0, 0, 0); }
    put(0, 2.6, 3.34, 2.2, 2.8, 0.08, 15); for (const lx of [-3.6, 3.6]) put(lx, 2.8, 3.34, 1.0, 1.4, 0.08, 15, 0.4);
    for (let k = 0; k < 3; k++) put(0, 1.13 - k * 0.33, 5.0 + k * 0.5, 4.2, 0.34, 0.5, 41);
    for (const lz of [-1, 1]) for (let i = 0; i < 7; i++) lantern(F.Wd(-7.2 + i * 2.4, lz * 5.3)[0], F.y + 4.4, F.Wd(-7.2 + i * 2.4, lz * 5.3)[1], R(), 1.25);
    for (const lx of [-5.6, 5.6]) { put(lx, 0.42, 7.2, 0.3, 0.25, 0.3, 10); F.lamp(lx, 0.7, 7.4, 17, [2.4, 1.8, 1.0], 0.05); }
    F.lamp(0, 3.4, 5.8, 15, [2.0, 1.4, 0.7], 0.06);
    F.block(-8.1, -5.1, 8.1, 6.4);
  } else {      // the ruined vihara: a laterite platform, its columns broken off at different heights, at the back a great seated Buddha
    put(0, 0.5, 0, 18, 1.0, 11, 58, 0.2); put(0, 1.2, 0, 16.4, 0.4, 9.6, 58, 0.6);
    for (let i = 0; i < 6; i++) for (const lz of [1.1, 3.9]) { const lx = -6 + i * 2.4, hh = 1.6 + R() * 3.6; F.tube(lx, 1.4, lz, 0.38, lx, 1.4 + hh, lz, 0.34, 29); }
    for (const ex of [-1, 1]) put(ex * 7.6, 2.2, -1.2, 0.6, 1.6 + R(), 6.8, 58, R());
    const y0 = 1.4, bz = -2.5;
    put(0, y0 + 0.6, bz, 4.8, 1.2, 3.4, 58, 0.4); put(0, y0 + 1.25, bz, 4.4, 0.14, 3.1, 59, 0.2);
    const tb = (x0, a0, z0, r0, x1, a1, z1, r1, m = 30) => F.tube(x0, y0 + a0, bz + z0, r0, x1, y0 + a1, bz + z1, r1, m);
    tb(-1.55, 1.75, 0.55, 0.55, 1.55, 1.75, 0.55, 0.55);           // the crossed legs
    tb(0, 1.5, -0.2, 1.05, 0, 3.35, -0.2, 0.78);                    // the body
    tb(-0.95, 3.2, -0.2, 0.32, 0.95, 3.2, -0.2, 0.32);              // the shoulders
    tb(0, 3.3, -0.15, 0.3, 0, 3.6, -0.15, 0.28); tb(0, 3.55, -0.1, 0.44, 0, 4.35, -0.1, 0.4); tb(0, 4.35, -0.1, 0.4, 0, 4.6, -0.1, 0.24);
    tb(0, 4.6, -0.1, 0.16, 0, 5.35, -0.1, 0.0, 7);                  // the flame on the crown, gilded
    tb(0.95, 3.15, -0.2, 0.22, 1.2, 2.25, 0.25, 0.19); tb(1.2, 2.25, 0.25, 0.19, 1.05, 1.75, 0.95, 0.15);       // the right hand down over the knee, calling the earth to witness
    tb(-0.95, 3.15, -0.2, 0.22, -1.05, 2.25, 0.15, 0.19); tb(-1.05, 2.25, 0.15, 0.19, -0.1, 2.0, 0.55, 0.15);   // the left in the lap
    tb(-0.75, 3.05, 0.35, 0.09, 0.85, 1.95, 0.5, 0.09, 17);         // a saffron sash
    for (let k = 0; k < 9; k++) { const lx = -1.6 + k * 0.4; F.tube(lx, y0 + 1.32, bz + 1.45, 0.016, lx, y0 + 1.5, bz + 1.45, 0.014, 14); F.tube(lx, y0 + 1.5, bz + 1.45, 0.018, lx, y0 + 1.58, bz + 1.45, 0.001, 9); }
    F.lamp(0, y0 + 1.6, bz + 1.6, 9, CANDLE, 0.1, 0.25); F.lamp(0, 5.5, 4.5, 16, [1.9, 1.3, 0.7], 0.04, 0.05); F.lamp(-5, 3.5, 3, 10, [1.6, 1.0, 0.5], 0.08, 0.1); F.lamp(5, 3.5, 3, 10, [1.6, 1.0, 0.5], 0.08, 0.1);
    F.block(-9.1, -5.6, 9.1, 5.6);
  }
}
// 4. the chedi, candles set all round its foot
if (PARK) {      // the krathong contest (ประกวดกระทง): the entries on two long tables under a white marquee, its edge hung with bulbs
  const cx = -30, cz = 18, y = ground(cx, cz);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) T0(cx + sx * 5.8, y, cz + sz * 4.3, 0.07, cx + sx * 5.8, y + 3.2, cz + sz * 4.3, 0.06, 4);
  B0(cx, y + 3.9, cz, 12.4, 1.5, 9.6, 41, 0, 0, 1);
  for (let i = 0; i <= 20; i++) for (const sz of [-1, 1]) B0(cx - 6 + i * 0.6, y + 3.1, cz + sz * 4.75, 0.08, 0.08, 0.08, 63, fract(i * 0.21 + sz * 0.3));
  B0(cx, y + 2.6, cz + 4.4, 4.4, 0.6, 0.08, 67, sign('ประกวดกระทง', '#1f4e8a', '#fff6dc'));
  for (const tz of [-1.7, 1.7]) {
    B0(cx, y + 0.78, cz + tz, 9.4, 0.06, 1.3, 0, 0.3); B0(cx, y + 0.42, cz + tz + 0.66 * Math.sign(tz), 9.4, 0.72, 0.03, 51);
    for (const dx of [-4.5, 4.5]) for (const dz of [-0.55, 0.55]) B0(cx + dx, y + 0.39, cz + tz + dz, 0.06, 0.78, 0.06, 4);
    for (let i = 0; i < 5; i++) { const x = cx - 3.6 + i * 1.8, n = putK(tmpK, 0, KT[(i + (tz > 0 ? 2 : 0)) % 4], x, y + 0.81, cz + tz, i * 0.7, 2.8, true); pushT(bk(x, cz).far, tmpK, n); }
    RECT.push([cx - 4.8, cz + tz - 0.7, cx + 4.8, cz + tz + 0.7]);
  }
  lamp(cx - 3, y + 3.0, cz, 10, WARM, 0.08); lamp(cx + 3, y + 3.0, cz, 10, WARM, 0.08);
} else { const cx = -30, cz = 18, y = ground(cx, cz);
  if (PL.temple === 'thai') {      // a white bell on a square base, a gilded spire, a saffron cloth tied round it
    B0(cx, y + 0.3, cz, 10, 0.7, 10, 41); B0(cx, y + 0.9, cz, 7.8, 0.6, 7.8, 41);
    profile(cx, y - 0.3, cz, 1.25, BELL(6, 7)); T0(cx, y + 3.1, cz, 2.92, cx, y + 3.6, cz, 3.08, 17);
  } else if (LANNA) {      // all of it gilded, as Lanna chedis are, a five-tiered umbrella over the spire, four small chedis at the corners
    B0(cx, y + 0.3, cz, 10, 0.7, 10, 41); B0(cx, y + 0.9, cz, 7.8, 0.6, 7.8, 15); B0(cx, y + 1.45, cz, 6.6, 0.5, 6.6, 15);
    profile(cx, y + 0.1, cz, 1.2, BELL(7, 7));
    for (let k = 0; k < 5; k++) { const yy = y + 0.1 + 11.0 * 1.2 - 2.2 + k * 0.42, r = 0.62 - k * 0.11; T0(cx, yy, cz, r, cx, yy + 0.05, cz, r, 7); }
    for (const [dx, dz] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) profile(cx + dx, y + 0.65 - 1.2 * 0.28, cz + dz, 0.28, BELL(7, 7));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lamp(cx + dx * 6.5, y + 2.5, cz + dz * 6.5, 14, [2.2, 1.5, 0.6], 0.05);
  } else {      // a lotus-bud chedi (ทรงพุ่มข้าวบิณฑ์) of Sukhothai: square laterite tiers, a tall stuccoed body, the bud, a thin spire
    B0(cx, y + 0.5, cz, 11, 1.0, 11, 58, 0.1); B0(cx, y + 1.4, cz, 8.6, 0.8, 8.6, 58, 0.5); B0(cx, y + 2.15, cz, 6.6, 0.7, 6.6, 58, 0.8);
    // Every tier is square with its corners stepped in (ย่อมุม): a block and two narrower ones crossed through it.
    const rd = (yb, h, w, seed = 0.4) => { B0(cx, y + yb + h / 2, cz, w, h, w * 0.8, 59, seed); B0(cx, y + yb + h / 2, cz, w * 0.8, h, w, 59, seed); B0(cx, y + yb + h / 2, cz, w * 0.92, h, w * 0.92, 59, seed); };
    rd(2.5, 1.4, 5.0, 0.3); rd(3.9, 0.7, 4.4, 0.7);
    rd(4.6, 3.8, 3.5, 0.5);                                                                                       // the body (เรือนธาตุ), tall,
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) B0(cx + dx * 1.76, y + 6.2, cz + dz * 1.76, dz ? 1.0 : 0.08, 2.0, dz ? 0.08 : 1.0, 3);      // a niche (ซุ้มจระนำ) on each side
    rd(8.4, 0.35, 4.1, 0.2); rd(8.75, 0.35, 3.3, 0.6); rd(9.1, 0.4, 3.9, 0.3);                                   // a cornice, then the lotus cushion the bud sits on
    // the bud (พุ่มข้าวบิณฑ์): no wider than the body, swelling a little, then drawn up to a point - in layers, its corners stepped in as the rest
    for (let k = 0, n = 14, y0 = 9.5; k < n; k++) { const t = (k + 0.5) / n, w = 3.5 * Math.pow(1 - t, 0.45) * (1 + 0.15 * sin(PI * t)); rd(y0 + k * 0.38, 0.4, max(w, 0.3), fract(0.37 * k)); }
    T0(cx, y + 14.7, cz, 0.22, cx, y + 18.2, cz, 0.02, 30);                                                       // the spire (ปลียอด)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lamp(cx + dx * 7, y + 1.5, cz + dz * 7, 16, [1.9, 1.25, 0.6], 0.04);
  }
  for (let k = 0; k < 28; k++) { const a = k / 28 * TAU, r = 4.5 / max(abs(cos(a)), abs(sin(a))) * 0.98, x = cx + cos(a) * min(r, 4.75) * (RUIN ? 1.2 : 1), z = cz + sin(a) * min(r, 4.75) * (RUIN ? 1.2 : 1), yy = RUIN ? y + 1.0 : y + 0.65; T0(x, yy, z, 0.014, x, yy + 0.15, z, 0.012, 14); T0(x, yy + 0.15, z, 0.016, x, yy + 0.22, z, 0.001, 9); }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lamp(cx + dx * 5.2, y + 1.0, cz + dz * 5.2, 8, CANDLE, 0.1, 0.3);
  RECT.push(RUIN ? [cx - 5.8, cz - 5.8, cx + 5.8, cz + 5.8] : [cx - 5.3, cz - 5.3, cx + 5.3, cz + 5.3]);
}
// 5. the fair: a row of stalls beside the walk. The middle one sells krathongs; one further on sells sky lanterns (where they may be let go).
await LD.step('กำลังตั้งร้านค้าและแขวนโคมไฟ', 52);
const K_DISP = [], L_DISP = []; let STALLK = [0, 0], STALLL = [0, 0];
// what each kind of stall sells: [its name (the sign), what is on it, board colour]
const GOODS = {
  0: ['ร้านกระทง', 'กระทงใบตอง · กระทงดอกบัว · กระทงขนมปัง · กระทงกล้วยไม้', '#2f7d3a'],
  1: ['ข้าวเหนียวมะม่วง ลูกชิ้นปิ้ง', 'ข้าวเหนียวมะม่วง ลูกชิ้นปิ้ง ไข่ปิ้ง หมูสะเต๊ะ', '#c0392b'],
  2: HAS_L ? ['ร้านโคมลอย', 'โคมขาว · โคมแดง · โคมทอง · โคมลายบัว', '#a8551a'] : ['โคมกระดาษ', 'โคมแขวนหลากสี สำหรับประดับบ้าน (ไม่ใช่โคมลอย)', '#a8551a'],
  3: ['เครื่องดื่มเย็นๆ', 'น้ำเปล่า ชาเย็น น้ำอัดลม น้ำมะพร้าวอ่อน', '#1f5fa8'],
  4: ['ดอกไม้ ธูป เทียน', 'พวงมาลัย ดอกบัว ธูป เทียน สำหรับบูชาและแต่งกระทง', '#8e2f6e'],
};
const SHOPS = [];      // each stall: where its customer stands, its name, what it sells
function stall(cx, cz, kind, sd, yaw = -PI / 2, goods = GOODS[kind]) {
  const F = local(cx, ground(cx, cz), cz, yaw), put = F.put;
  const front = F.Wd(0, 2.2), keep = F.Wd(0, -0.2); SHOPS.push({ x: front[0], z: front[1], kind, name: goods[0], items: goods[1], kx: keep[0], kz: keep[1], yaw, ax: cos(yaw), az: -sin(yaw) });
  for (const px of [-1.9, 1.9]) for (const pz of [-1.3, 1.5]) put(px, 1.25, pz, 0.07, 2.5, 0.07, 4);
  put(0, 2.56, 0.1, 4.4, 0.05, 3.4, 36, sd, 0.14);
  put(0, 0.8, 0.8, 3.5, 0.06, 1.0, 0, 0.3); put(0, 0.42, 1.31, 3.5, 0.76, 0.03, 33, sd);
  for (const px of [-1.6, 1.6]) for (const pz of [0.4, 1.2]) put(px, 0.4, pz, 0.06, 0.8, 0.06, 4);
  put(0, 2.2, 1.62, 3.3, 0.44, 0.05, 67, sign(goods[0], goods[2]));
  put(0, 2.02, 0.7, 0.1, 0.13, 0.1, 10); F.tube(0, 2.08, 0.7, 0.006, 0, 2.5, 0.7, 0.006, 1);
  F.lamp(0, 1.95, 0.75, 10, WARM, 0.1); F.block(-2.1, -1.5, 2.1, 1.5);
  if (kind === 0) {            // krathongs: the four kinds in a row at the front of the table to choose from, more behind
    const kput = (lx, lz, y, k, sc) => { const q = F.Wd(lx, lz), n = putK(tmpK, 0, KT[k], q[0], F.y + y, q[1], lx * 3, sc, false); pushT(bk(q[0], q[1]).far, tmpK, n); return q; };
    for (let k = 0; k < 4; k++) { const q = kput(-1.08 + k * 0.72, 0.98, 0.845, k, 1.15); K_DISP.push([q[0], F.y + 0.92, q[1]]); }
    for (let i = 0; i < 7; i++) kput(-1.4 + i * 0.47, 0.52, 0.845, floor(R() * 4), 0.85);
    put(-1.2, 0.35, -0.6, 0.7, 0.7, 0.7, 0, 0.7); put(-1.2, 0.74, -0.6, 0.62, 0.12, 0.62, 20); put(1.1, 0.3, -0.5, 0.8, 0.6, 0.6, 0, 0.2); put(1.1, 0.64, -0.5, 0.7, 0.1, 0.5, 33, 0.6);
    STALLK = F.Wd(0, 2.2);
  } else if (kind === 1) {     // food: steel trays, a pot, a basin, crates, a gas bottle
    put(-0.9, 0.95, 0.8, 0.9, 0.22, 0.6, 34); put(0.3, 0.98, 0.8, 0.5, 0.3, 0.5, 34); put(1.2, 0.9, 0.8, 0.6, 0.12, 0.6, 33, 0.3);
    for (let j = 0; j < 3; j++) put(-1.4, 0.2 + j * 0.34, -0.7, 0.6, 0.32, 0.42, 33, j % 2 ? 0.1 : 0.48);
    put(1.3, 0.45, -0.6, 0.4, 0.9, 0.4, 34);
  } else if (kind === 2) {     // lanterns: a row hung under the awning; where sky lanterns are let go, the four papers stand opened on the table to choose from
    for (let i = 0; i < 7; i++) { const q = F.Wd(-1.5 + i * 0.5, 1.5); lantern(q[0], F.y + 1.9 + (i % 2) * 0.14, q[1], R()); }
    if (HAS_L) {
      for (let k = 0; k < 4; k++) { const q = F.Wd(-1.08 + k * 0.72, 0.98), n = putLantern(tmpK, 0, q[0], F.y + 0.835, q[1], 0.5, false, false, k); pushT(bk(q[0], q[1]).far, tmpK, n); L_DISP.push([q[0], F.y + 1.05, q[1]]); }
      for (let i = 0; i < 4; i++) put(-1.1 + i * 0.75, 0.86 + (i % 2) * 0.03, 0.45, 0.6, 0.06 + (i % 2) * 0.06, 0.4, 52);
      STALLL = F.Wd(0, 2.2);
    } else for (let i = 0; i < 4; i++) put(-1.1 + i * 0.75, 0.86 + (i % 2) * 0.03, 0.8, 0.6, 0.06 + (i % 2) * 0.06, 0.6, 52);
  } else if (kind === 3) {     // drinks: rows of bottles, a cool box
    for (let i = 0; i < 14; i++) put(-1.5 + i * 0.23, 0.98, 0.85 + (i % 2) * 0.14, 0.09, 0.3, 0.09, 33, R());
    put(1.2, 0.3, -0.5, 0.9, 0.6, 0.6, 33, 0.48); put(1.2, 0.63, -0.5, 0.94, 0.07, 0.64, 19);
  } else {                     // garlands and flowers
    for (let i = 0; i < 8; i++) put(-1.6 + i * 0.45, 1.9, 1.5, 0.07, 0.6, 0.07, 20);
    put(-0.8, 0.93, 0.8, 1.2, 0.2, 0.7, 20); put(0.9, 0.93, 0.8, 1.0, 0.18, 0.7, 33, 0.9); put(0.1, 0.9, 0.55, 0.3, 0.14, 0.2, 14);
  }
}
stall(11.5, -42, 1, 0.1); stall(11.5, -33, 4, 0.3); stall(11.5, -24, 0, 0.9); stall(11.5, -12, 2, 0.5); stall(11.5, -3, 3, 0.48);
// the retro market (ตลาดย้อนยุค) where a temple would stand: two rows of stalls facing each other across a lane hung with lanterns
if (PARK) {
  const OLD = [['ขนมไทยโบราณ', 'ขนมชั้น ทองหยอด ฝอยทอง ขนมครก', '#b5651d'], ['ไอติมกะทิ', 'ไอศกรีมกะทิใส่ขนมปัง ข้าวเหนียว ถั่วลิสง', '#2a7f8f'], ['ของเล่นย้อนยุค', 'ของเล่นสังกะสี กังหันลม ลูกข่าง ตุ๊กตากระดาษ', '#7a3fa0'],
    ['ผ้าไทยทอมือ', 'ผ้าซิ่น ผ้าขาวม้า ผ้าคลุมไหล่', '#8e2f6e'], ['ก๋วยเตี๋ยวเรือ', 'ก๋วยเตี๋ยวเรือ ชามละ 15 บาท', '#c0392b']];
  [-24, -16, -8].forEach((z, i) => stall(-32.5, z, [1, 3, 4][i], fract(z * 0.137 + 0.3), PI / 2, OLD[i]));
  [-24, -8].forEach((z, i) => stall(-21.5, z, [4, 1][i], fract(z * 0.311 + 0.6), -PI / 2, OLD[3 + i]));
  for (let z = -28; z <= -4; z += 4) { string(-30.4, 3.1, z, -23.6, 3.1, z, 0.45, 5); for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5; lantern(mix(-30.4, -23.6, t), 2.9 - 1.6 * t * (1 - t), z, R(), 0.8); } }
}
// 6. lanterns over the walk: bamboo poles in pairs, a string of paper lanterns across from each to its partner, small bulbs strung on along the walk.
//    For Yi Peng the walk is hung twice as thick, the Lanna way.
for (let z = -58; z <= 38; z += 12) {
  for (const sx of [-1, 1]) { T0(sx * 3.7, -0.2, z, 0.06, sx * 3.7, 4.45, z, 0.045, 4); OBST.push([sx * 3.7, z, 0.3]); }
  for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5; lantern(mix(-3.7, 3.7, t), 4.0 - 2.8 * t * (1 - t), z, R()); }
  string(-3.7, 4.35, z, 3.7, 4.35, z, 0.7);
  lamp(0, 3.3, z, 13, LANT, 0.1, 0.12);
  if (z < 38) for (const sx of [-1, 1]) { string(sx * 3.7, 4.3, z, sx * 3.7, 4.3, z + 12, 0.6, 5, 0.006); for (let i = 1; i < 14; i++) { const t = i / 14; B0(sx * 3.7, 4.26 - 2.4 * t * (1 - t), z + 12 * t, 0.045, 0.055, 0.045, 10); } }
  if (LANNA && z < 38) { const zm = z + 6; string(-3.7, 4.2, zm, 3.7, 4.2, zm, 0.55); for (let i = 0; i < 9; i++) { const t = (i + 0.5) / 9; lantern(mix(-3.7, 3.7, t), 3.85 - 2.2 * t * (1 - t) - (i % 2) * 0.25, zm, R(), 0.85); } }
}
// 7. the pier: a roofed landing at the bank, the deck out over the water on piles, steps down, a landing at the water's edge. A boat lies moored beside it.
{ B0(0, 0.44, 48.25, 5, 0.12, 11.5, 0); B0(0, 0.2, 41.85, 5, 0.1, 1.4, 0, 0, -0.38);
  for (let z = 43; z <= 54.1; z += 2.75) for (const sx of [-1, 1]) B0(sx * 2.45, -0.5, z, 0.2, 4.0, 0.2, 4);
  for (const sx of [-1, 1]) { B0(sx * 2.45, 1.45, 48.5, 0.09, 0.08, 11, 4); B0(sx * 2.45, 1.0, 48.5, 0.06, 0.06, 11, 4); }
  for (let k = 0; k < 4; k++) B0(0, 0.5 - (k + 1) * 0.27 - 0.05, 54.375 + k * 0.75, 5, 0.1, 0.76, 0);
  B0(0, PIER.py - 0.11, 59.6, 6.4, 0.22, 5.2, 0, 0.3);
  for (const sx of [-1, 1]) for (const z of [57.2, 62.0]) { B0(sx * 3.05, -0.9, z, 0.22, 2.6, 0.22, 4); }
  for (const sx of [-1, 1]) { lantern(sx * 3.05, 0.72, 62.0, R(), 1.2); lamp(sx * 3.0, 0.75, 61.7, 8, LANT, 0.12, 0.15); }
  const PAV = mkB(); addGableRoof(PAV, 7.2, 5.6, 3.4, 1.5, 0.55, 16, 9);
  const F = local(0, 0, 46, PI / 2); F.stamp(PAV, 0, 0, 0, 0, 0.05);
  for (const sx of [-1, 1]) for (const z of [42.8, 49.2]) { B0(sx * 2.5, 1.95, z, 0.2, 2.9, 0.2, 41); OBST.push([sx * 2.5, z, 0.22]); }      // (the posts are in the way of those walking onto the pier)
  for (const z of [44, 46, 48]) lantern(0, 2.85, z, R(), 1.2);
  lamp(0, 2.6, 46, 12, LANT, 0.1, 0.1);
  const Fb = local(7.2, WL - 0.12, 53, 0.25); Fb.stamp(LONGTAIL, 0, 0, 0, 0.3, 0.3, 1);
  string(4.6, 0.9, 50.5, 2.45, 1.0, 51.2, 0.25, 3, 0.012);
}
// 8. a pavilion by the water's walk, benches along it. Both can be sat on (SEATS).
const SEATS = [];
{ const F = local(-18, ground(-18, 36.5), 36.5, 0); F.stamp(SALA, 0, 0, 0, 0.7, 0.3); F.block(-2, -1.4, 2, 1.4); lantern(-18, 2.2, 36.5, 0.5, 1.2); lamp(-18, 2.0, 36.5, 9, LANT, 0.12, 0.1);
  SEATS.push({ x: -18, z: 36.75, y: F.y + 0.46, yaw: 0, name: 'ศาลา' });
  for (const bx of [-40, -30, 20, 32, 44]) { SEATS.push({ x: bx, z: 40.0, y: ground(bx, 40) + 0.49, yaw: 0, name: 'ม้านั่ง' }); B0(bx, 0.45, 40.0, 1.8, 0.07, 0.45, 0); B0(bx - 0.75, 0.22, 40.0, 0.08, 0.44, 0.4, 2); B0(bx + 0.75, 0.22, 40.0, 0.08, 0.44, 0.4, 2); RECT.push([bx - 1, 39.7, bx + 1, 40.3]); }
}
// 9. the lawn. Where lanterns go up: an altar (โต๊ะบูชา) with candles alight and a pot for incense; people come with lanterns of their own and let them go.
//    In Bangkok: a stage for the Nang Noppamas pageant, its crowd before it.
const LAWN = [34, 16], ALTAR = [24.5, 12.6], ALT_POT = [ALTAR[0], ground(ALTAR[0], ALTAR[1]) + 0.94, ALTAR[1] - 0.05];
const LSPOT = PL.lawn !== 'lanterns' ? [] : PL.id === 'chiangmai' ? [[33, 12], [38.5, 18], [31, 21], [40, 11], [28.5, 17.5], [36, 24], [43, 16], [35, 7.5]] : [[33, 12], [38.5, 18], [31, 21]];
const STAGE = [41, 16];
if (PL.lawn === 'lanterns') {
  const [x, z] = ALTAR, y = ground(x, z);
  B0(x, y + 0.78, z, 2.2, 0.06, 0.9, 0, 0.3); for (const dx of [-1, 1]) for (const dz of [-0.35, 0.35]) B0(x + dx, y + 0.39, z + dz, 0.06, 0.78, 0.06, 4);
  B0(x, y + 0.42, z + 0.46, 2.2, 0.72, 0.03, 51); B0(x, y + 0.82, z, 2.24, 0.02, 0.94, 51);                         // a saffron cloth over it
  B0(x, y + 0.86, z - 0.05, 0.22, 0.08, 0.22, 15); B0(x, y + 0.93, z - 0.05, 0.26, 0.06, 0.26, 15);                 // the incense pot
  for (const dx of [-0.6, 0.6]) { T0(x + dx, y + 0.81, z - 0.1, 0.022, x + dx, y + 1.13, z - 0.1, 0.02, 14); T0(x + dx, y + 1.13, z - 0.1, 0.022, x + dx, y + 1.22, z - 0.1, 0.001, 9); lamp(x + dx, y + 1.25, z - 0.1, 6, CANDLE, 0.25, 0.3); }
  for (const dx of [-0.32, 0.32]) B0(x + dx, y + 0.9, z + 0.18, 0.16, 0.12, 0.16, 20);                              // garlands of marigolds
  T0(x - 1.2, y, z - 0.5, 0.04, x - 1.2, y + 2.6, z - 0.5, 0.035, 4); lantern(x - 1.2, y + 2.85, z - 0.5, 0.3, 1.3); lamp(x - 1.0, y + 2.4, z - 0.3, 9, [1.5, 0.95, 0.45], 0.14, 0.1);
  RECT.push([x - 1.2, z - 0.55, x + 1.2, z + 0.55]);
  // (no lanterns stand on the grass: a newcomer would take them for something to use. The people on the lawn bring their own, see movePeople.)
} else if (PL.lawn === 'stage') {
  const [sx, sz] = STAGE;
  B0(sx, 0.5, sz, 6, 1.0, 11, 0, 0.4); B0(sx - 3.05, 0.5, sz, 0.1, 1.0, 11, 61);
  B0(sx + 3.1, 2.6, sz, 0.2, 5.2, 11, 61); B0(sx + 3.0, 5.35, sz, 0.4, 0.55, 11.6, 15);
  for (const dz of [-5.4, 5.4]) { B0(sx - 2.9, 2.5, sz + dz, 0.15, 5, 0.15, 4); B0(sx + 3.0, 2.5, sz + dz, 0.3, 5.2, 0.3, 15); }
  B0(sx - 2.9, 5.0, sz, 0.12, 0.12, 11, 4);
  for (let i = 0; i <= 18; i++) B0(sx - 2.9, 4.88 - 0.25 * sin(i / 18 * PI), sz - 5.4 + i * 0.6, 0.09, 0.09, 0.09, 63, fract(i * 0.137));
  for (let i = 0; i < 6; i++) lantern(sx + 2.7, 4.4, sz - 4.5 + i * 1.8, R(), 1.3);
  lamp(sx - 1, 4.2, sz, 14, [2.6, 1.8, 1.3], 0.05); lamp(sx - 2, 3.8, sz - 4, 10, [2.2, 0.6, 1.1], 0.1); lamp(sx - 2, 3.8, sz + 4, 10, [0.8, 1.1, 2.4], 0.1);
  RECT.push([sx - 3.1, sz - 5.6, sx + 3.3, sz + 5.6]);
}
// 10. trees. A great rain tree by the stalls with lanterns in its boughs and a cloth round its trunk; shade trees inside the walls;
//     palms along the water's walk; flowering shrubs beside the path; a dark belt of trees outside and along the far bank.
await LD.step('กำลังปลูกต้นไม้รอบงาน', 60);
{ const tx = 27, tz = -38;
  plant(TREES[10], tx, tz, 1.2, 1.25, 1, true, 1.1); T0(tx, 0.9, tz, 0.9, tx, 1.45, tz, 0.84, 17); T0(tx, 1.45, tz, 0.86, tx, 1.75, tz, 0.80, 19);
  for (let i = 0; i < 14; i++) { const a = i * 2.39996, r = 2 + R() * 5, x = tx + cos(a) * r, z = tz + sin(a) * r, y = 2.9 + R() * 1.6; lantern(x, y, z, R()); T0(x, y + 0.2, z, 0.006, x, y + 2.4, z, 0.006, 1); }
  lamp(tx, 3.2, tz, 14, LANT, 0.08, 0.1);
}
const PAVED = (x, z) => PARK && z > 23.5 - 0.5;      // Rama VIII park's concrete promenade by the river: nothing is planted on it
const freeAt = (x, z, r) => {
  if (PAVED(x, z + r * 0.5)) return false;
  for (const o of RECT) if (x > o[0] - r && x < o[2] + r && z > o[1] - r && z < o[3] + r) return false;
  for (const o of OBST) if (hypot(x - o[0], z - o[1]) < o[2] + r) return false;
  if (abs(x) < 5 && z < 46) return false;
  if (x > 5 && x < 18 && z > -48 && z < 5) return false;
  if (hypot(x - LAWN[0], z - LAWN[1]) < 16) return false;
  if (abs(z + 16) < 4 && x > -22 && x < 10) return false;
  if (abs(z - 16) < 3.4 && x > 2 && x < 25) return false;
  if (x < -18 && x > -40 && z > -29 && z < 27) return false;
  return z < 38;
};
const BANK_T = RUIN ? [5, 6] : LANNA ? [0, 2] : [3, 4];
{ let tries = 0, placed = 0;
  while (placed < (LOW ? 13 : PARK ? 30 : 24) && tries++ < 900) { const x = (R() - 0.5) * 108, z = -62 + R() * (PARK ? 82 : 98); if (!freeAt(x, z, 6.5)) continue; plant(TREES[(RUIN ? [0, 1, 5, 10, 6, 0, 1] : PARK ? [10, 10, 10, 1, 10, 0, 10] : [0, 1, 2, 10, 11, 0, 1])[floor(R() * 7)]], x, z, R() * TAU, PARK ? 1.1 + R() * 0.4 : 0.8 + R() * 0.5, 1, true, PARK ? 1 : 0.6); placed++; }
  if (!PARK) for (let x = -53; x <= 53; x += 8.2) { if (abs(x) < 7 || abs(x + 18) < 5) continue; plant(TREES[BANK_T[R() < 0.5 ? 0 : 1]], x + (R() - 0.5) * 2, 38.2 + R(), R() * TAU, 0.9 + R() * 0.3, 1, true, 0.4); }
  for (let z = -60; z <= 34; z += LOW ? 12 : 6) for (const sx of [-1, 1]) { if (PAVED(0, z + 1.5) || abs(z + 16) < 4.5 || (sx > 0 && abs(z - 16) < 3.5) || abs(((z + 58) % 12) - 0) < 1.2) continue; plant(TREES[R() < 0.6 ? 9 : 8], sx * 4.6, z + R(), R() * TAU, 0.7 + R() * 0.3); }
  for (let i = 0; i < 9; i++) { const sx = i % 2 ? 1 : -1, z = -58 + i * 11 + R() * 4; if (freeAt(sx * 54, z, 1)) plant(TREES[7], sx * (53.5 + R()), z, R() * TAU, 0.9 + R() * 0.3, 1, true, 0.6); }
  placed = 0; tries = 0;
  while (placed < (LOW ? 22 : 80) && tries++ < 2000) { const x = (R() - 0.5) * 330, z = -125 + R() * 168; if (abs(x) < 62 && z > -70) continue; if (z > bankZ(x) - 3) continue; plant(TREES[[0, 1, 2, 10, 11, 5, 3][floor(R() * 7)]], x, z, R() * TAU, 0.8 + R() * 0.6, 2, false); placed++; }
  const nFar = PL.far === 'city' ? 0 : LOW ? 18 : 70;
  for (let i = 0; i < nFar; i++) { const x = (R() - 0.5) * 420, z = farZ(x) + 5 + R() * R() * 60; plant(TREES[[0, 1, 2, 11, 5, 6, 3, 4][floor(R() * 8)]], x, z, R() * TAU, 0.8 + R() * 0.6, 2, false); }
  if (!RIVER) for (let i = 0; i < (LOW ? 10 : 30); i++) { const x = (R() < 0.5 ? -1 : 1) * (PX + 6 + R() * 90), z = 50 + R() * 48; plant(TREES[[0, 1, 5, 6, 10][floor(R() * 5)]], x, z, R() * TAU, 0.8 + R() * 0.5, 2, false); }
}
// 11. over the water
if (PL.far === 'city') {
  // Bangkok, the Phra Nakhon bank, as old Bangkok meets the river there: a flood wall with lamp posts and shade trees along it; behind them rows of
  // shophouses (ตึกแถว), each 4 m wide - a shop below (roller shutter, folding doors, or open with its shelves lit), painted floors over it with
  // an air conditioner here and there, a water tank on the roof, a sign over some; a riverside temple; the old palace (วังบางขุนพรหม) by the
  // bridge in its garden; condominiums further back; towers far off in the haze. Each lies across its plot facing the river (turned by PI).
  const Rc = rng(77), KEEP = [[-116, -74], [56, 84], [92, 160], [186, 226]];      // left for the temple, the bridge, the palace, the fort
  const kept = (x0, x1) => KEEP.some(([a, b]) => x1 > a && x0 < b);
  const SHOPSIGN = ['ร้านทองเยาวราช', 'ข้าวมันไก่', 'โชห่วย', 'ร้านขายยา', 'ก๋วยเตี๋ยวเรือ', 'กาแฟโบราณ', 'ร้านตัดผม', 'ผ้าไหมไทย', 'ข้าวต้มปลา', 'ร้านหนังสือ'].map((t, k) => sign(t, ['#b8282e', '#1f5fa8', '#2f7d3a', '#8e2f6e', '#a8551a'][k % 5]));
  const shophouse = (x, z, floors, sd, kind, roof) => {
    const y = ground(x, z), h = 3.05 + floors * 3, fz = z - 6;      // fz: its front
    B0(x, y + 3.05 + (h - 3.05) / 2, z, 4.02, h - 3.05, 12, 6, sd, 0, 0, PI);
    B0(x, y + 1.52, z + 0.5, 4.02, 3.05, 11, 18, sd, 0, 0, PI);
    if (kind === 0) B0(x, y + 1.5, fz + 0.45, 3.8, 3.0, 0.1, 32, sd, 0, 0, PI);
    else if (kind === 1) B0(x, y + 1.5, fz + 0.45, 3.8, 3.0, 0.1, 35, sd, 0, 0, PI);
    else { B0(x, y + 1.45, fz + 1.6, 3.7, 2.9, 0.1, 31, sd, 0, 0, PI); B0(x, y + 2.75, fz - 0.55, 4.0, 0.05, 1.3, 36, sd, -0.3, 0, PI); }
    for (let f = 0; f < floors; f++) {      // a window on every floor (lit in some, as the glass is), a balcony with an iron railing on some
      const wy = y + 3.05 + f * 3 + 1.55; B0(x + (Rc() - 0.5) * 0.4, wy, fz - 0.04, 2.3, 1.5, 0.06, 17, Rc(), 0, 0, PI);
      if (Rc() < 0.35) { B0(x, wy - 0.9, fz - 0.45, 3.6, 0.1, 0.9, 2, 0, 0, 0, PI); B0(x, wy - 0.45, fz - 0.88, 3.6, 0.8, 0.05, 27, fract(sd * 3.7), 0, 0, PI); }
    }
    if (roof < 0.35) B0(x, y + h + 0.3, fz + 0.1, 4.02, 0.6, 0.2, 18, sd, 0, 0, PI);      // a parapet, a pitched roof of tiles or of corrugated sheet
    else { const F = local(x, y + h, z, PI); F.put(0, 0.9, 0, 4.02, 1.8, 12.4, roof < 0.7 ? 9 : 1, fract(sd * 5.1), 0, 1); }
    if (Rc() < 0.55) B0(x + (Rc() - 0.5) * 2, y + 3.05 + floor(Rc() * floors) * 3 + 1.3, fz - 0.16, 0.8, 0.5, 0.3, 22, 0, 0, 0, PI);
    if (Rc() < 0.5) B0(x + (Rc() - 0.5) * 2, y + h + 0.75, z + 2 + Rc() * 3, 1.2, 1.5, 1.2, 2);
    if (kind > 0 && Rc() < 0.45) B0(x, y + 3.3, fz - 0.06, 3.6, 0.48, 0.08, 67, SHOPSIGN[floor(Rc() * SHOPSIGN.length)], 0, 0, PI);
  };
  // the flood wall, the lamp posts and the trees along the river
  for (let x = -320; x < 320; x += 10) { const z = farZ(x + 5) + 1.2; B0(x + 5, ground(x + 5, z) + 0.6, z, 10.05, 1.3, 0.5, 2); }
  for (let x = -314; x < 314; x += 16) { if (x > 58 && x < 82) continue; const z = farZ(x) + 2.4, y = ground(x, z); T0(x, y, z, 0.07, x, y + 4.2, z, 0.05, 4); B0(x, y + 4.35, z, 0.36, 0.36, 0.36, 10); }
  for (let x = -318; x < 318; x += 10 + Rc() * 6) { if (kept(x - 3, x + 3) && !(x > 92 && x < 160)) continue; plant(TREES[[0, 1, 10, 0][floor(Rc() * 4)]], x, farZ(x) + 5.5, Rc() * TAU, 0.55 + Rc() * 0.2, 2, false); }
  // the rows of shophouses, in blocks of three to eight with lanes between
  for (let x = -330; x < 330;) {
    const n = 3 + floor(Rc() * 6), w = n * 4; if (kept(x, x + w)) { x += 6; continue; }
    const floors = 1 + floor(Rc() * 4), sd0 = Rc();
    const roof = Rc(); for (let k = 0; k < n; k++) { const ux = x + 2 + k * 4; shophouse(ux, farZ(ux) + 15, floors, fract(sd0 + k * (Rc() < 0.6 ? 0 : 0.37)), floor(Rc() * 3), roof); }
    x += w + 3 + Rc() * 5;
  }
  // condominiums behind, balconies on every floor
  for (let x = -330; x < 330;) {
    const w = 18 + Rc() * 14, d = 14 + Rc() * 6, fl = 7 + floor(Rc() * 12), h = fl * 3.4, z = farZ(x) + 40 + Rc() * 22, y = ground(x + w / 2, z);
    if (!kept(x, x + w) || Rc() < 0.3) { B0(x + w / 2, y + h / 2, z, w, h, d, 65, 0.6 + Rc() * 0.4, 0, 0, PI);
      B0(x + w / 2 + (Rc() - 0.5) * w * 0.4, y + h + 1.2, z, 3, 2.4, 3, 2); if (Rc() < 0.4) B0(x + w / 2, y + h - 0.3, z - d / 2 - 0.06, w, 0.3, 0.1, 63, Rc()); if (h > 50) B0(x + w / 2, y + h + 3, z, 0.5, 1.2, 0.5, 62, Rc()); }
    x += w + 6 + Rc() * 16;
  }
  // towers far off in the haze
  for (let x = -330; x < 330;) {
    const w = 14 + Rc() * 18, d = 12 + Rc() * 14, z = farZ(x) + 150 + Rc() * 30, h = 25 + Rc() * 55, y = ground(x + w / 2, z);
    B0(x + w / 2, y + h / 2, z, w, h, d, 65, Rc() * 0.5); if (h > 60) B0(x + w / 2, y + h + 0.6, z, 0.6, 1.2, 0.6, 62, Rc());
    x += w + 35 + Rc() * 70;
  }
  // a riverside temple: its ordination hall facing the water, floodlit, a chedi beside it, a landing with a sala on the bank
  { const tx = -95, tz = farZ(-95) + 20, ty = ground(tx, tz);
    thaiHall(local(tx, ty - 0.3, tz, PI), 64);
    profile(tx + 15, ty, tz + 4, 0.85, BELL(32, 7)); B0(tx + 15, ty + 0.55, tz + 4, 8.5, 1.1, 8.5, 64);
    for (const ex of [-1, 1]) B0(tx + ex * 12, ty + 1.0, farZ(tx) + 6, 0.5, 2.0, 0.5, 64);
    const S = local(tx, ty, farZ(tx) + 4, PI); S.stamp(SALA, 0, 0, 0, 0.7, 0.3); }
  // the old palace by the bridge (in the manner of วังบางขุนพรหม): two storeys of cream-yellow render, pilasters and arched windows, a portico of
  // columns under a pediment in the middle, a grey roof; floodlit in its garden of big trees behind a railing
  { const px0 = 126, pz = farZ(126) + 32, y = ground(px0, pz);
    B0(px0, y + 5, pz, 46, 10, 12, 68, 0.3, 0, 0, PI); B0(px0, y + 11.1, pz, 46.6, 2.4, 12.6, 9, 0.62, 0, 1);
    B0(px0, y + 6.2, pz - 7.2, 12, 12.4, 2.6, 68, 0.6, 0, 0, PI); B0(px0, y + 13.6, pz - 7.2, 2.8, 2.4, 12.8, 68, 0.6, 0, 1, PI / 2);
    for (let k = 0; k < 6; k++) T0(px0 - 5 + k * 2, y, pz - 8.9, 0.34, px0 - 5 + k * 2, y + 10, pz - 8.9, 0.3, 32);
    for (const ex of [-1, 1]) B0(px0 + ex * 24.2, y + 5.6, pz, 3.6, 11.2, 13, 68, 0.3, 0, 0, PI);
    for (let x = 96; x < 158; x += 2.5) B0(x, y + 0.7, pz - 22, 0.12, 1.4, 0.12, 27, 0.2); B0(127, y + 1.35, pz - 22, 62, 0.08, 0.1, 64);
    for (const ex of [-1, 1]) B0(px0 + ex * 4, y + 1.4, pz - 22, 0.8, 2.8, 0.8, 64);
    for (let k = 0; k < 9; k++) { const x = 98 + Rc() * 58, z = pz - 12 - Rc() * 8; if (abs(x - px0) < 8) continue; plant(TREES[[10, 1, 0][floor(Rc() * 3)]], x, z, Rc() * TAU, 0.8 + Rc() * 0.3, 2, false); }
  }
  // Phra Sumen fort (ป้อมพระสุเมรุ) downstream on that bank: white, eight-sided, its parapet crenellated, a lookout on top, floodlit
  { const fx = 205, fz = farZ(fx) + 14, y = ground(fx, fz);
    T0(fx, y - 0.5, fz, 9.2, fx, y + 6, fz, 8.8, 32);
    for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; B0(fx + cos(a) * 8.7, y + 6.4, fz + sin(a) * 8.7, 0.9, 0.8, 0.5, 64, 0, 0, 0, -a); }
    T0(fx, y + 6, fz, 3.6, fx, y + 9.5, fz, 3.4, 32); T0(fx, y + 9.5, fz, 4.4, fx, y + 12.5, fz, 0.3, 3); }
  // Rama VIII bridge (สะพานพระราม 8), just upstream of the fair: the deck on piers from the land on this side out over the river, one pylon on this bank
  // in the shape of an upturned Y, the cables in a single fan along the middle of the deck, all of it lit gold. The fair is held under it.
  { const bx = 70, pz = 28, dh = 14, zA = -185, zB = 318;
    for (let z = zA; z < zB; z += 8) B0(bx, dh, z + 4, 12, 1.0, 8.05, 2);
    for (let z = zA; z < zB; z += 5) for (const s of [-1, 1]) B0(bx + s * 5.8, dh + 1.0, z, 0.16, 0.16, 0.16, 10);
    for (let z = zA + 18; z < zB; z += 36) { if (abs(z - pz) < 24) continue; const base = min(ground(bx, z), WL); B0(bx, (base + dh) / 2, z, 3, dh - base, 4, 64); }
    for (const s of [-1, 1]) T0(bx + s * 10.5, ground(bx, pz) - 0.5, pz, 1.8, bx, 64, pz, 1.2, 32);
    for (const s of [-1, 1]) OBST.push([bx + s * 10.5, pz, 2.3]);
    T0(bx, 64, pz, 1.35, bx, 117, pz, 0.8, 32); B0(bx, dh - 1, pz, 19, 1.2, 2.4, 64); B0(bx, 118, pz, 0.7, 1.4, 0.7, 62);
    for (let k = 1; k <= 13; k++) { const ty = 72 + k * 3.3; T0(bx, ty, pz, 0.13, bx, dh + 0.6, pz + 14 + k * 12.5, 0.13, 31); T0(bx, ty, pz, 0.13, bx, dh + 0.6, pz - 12 - k * 7.5, 0.13, 31); }
    for (const s of [-1, 1]) lamp(bx + s * 7, 2.5, pz - 7, 24, [3.0, 2.3, 1.4], 0.015);
  }
} else {
  // a village over the water: a few lit windows and bulbs among the trees, a string of lanterns at its landing
  for (let i = 0; i < 34; i++) { const x = (R() - 0.5) * (RIVER ? 380 : 200), z = farZ(x) + 6 + R() * 30; B0(x, ground(x, z) + 1.6 + R() * 2.4, z, 0.3, 0.3, 0.3, 10); }
  for (let i = 0; i < 16; i++) { const x = -70 + i * 2.2, z = farZ(x) + 2; lantern(x, ground(x, z) + 2.6, z, R(), 1.6); }
  if (PL.far === 'ruins') {
    // Sukhothai: old bell-shaped chedis over the pond, pale in the candlelight, a ring of candles at the foot of each
    for (const [x, dz, s] of [[-62, 16, 0.9], [-30, 26, 1.25], [4, 18, 0.8], [28, 30, 1.1], [58, 20, 0.95], [86, 34, 0.7], [-88, 30, 0.75]]) {
      const z = farZ(x) + dz, y = ground(x, z);
      B0(x, y + 0.5 * s, z, 8 * s, 1.0 * s, 8 * s, 58, R()); B0(x, y + 1.25 * s, z, 6.2 * s, 0.6 * s, 6.2 * s, 58, R());
      profile(x, y + 0.2 * s, z, s, BELL(30, 30));
      for (let k = 0; k < 20; k++) { const a = k / 20 * TAU; B0(x + cos(a) * 4.6 * s, y + 0.06, z + sin(a) * 4.6 * s, 0.05, 0.1, 0.05, 10); }
      lamp(x, y + 2, z - 5 * s, 14, [1.6, 1.0, 0.45], 0.05);
    }
  }
}
// everything that stands still goes to the GPU once; leaves from different trees are interleaved so that drawing the first third or ninth thins every tree evenly
await LD.step('กำลังเขียนป้ายร้าน', 68);
await drawSigns();
await LD.step('กำลังส่งข้อมูลขึ้นการ์ดจอ', 70);
for (const c of chunks.values()) {
  const seg = new Float32Array(c.far.length + c.segs.length); seg.set(c.far); seg.set(c.segs, c.far.length);
  c.nSegFar = c.far.length / 10; c.nSeg = seg.length / 10; c.segB = c.nSeg ? vbuf(seg) : null;
  c.nBox = c.boxes.length / 12; c.boxB = c.nBox ? vbuf(new Float32Array(c.boxes)) : null;
  const nL = c.leaves.length / 12, lf = new Float32Array(c.leaves.length), src = Float32Array.from(c.leaves), order = new Uint32Array(nL), Rs = rng(c.cx * 31 + c.cz * 17 + 5);
  for (let i = 0; i < nL; i++) order[i] = i; for (let i = nL - 1; i > 0; i--) { const j = floor(Rs() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
  for (let i = 0; i < nL; i++) lf.set(src.subarray(order[i] * 12, order[i] * 12 + 12), i * 12);
  c.nLeaf = nL; c.leafB = nL ? vbuf(lf) : null; c.segs = c.far = c.boxes = c.leaves = null;
}

// --------------------------------------------------------------------------------------------------------- afloat and aloft
// The water carries krathongs all night: set afloat from landings upstream, from the far bank, from here. On the river each drifts with the
// current, turning slowly; on a pond they wander slowly to and fro. Each carries someone's wish (Wishes.pick()).
// RK: x, z, turn, rate of turn, kind, own speed, lit, vz (a push out from the bank that dies away), wish, own (the walker's)
await LD.step('กำลังรับคำอธิษฐานจากทั่วประเทศ', 78);
await wishesP;
await LD.step('กำลังปล่อยกระทงลงน้ำ', 84);
const RK = [];
const riverZ = (x, u) => { const z0 = bankZ(x) + 3.2, z = z0 + u * u * (RIVER ? 62 : farZ(x) - z0 - 7); return abs(x) < 6 && z < 64.5 ? 64.5 + u * 8 : z; };
const PONDX = PX - 30;
for (let i = 0; i < (RIVER ? (LOW ? 50 : 150) : (LOW ? 40 : 90)); i++) {
  const x = (R() - 0.5) * (RIVER ? 300 : PONDX * 2);
  RK.push({ x, z: riverZ(x, R()), yaw: R() * TAU, w: (R() - 0.5) * 0.3, kind: floor(R() * 4), sp: RIVER ? 0.16 + 0.14 * R() : (R() < 0.5 ? -1 : 1) * (0.03 + 0.06 * R()), lit: R() < 0.94, vz: 0, ph: R() * TAU, mine: false, wish: Wishes.pick() });
}
// Sky lanterns in the air: x y z, speed upward, a phase for their swaying, size, kind of paper, own (one the walker let go), wish
const SL = [];
const LK_AMB = () => { const r = Math.random(); return r < 0.55 ? 0 : r < 0.7 ? 1 : r < 0.85 ? 2 : 3; };
const launch = (x, y, z, own = false, kind = LK_AMB(), wish = null, vx = 0, vz = 0) => { const l = { x, y, z, vx, vz, vy: own ? 0.35 : 0.6, ph: R() * TAU, s: 0.9 + 0.25 * R(), own, age: 0, kind, wish: wish || Wishes.pick() }; SL.push(l); return l; };
const ROUND = () => { const a = R() * TAU, r = 25 + Math.sqrt(R()) * 300; return [r * cos(a), r * sin(a) + 30]; };      // somewhere round about the fair, in any direction
for (let i = 0; i < floor((LOW ? 30 : 70) * min(PL.sky, 2.4)); i++) { const [x, z] = ROUND(); launch(x, 30 + R() * 200, z).vy = 1.6; }
const FWK = [{ az: 0, el: 0, t0: -99, seed: 0 }, { az: 0, el: 0, t0: -99, seed: 0 }]; let fwNext = 6, fwI = 0;
const INC = [];      // the incense the walker has lit at the altar, still smouldering in the pot: [x, z, lean x, lean z]

// --------------------------------------------------------------------------------------------------------- the people
// The fair has people in it, each built of eight or nine of the engine's boxes: a head (the face and hair are painted on it by the shader),
// a body, two arms that swing from the shoulder, two legs that swing from the hip, and for some women a pha sin over the legs.
// Some keep the stalls, some stand talking or watch the water and the lanterns, and the rest stroll the walks from one place to the next
// (PNODE: x, z, how far from it they may stand, and for some which way they turn to look while they stop there; PLINK: the walks between).
// Some of the strollers buy a krathong, carry it down to the pier, kneel at the edge of the landing, light it, bow over it and set it on the
// water (PSPOT: the places at the edge; the middle is left free for the walker), then go back to the fair.
await LD.step('กำลังเชิญผู้คนมาเที่ยวงาน', 90);
const PPL = [], PR = rng(7391 + PL.idx);
const person = (x, z, yaw, o) => {
  const kid = PR() < 0.13, hair = PR();
  const p = Object.assign({ x, z, yaw, hy: 0, s: kid ? 0.62 + 0.14 * PR() : 0.92 + 0.13 * PR(), tone: PR(), top: PR(), leg: PR(), hair, skirt: !kid && hair > 0.5 && PR() < 0.6, ph: PR() * TAU, v: 0, walk: false, hold: -1, lit: false, up: 0, lan: -1, lanW: 1 }, o);
  PPL.push(p); if (!p.walk && !p.up) OBST.push([x, z, 0.3]); return p;
};
const PNODE = [[0, -60, 1.6], [0, -42, 1.7], [0, -16, 1.7], [0, 16, 1.5], [0, 39.6, 1.5], [0, 46.6, 1.1, 0], [-17, -16, 1.2, -PI / 2], [8, -16, 1.1, PI / 2], [8, -43, 1.1, PI / 2], [8, -1, 1.1, PI / 2],
  [21, 16, 0.9, PI / 2], [-44, 42.3, 1, 0], [44, 42.3, 1, 0], [-18, 42.3, 1, 0], [22, 42.3, 1, 0], [8.4, -24.5, 1, PI / 2], [0, 53.2, 0.6], [0, 58.7, 0.8, 0]];
const PLINK = [[1], [0, 2], [1, 3, 6, 7], [2, 4, 10], [3, 5, 13, 14], [4, 16], [2], [2, 15, 9], [15], [7], [3], [13], [14], [4, 11], [4, 12], [7, 8], [5, 17], [16]];
if (PARK) {      // the retro market's lane (before its stalls on either hand) and the tables of the krathong contest
  const n0 = PNODE.length; PNODE.push([-27, -16, 1.3], [-29.3, -24, 0.9, -PI / 2], [-24.7, -24, 0.9, PI / 2], [-29.3, -8, 0.9, -PI / 2], [-24.7, -8, 0.9, PI / 2], [-29.3, -16, 0.8, -PI / 2], [-30, 13.4, 2.6, 0], [-30, 22.6, 2.6, PI]);
  PLINK[6].push(n0); PLINK.push([6, n0 + 1, n0 + 2, n0 + 3, n0 + 4, n0 + 5], [n0, n0 + 2], [n0, n0 + 1], [n0, n0 + 4], [n0, n0 + 3], [n0], [3, n0 + 7], [n0 + 6, 4]);
  PLINK[3].push(n0 + 6); PLINK[4].push(n0 + 7);
}
const N_STALL = 15, N_PIER = 17, PSPOT = [-2.5, -1.65, 1.65, 2.5].map((x) => ({ x, who: null }));
const PHOP = (a) => { const hop = new Array(PNODE.length).fill(-1), q = [a]; hop[a] = a; for (let i = 0; i < q.length; i++) for (const n of PLINK[q[i]]) if (hop[n] < 0) { hop[n] = q[i]; q.push(n); } return hop; };
const N_LAWN = PNODE.length;
if (LSPOT.length) {      // the lantern lawn: a place round each lantern filling on the grass, where people stand watching it (and may let it go)
  LSPOT.forEach(([x, z]) => PNODE.push([x, z, 1.7, 0, [x, z]]));
  const L = LSPOT.map((_, k) => N_LAWN + k);
  PLINK[10].push(...L, 14); PLINK[14].push(10, 10); PLINK[3].push(10, 10);      // (named more than once: those passing are drawn onto the lawn, as they are on the night)
  L.forEach((n, k) => PLINK.push([10, ...L.filter((m) => m !== n).slice(0, 3), k % 2 ? 14 : 10]));
}
const TO_PIER = PHOP(N_PIER), TO_LAWN = LSPOT.length ? PHOP(10) : null, LAWN_WANT = LSPOT.length * (LOW ? 1 : 2);
let lawnN = 0;
const aimAt = (p, n, rnd01) => { const N = PNODE[n], a = rnd01() * TAU, r = N[4] ? 0.8 + 0.5 * rnd01() : Math.sqrt(rnd01()) * N[2]; p.to = n; p.tx = N[0] + cos(a) * r; p.tz = N[1] + sin(a) * r; };      // (by a lantern: on a ring round it, not in it)
{ // behind every stall its keeper, and here and there someone buying
  for (const sh of SHOPS) { const j = (PR() - 0.5) * 1.2; person(sh.kx + sh.ax * j, sh.kz + sh.az * j, sh.yaw); }
  SHOPS.slice(5).forEach((sh) => { if (PR() < (LOW ? 0.3 : 0.7)) { const j = (PR() - 0.5) * 1.6, x = sh.x + sh.ax * j - Math.sin(sh.yaw) * 0.4, z = sh.z + sh.az * j - Math.cos(sh.yaw) * 0.4; person(x, z, sh.yaw + PI + (PR() - 0.5) * 0.4); } });
  for (const [x, z] of LOW ? [[9.3, -33.4]] : [[9.3, -33.4], [9.35, -11.3], [9.3, -2.5], [9.4, -3.5], [9.3, -41.2]]) person(x, z, PI / 2 + (PR() - 0.5) * 0.5);
  // along the water's walk, looking out over it
  for (let i = 0; i < (LOW ? 4 : 9); i++) { const x = (i % 2 ? 1 : -1) * (5 + PR() * 44); if (canStand(x, 43.5)) person(x, 43.45, (PR() - 0.5) * 0.7); }
  // round the lanterns filling on the lawn
  // (people on the lantern lawn are among the strollers below: they come to the lanterns, watch them, let some go and walk on)
  // before the stage: the pageant's girls on it, a crowd watching
  if (PL.lawn === 'stage') {
    for (let k = 0; k < 4; k++) person(STAGE[0] - 0.6 - (k % 2) * 0.8, STAGE[1] - 3 + k * 2, -PI / 2, { up: 1.0, skirt: true, hair: 0.6 + PR() * 0.3, s: 0.98 });
    for (let k = 0; k < (LOW ? 6 : 16); k++) { const x = 28 + PR() * 8, z = 10 + PR() * 12; if (canStand(x, z)) person(x, z, PI / 2 + (PR() - 0.5) * 0.5); }
  }
  // twos and threes standing talking on the swept earth beside the walks
  let made = 0, tries = 0;
  while (made < (LOW ? 3 : 8) && tries++ < 400) {
    const x = (PR() < 0.5 ? -1 : 1) * (6 + PR() * 11), z = -58 + PR() * 90, n = PR() < 0.35 ? 3 : 2; let ok = !(x > 4 && x < 19 && z > -49 && z < 6) && abs(z + 16) > 4 && !(x > 0 && abs(z - 16) < 3.5);
    for (let k = 0; ok && k < 8; k++) ok = canStand(x + cos(k * 0.785) * 1.6, z + sin(k * 0.785) * 1.6);
    for (const o of OBST) if (hypot(x - o[0], z - o[1]) < o[2] + 2.2) ok = false;
    if (!ok) continue;
    const a0 = PR() * TAU; for (let k = 0; k < n; k++) { const a = a0 + k * TAU / n, px = x + sin(a) * 0.62, pz = z + cos(a) * 0.62; person(px, pz, a + PI + (PR() - 0.5) * 0.4); }
    made++;
  }
  // and those who stroll
  for (let i = 0; i < (LOW ? 9 : PARK ? 34 : 24) + LSPOT.length * (LOW ? 1 : 2); i++) {
    const p = person(0, 0, 0, { walk: true, from: 0, wait: 0, look: undefined, act: 0, t: 0, kn: 0, bow: 0, rel: 0, buy: false, spot: null, kx: 0, ky: 0, kz: 0 });
    if (p.s > 0.8 && (i < 2 || PR() < 0.3)) p.hold = floor(PR() * 4);
    const START = PNODE.map((_, k) => k).filter((k) => k !== 16 && k !== N_PIER), a = i < 2 ? 3 + i : i < 2 + LSPOT.length * 2 && LSPOT.length ? N_LAWN + (i % LSPOT.length) : START[floor(PR() * START.length)], b = p.hold >= 0 ? TO_PIER[a] : PLINK[a][floor(PR() * PLINK[a].length)], t = PR();
    p.from = a; aimAt(p, b, PR); p.x = mix(PNODE[a][0], p.tx, t); p.z = mix(PNODE[a][1], p.tz, t); p.yaw = atan2(p.tx - p.x, p.tz - p.z); p.sp = (p.s < 0.8 ? 1.15 : 0.7) + 0.5 * PR();
  }
}
const turnTo = (p, want, rate) => { let a = want - p.yaw; a -= Math.round(a / TAU) * TAU; p.yaw += clamp(a, -rate, rate); return a; };
function movePeople(dt, ex, ez) {
  if (TO_LAWN) { lawnN = 0; for (const q of PPL) if (q.walk && hypot(q.x - LAWN[0], q.z - LAWN[1]) < 13) lawnN++; }
  for (const p of PPL) {
    if (p.act === 2) {                // at the water's edge: down on the knees, the candle lit, a bow over it, the krathong onto the water, up again
      p.t += dt; turnTo(p, 0, dt * 3); p.v *= 1 - min(1, dt * 6); p.hy *= 1 - min(1, dt * 3);
      p.kn = sm(0, 0.9, p.t) * (1 - sm(7.2, 8.1, p.t)); p.bow = sm(1.6, 2.2, p.t) * (1 - sm(4.4, 5, p.t)); p.rel = sm(5.2, 6.4, p.t);
      if (p.t > 1.1 && p.hold >= 0) p.lit = true;
      if (p.t > 6.4 && p.hold >= 0) {       // afloat. (The count is kept: the krathong furthest away becomes this one, with a new wish.)
        let far = null; for (const k of RK) if (!k.mine && (!far || abs(k.x - ex) > abs(far.x - ex))) far = k;
        if (far) { far.x = p.x; far.z = PIER.zp + 0.5; far.yaw = p.yaw; far.kind = p.hold; far.lit = true; far.vz = 0.5; far.wish = Wishes.pick(); if (!RIVER) far.sp = (Math.random() < 0.5 ? -1 : 1) * (0.03 + 0.05 * Math.random()); }
        p.hold = -1; p.lit = false;
      }
      if (p.t > 8.1) { p.act = 0; p.kn = p.bow = p.rel = 0; p.spot.who = null; p.spot = null; p.from = N_PIER; aimAt(p, 16, Math.random); }
      continue;
    }
    if (!p.walk || p.wait > 0) {      // standing: the head turns to whoever comes near, or wanders a little
      let want = 0.3 * sin(time * 0.35 + p.ph);
      if (hypot(ex - p.x, ez - p.z) < 3.5) { let a = atan2(ex - p.x, ez - p.z) - p.yaw; a -= Math.round(a / TAU) * TAU; if (abs(a) < 2) want = clamp(a, -1.1, 1.1); }
      p.hy += (want - p.hy) * min(1, dt * 3);
      if (!p.walk) continue;
      p.wait -= dt; p.v *= 1 - min(1, dt * 6); if (p.look !== undefined) turnTo(p, p.look, dt * 2.5);
      if (p.wait <= 0 && p.buy) { p.buy = false; p.hold = floor(Math.random() * 4); }      // bought
      if (p.wait <= 0 && p.lspot) { if (p.lan >= 0) launch(p.kx, p.ky + 0.15, p.kz, false, p.lan); p.lan = -1; p.lspot = null; }      // the lantern let go
      continue;
    }
    p.hy *= 1 - min(1, dt * 3);
    let dx = p.tx - p.x, dz = p.tz - p.z; const d = hypot(dx, dz);
    if (d < (p.act === 1 ? 0.12 : 0.4)) {
      if (p.act === 1) { p.act = 2; p.t = 0; continue; }
      const N = PNODE[p.to], from = p.from === p.to ? -1 : p.from, opts = PLINK[p.to].filter((n) => n !== from), carry = p.hold >= 0; p.from = p.to;
      if (carry && p.to === N_PIER) {       // on the landing with a krathong: to a free place at the edge, or wait for one
        const free = PSPOT.filter((q) => !q.who);
        if (free.length) { const q = free[floor(Math.random() * free.length)]; q.who = p; p.spot = q; p.act = 1; p.tx = q.x; p.tz = PIER.zp - 0.5; } else { p.wait = 2; p.look = 0; }
        continue;
      }
      if (!carry && p.to === N_STALL && p.s > 0.8 && Math.random() < 0.6) { p.buy = true; p.wait = 4 + Math.random() * 5; p.look = N[3]; }
      else if (N[4] && !carry && p.s > 0.8) { const a = atan2(p.x - N[4][0], p.z - N[4][1]); p.wait = p.lanW = 7 + Math.random() * 9; p.look = a + PI; p.lspot = N[4]; p.lan = LK_AMB(); }      // on the lawn: a lantern of their own lit and filled, then let go
      else if (!carry && (Math.random() < (N[3] !== undefined ? 0.65 : 0.12) || !opts.length)) { p.wait = 3 + Math.random() * 10; p.look = N[3]; }
      let next = carry ? TO_PIER[p.to] : opts.length ? opts[floor(Math.random() * opts.length)] : PLINK[p.to][0];
      if (!carry && TO_LAWN && lawnN < LAWN_WANT && Math.random() < 0.6 && !PNODE[p.to][4]) next = p.to === 10 ? N_LAWN + floor(Math.random() * LSPOT.length) : TO_LAWN[p.to];      // (the lawn wants people)
      aimAt(p, next, Math.random); continue;
    }
    dx /= d; dz /= d;
    if (p.act !== 1) {                // whatever stands in the way is gone round, always on the same hand
      const shy = (ox, oz, rr, k) => { const ax = p.x - ox, az = p.z - oz, a = hypot(ax, az); if (a < rr && a > 1e-3) { const w = k * (1 - a / rr) / a; dx += (ax + az * 0.7) * w; dz += (az - ax * 0.7) * w; } };
      shy(ex, ez, 1.5, 1.8);
      for (const o of OBST) if (abs(o[0] - p.x) < 2 && abs(o[1] - p.z) < 2) shy(o[0], o[1], o[2] + 0.75, 1.5);
      for (const o of RECT) { const cx = clamp(p.x, o[0], o[2]), cz = clamp(p.z, o[1], o[3]); if (abs(cx - p.x) < 1.4 && abs(cz - p.z) < 1.4) shy(cx, cz, 0.75, 1.5); }      // stalls, benches, tables: gone round by their nearest edge
      for (const q of PPL) if (q !== p && q.walk && abs(q.x - p.x) < 1 && abs(q.z - p.z) < 1) shy(q.x, q.z, 0.95, 1);
    }
    const a = turnTo(p, atan2(dx, dz), dt * 3.5);
    p.v += (p.sp * (p.act === 1 ? 0.6 : 1) * max(0.15, cos(min(abs(a), PI / 2))) - p.v) * min(1, dt * 4);
    p.x += sin(p.yaw) * p.v * dt; p.z += cos(p.yaw) * p.v * dt; p.ph += p.v * dt * 4.3 / p.s;
    if (p.z > 43) { const w = p.z > 57 ? 2.8 : 1.9; p.x = clamp(p.x, -w, w); }      // nobody is edged off the pier
  }
}
// One person as blocks (12 floats a block: middle and turn, size and tilt, material, seed, skin tone, 0). In the person's own frame (x across,
// y up, z forward, in an adult's metres). Limbs hang from their joints at an angle t (0 straight down, forward positive), each in two pieces
// with a joint between: thigh and shin (the knee bends), upper arm and forearm (the elbow bends), then a foot or a hand. The body is in two:
// the hips, and the chest leaning from the waist. The head is large, as in a stylised game, its face drawn on its front in pixels.
// coarse: seen from far off, three blocks.
const PART = new Float32Array(140 * 20 * 12), partB = device.createBuffer({ size: PART.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
let pN = 0, bP = null, bCy = 1, bSy = 0, bY = 0;
const qa = [0, 0, 0], J = [0, 0, 0];
const at = (o, lx, ly, lz) => { const s = bP.s; o[0] = bP.x + (lx * bCy + lz * bSy) * s; o[1] = bY + ly * s; o[2] = bP.z + (-lx * bSy + lz * bCy) * s; return o; };
const blk = (lx, ly, lz, sx, sy, sz, pitch, mat, seed, dyaw = 0, flag = 0) => { const k = pN * 12, s = bP.s; at(qa, lx, ly, lz); pN++;
  PART[k] = qa[0]; PART[k + 1] = qa[1]; PART[k + 2] = qa[2]; PART[k + 3] = bP.yaw + dyaw; PART[k + 4] = sx * s; PART[k + 5] = sy * s; PART[k + 6] = sz * s; PART[k + 7] = pitch;
  PART[k + 8] = mat; PART[k + 9] = seed; PART[k + 10] = bP.tone; PART[k + 11] = flag; };
// a limb from the joint (x, y, z) at angle t, len long (a little more, so that no gap opens at the joint as it bends); J: where it ends
const limb = (x, y, z, t, len, w, d, mat, seed, draw = true) => { const dy = -cos(t), dz = sin(t); if (draw) blk(x, y + dy * len / 2, z + dz * len / 2, w, len + w * 0.4, d, -t, mat, seed); J[0] = x; J[1] = y + dy * len; J[2] = z + dz * len; return J; };
function putPerson(n, p, coarse) {
  pN = n; bP = p; bCy = cos(p.yaw); bSy = sin(p.yaw);
  const kid = p.s < 0.8, hs = kid ? 1.18 : 1, go = p.walk ? min(1, p.v / 0.8) : 0, sw = sin(p.ph) * 0.55 * go, kn = p.kn || 0, bow = p.bow || 0, woman = p.hair > 0.5;
  bY = surf(p.x, p.z) + p.up + abs(cos(p.ph)) * 0.025 * go;
  const dance = p.up ? sin(time * 1.3 + p.ph) * 0.5 : 0;      // (on the stage the arms rise and fall slowly in turn, the elbows bent, as in a Thai dance)
  const hipY = mix(0.8, 0.5, kn), lean = 0.4 * kn + 0.35 * bow, cl = cos(lean), sl = sin(lean), wY = hipY + 0.1;
  const top = woman && !kid && p.top > 0.55 ? 3 : 2, shorts = !p.skirt && p.leg > 0.65, longSleeve = p.top > 0.86, hairS = fract(p.tone * 17.31);
  const hand = [0, 0, 0];
  if (coarse) {
    blk(0, hipY / 2 + 0.05, 0, 0.3, hipY + 0.1, 0.18, 0, p.skirt ? 4 : 5, p.leg);
    hand[1] = wY + 0.15; hand[2] = 0.3;
  } else {
    for (const side of [-1, 1]) {
      // the legs: as one swings back the knee bends; kneeling, the thigh stands upright and the shin lies back along the ground
      // (in a pha sin the steps are short, as they are in a tube skirt, and the legs stay inside it: only the feet show at the hem)
      const swk = p.skirt ? 0.26 : 1, hx = side * (p.skirt ? 0.07 : 0.085), t1 = mix(side * sw * swk, 0, kn), t2 = mix(t1 - (max(0, -side * sw) * 0.9 + 0.08 * go) * swk, -1.55, kn);
      const legs = !p.skirt || kn > 0.05;      // (a pha sin covers the legs to the ankle: under it, standing or walking, only the feet are drawn)
      limb(hx, hipY, 0, t1, 0.4, 0.125, 0.135, p.skirt ? 0 : 5, p.skirt ? p.tone : p.leg, legs);
      const k0 = J[0], k1 = J[1], k2 = J[2];
      limb(k0, k1, k2, t2, 0.37, 0.105, 0.115, shorts || p.skirt ? 0 : 5, shorts || p.skirt ? p.tone : p.leg, legs);
      const fy = J[1] + sin(t2) * 0.05 - cos(t2) * 0.03, fz = J[2] + cos(t2) * 0.05 + sin(t2) * 0.03;
      blk(J[0], fy, fz, 0.11, 0.07, 0.21, -t2, 6, 0);
      // the arms: walking they swing, the elbow a little bent; carrying a krathong the forearms are held out level; making a wai the palms
      // come together before the chest; dancing they rise and fall in turn
      let ta, tf;
      if (p.hold >= 0 || p.lan >= 0) { ta = mix(0.45, 0.6, kn); tf = 1.5; }
      else if (p.up) { ta = 0.75 + side * dance; tf = ta + 1.15; }
      else if (bow > 0.05) { ta = mix(0, 0.3, bow); tf = mix(0.2, 2.55, bow); }
      else { ta = mix(-side * sw * 0.8 + 0.04 * sin(time * 0.9 + p.ph), 0.3, kn); tf = ta + 0.2 + 0.35 * go; }
      const sy = wY + cl * 0.4, sz = sl * 0.4;
      limb(side * 0.215, sy, sz, ta + lean * 0.5, 0.27, 0.1, 0.105, top === 3 ? 2 : top, p.top);
      const e0 = J[0], e1 = J[1], e2 = J[2];
      limb(e0 - side * (bow > 0.05 && p.hold < 0 ? 0.06 * bow : 0), e1, e2, tf + lean * 0.5, 0.23, 0.085, 0.09, longSleeve ? (top === 3 ? 2 : top) : 0, longSleeve ? p.top : p.tone);
      const hy = J[1] - cos(tf + lean * 0.5) * 0.045, hz = J[2] + sin(tf + lean * 0.5) * 0.045;
      blk(J[0], hy, hz, 0.07, 0.1, 0.06, -(tf + lean * 0.5), 0, p.tone);
      hand[1] += hy * 0.5; hand[2] += hz * 0.5;
    }
    // the hips, or a pha sin from the waist to the ankles (bunched over the legs when kneeling)
    if (p.skirt && kn > 0.05) { const bot = 0.075, tp = wY + 0.02; blk(0, (tp + bot) / 2, kn * 0.14, 0.32, tp - bot, 0.24 + kn * 0.36, 0, 4, p.leg); }      // kneeling: spread over the folded legs
    else if (p.skirt) {      // a pha sin: slim, fitted at the hips and a little narrower to the hem, swinging a little with the steps
      const bot = 0.085, tp = wY + 0.02, mid = mix(bot, tp, 0.6), sway = sin(p.ph * 2) * 0.025 * go;
      blk(0, (tp + mid) / 2, 0, 0.31, tp - mid + 0.02, 0.21, sway * 0.5, 4, p.leg, 0, 1);
      blk(0, (mid + bot) / 2, 0, 0.27, mid - bot, 0.19, sway, 4, p.leg);
    }
    else blk(0, hipY + 0.03, 0, 0.31, 0.18, 0.19, 0, 5, p.leg);
  }
  // the chest, leaning from the waist; the neck; the head (turned toward whoever is near: p.hy), and its hair
  blk(0, wY + cl * 0.22, sl * 0.22, 0.34, 0.44, 0.2, lean, top, p.top);
  const nY = wY + cl * 0.47, nZ = sl * 0.47;
  if (!coarse) blk(0, nY, nZ, 0.1, 0.09, 0.1, lean, 0, p.tone);
  const hY = nY + 0.17 * hs, hZ = nZ + sl * 0.1 + 0.01, hp = lean * 0.6, ch = cos(p.hy), shh = sin(p.hy);
  blk(0, hY, hZ, 0.27 * hs, 0.26 * hs, 0.25 * hs, hp, woman ? 8 : 7, p.tone, p.hy);
  const hb = (ox, oy, oz, sx, sy, sz) => blk(ox * ch + oz * shh, hY + oy, hZ - ox * shh + oz * ch, sx, sy, sz, hp, 1, hairS, p.hy);
  hb(0, 0.145 * hs, -0.01 * hs, 0.29 * hs, 0.06 * hs, 0.28 * hs);                                         // the crown
  if (!coarse) hb(0, woman ? -0.09 * hs : 0.03 * hs, -0.135 * hs, 0.29 * hs, woman ? 0.42 * hs : 0.21 * hs, 0.05 * hs);      // the back: long, down to the shoulders, for a woman
  at(qa, 0, hand[1] + 0.03, hand[2] + 0.06); p.kx = qa[0]; p.ky = qa[1]; p.kz = qa[2];
  return pN;
}

// --------------------------------------------------------------------------------------------------------- sound
// All synthesised: crickets, the water lapping at the piles, a little wind, the music of the fair, footsteps (on earth, on boards),
// the temple bell when a wish is made, the thud and crackle of fireworks. M mutes.
let AC = null, SND = null, mute = false;
function initSound() {
  if (AC) return; const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
  AC = new C(); const master = AC.createGain(); master.gain.value = mute ? 0 : 0.9; master.connect(AC.destination);
  const nb = AC.createBuffer(1, AC.sampleRate * 5, AC.sampleRate), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = () => { const n = AC.createBufferSource(); n.buffer = nb; n.loop = true; n.start(0, Math.random() * 4); return n; };
  const band = (src, type, f, q) => { const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gn = AC.createGain(); gn.gain.value = 0; src.connect(fl); fl.connect(gn); gn.connect(master); return { f: fl.frequency, g: gn.gain }; };
  SND = { master, nb, wind: band(noise(), 'bandpass', 340, 0.5), leaves: band(noise(), 'bandpass', 2600, 0.8), water: band(noise(), 'lowpass', 420, 0.3), lap: band(noise(), 'bandpass', 1400, 0.9), tCrick: 0, tNote: 0, si: 0 };
}
function voice(type, t0, fq, env, vol, pan = 0, bp = 0) {
  const o = AC.createOscillator(), gn = AC.createGain(); o.type = type; let last = o;
  o.frequency.setValueAtTime(fq[0][1], t0 + fq[0][0]); for (let i = 1; i < fq.length; i++) o.frequency.exponentialRampToValueAtTime(fq[i][1], t0 + fq[i][0]);
  gn.gain.setValueAtTime(0, t0); for (const e of env) gn.gain.linearRampToValueAtTime(e[1] * vol, t0 + e[0]);
  if (bp) { const fl = AC.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = bp; fl.Q.value = 1.6; o.connect(fl); last = fl; }
  last.connect(gn); let out = gn; if (AC.createStereoPanner) { const pn = AC.createStereoPanner(); pn.pan.value = pan; gn.connect(pn); out = pn; }
  out.connect(SND.master); const end = t0 + env[env.length - 1][0] + 0.05; o.start(t0); o.stop(end);
}
const rnd = (a, b) => a + Math.random() * (b - a);
function cricket(t, vol) { const f = rnd(4100, 4900), pan = rnd(-1, 1), n = 3 + floor(rnd(0, 2)); for (let i = 0; i < n; i++) voice('sine', t + i * 0.034, [[0, f], [0.02, f * 1.01]], [[0.004, 1], [0.016, 0.9], [0.024, 0]], vol * 0.16, pan); }
function burst(t, dur, type, f, f1, q, vol) {
  const n = AC.createBufferSource(), fl = AC.createBiquadFilter(), gn = AC.createGain(); n.buffer = SND.nb; n.loop = true; fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(vol, t + min(0.02, dur * 0.2)); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(fl); fl.connect(gn); gn.connect(SND.master); n.start(t, Math.random() * 3); n.stop(t + dur + 0.05);
}
const sndOK = () => SND && AC.state === 'running';
function bell(vol) { if (!sndOK()) return; const t = AC.currentTime + 0.05; for (const [m, a, d] of [[1, 1, 6], [2.0, 0.5, 4.5], [2.76, 0.35, 3.2], [4.1, 0.2, 2], [5.4, 0.12, 1.2]]) voice('sine', t, [[0, 196 * m], [d, 196 * m * 0.998]], [[0.008, a], [0.25, a * 0.55], [d, 0]], vol * 0.5, 0.2); }
function footstep(wood) { if (!sndOK()) return; const t = AC.currentTime + 0.01; if (wood) { voice('sine', t, [[0, rnd(120, 150)], [0.09, 80]], [[0.004, 1], [0.1, 0]], 0.09); burst(t, 0.07, 'bandpass', 500, 300, 1, 0.05); } else burst(t, 0.09, 'lowpass', rnd(700, 1100), 300, 0.5, 0.045); }
const strike = () => { if (sndOK()) burst(AC.currentTime, 0.25, 'highpass', 2500, 6000, 0.7, 0.03); };      // a match struck
function fwSound(rise, late, pan) {
  if (!sndOK()) return; const t0 = AC.currentTime + 0.02, t = t0 + rise + late, big = rnd(0.75, 1.15);
  voice('sine', t0, [[0, rnd(500, 700)], [rise, rnd(1500, 2100)]], [[0.1, 0.5], [rise * 0.8, 1], [rise, 0]], 0.022, pan); burst(t0, rise, 'bandpass', 1800, 4200, 3, 0.012);
  voice('sine', t, [[0, 95], [0.5, 38]], [[0.006, 1], [0.12, 0.6], [0.7, 0]], 0.5 * big, pan);
  burst(t, 0.12, 'lowpass', 2600, 500, 0.5, 0.42 * big); burst(t + 0.02, 2.4, 'lowpass', 700, 55, 0.4, 0.34 * big);
  burst(t + 0.35, 1.6, 'lowpass', 260, 60, 0.3, 0.12 * big);
  const n = 14 + floor(Math.random() * 14); for (let i = 0; i < n; i++) burst(t + 0.3 + Math.random() * Math.random() * 1.9, rnd(0.02, 0.05), 'highpass', rnd(2600, 4200), 6000, 0.7, rnd(0.02, 0.06));
}
// Background music. If a file named loykrathong.mp3 lies beside the page it is played, round and round. Otherwise the tune written out in NOTES
// is played in the manner of a ramwong: a khim carrying the air, ching and thon keeping the dance step.
// NOTES: ด ร ม ฟ ซ ล ท, one sign to a half beat; ' lifts an octave, , drops one; - holds; x rests; | marks the bars for the eye.
const NOTES = `ม, ม ม ม ร ด ร ม | - - - x ซ ม ร ด | ล ด ร - - - - x |
  ม, ม ม ม ร ด ร ม | - - - x ซ ม ร ด | ร ด ล - - - - x |
  ด ร ม ซ ซ ม ซ ล | - - - x ด' ล ซ ม | ซ ม ร - - - - x |
  ด ร ม ซ ซ ม ซ ล | - - - x ด' ล ซ ม | ร ด ร ด - - - x`;
const DRUMS = true, STEP = 0.288, DO = 293.66, HOLD = -200, REST = -100, SEMI = { 'ด': 0, 'ร': 2, 'ม': 4, 'ฟ': 5, 'ซ': 7, 'ล': 9, 'ท': 11 };
const TUNE = NOTES.split(/[\s|]+/).filter(Boolean).map((k) => (k === '-' ? HOLD : !(k[0] in SEMI) ? REST : SEMI[k[0]] + 12 * ((k.match(/['ํ]/g) || []).length - (k.match(/[,ฺ]/g) || []).length)));
let bgm = null, bgmOK = false;
function startMusic() {
  try { bgm = new Audio('loykrathong.mp3'); bgm.loop = true; bgm.volume = 0; bgm.addEventListener('error', () => { bgmOK = false; });
    bgm.addEventListener('canplay', () => { bgm.play().then(() => { bgmOK = true; }).catch(() => { bgmOK = false; }); }, { once: true }); bgm.load(); } catch (_) { /* no file: the page's own tune plays */ }
}
function ramwong(t, i, v) {
  const N = TUNE.length, s = i % N, b = i % 8, n = TUNE[s];
  if (DRUMS) {
    if (b % 4 === 0) voice('sine', t, [[0, 3100], [0.5, 3080]], [[0.003, 1], [0.08, 0.35], [0.5, 0]], 0.02 * v, 0.3);
    else if (b % 4 === 2) voice('sine', t, [[0, 2600], [0.06, 2600]], [[0.003, 1], [0.06, 0]], 0.028 * v, 0.3);
    const D = [1, 0, 2, 1, 0, 1, 2, 0][b];
    if (D === 1) voice('sine', t, [[0, 150], [0.16, 95]], [[0.004, 1], [0.2, 0]], 0.15 * v, -0.2);
    else if (D === 2) { voice('sine', t, [[0, 330], [0.05, 250]], [[0.003, 1], [0.07, 0]], 0.07 * v, -0.2); burst(t, 0.04, 'bandpass', 1800, 1200, 1, 0.028 * v); }
  }
  if (n <= REST) return;
  let len = 1; while (TUNE[(s + len) % N] === HOLD && len < 8) len++;
  const f = DO * Math.pow(2, n / 12), d = STEP * len + 0.25;
  voice('triangle', t, [[0, f], [d, f]], [[0.006, 1], [0.12, 0.45], [d, 0]], 0.055 * v, 0.05); voice('sine', t, [[0, f * 2], [d, f * 2]], [[0.006, 0.45], [0.07, 0.1], [d * 0.6, 0]], 0.055 * v, 0.05);
  if (floor(i / N) % 2) voice('sine', t, [[0, f / 2], [d, f / 2]], [[0.02, 0.5], [d, 0]], 0.05 * v, -0.1);
  if (len >= 3) for (let k = 1; k < len * 3; k++) voice('triangle', t + k * STEP / 3, [[0, f], [0.2, f]], [[0.004, 0.35], [0.06, 0.15], [0.2, 0]], 0.055 * v, 0.05);
}
function updateSound() {
  if (!SND || AC.state !== 'running') { if (AC && AC.state === 'suspended' && started) AC.resume(); return; }
  const t = AC.currentTime, set = (prm, v, tc = 0.3) => prm.setTargetAtTime(v, t, tc);
  const gs = vnoise(time * 0.12, 3.3), river = clamp(1 - (bankZ(P.x) - P.z) / 60, 0.12, 1) * (RIVER ? 1 : 0.6);
  set(SND.wind.g, 0.003 + 0.007 * gs, 0.6); set(SND.wind.f, 200 + 120 * gs, 0.6); set(SND.leaves.g, 0.002 + 0.004 * gs * gs, 0.5);
  set(SND.water.g, 0.05 * river * river * (0.75 + 0.25 * sin(time * 0.6))); set(SND.lap.g, 0.012 * river * river * Math.pow(0.5 + 0.5 * sin(time * 1.7 + sin(time * 0.4) * 2), 3));
  if (t > SND.tCrick) { cricket(t + 0.03, 0.55); SND.tCrick = t + rnd(0.25, 1.2); }
  const vm = (1 - 0.8 * ST.eyes) * (0.6 + 0.4 / (1 + hypot(P.x - 12, P.z + 22) / 18));
  if (bgmOK) bgm.volume = mute ? 0 : clamp(0.5 * vm, 0, 1);
  else { if (SND.tNote < t - 1) SND.tNote = t + 0.1; while (SND.tNote < t + 0.2) { ramwong(SND.tNote, SND.si++, vm); SND.tNote += STEP; } }
}
const setMute = (m) => { mute = m; if (SND) SND.master.gain.setTargetAtTime(mute ? 0 : 0.9, AC.currentTime, 0.05); $('bMute').classList.toggle('off', mute); };

// --------------------------------------------------------------------------------------------------------- the walker
const keys = new Set(), K = (c) => (keys.has(c) ? 1 : 0);
const TCH = { on: false, mx: 0, mz: 0, move: -1, look: -1, ox: 0, oy: 0, lx: 0, ly: 0 };      // touch: which finger walks, which looks
const P = { x: 0, z: -61, yaw: 0, pit: 0.02, y: 1.62, v: 0, bob: 0, dist: 0 };
P.y = surf(P.x, P.z) + 1.62;
// what is in the hands and how far the rite has gone. kind: the krathong carried (-1 none) · lit: its candle and incense alight · rel: 0..1 while
// it is being set on the water · sent: how many have gone · lk: the kind of sky lantern carried (-1 none) · alit: incense lit at the altar for it
// · fill: 0..1 hot air in it · auto: filling, about to go up · lans: how many let go · wish: what was wished · eyes: 0..1 eyes closed
const ST = { sit: null, kind: -1, lit: false, rel: -1, relFrom: null, relTo: null, sent: 0, lk: -1, alit: false, fill: 0, auto: false, lans: 0, wish: null, eyes: 0 };
let started = false, msgT = 0, MODAL = false;
const say = (html, secs = 6) => { const m = $('msg'); m.innerHTML = html; m.classList.add('on'); msgT = time + secs; };
function canStand(x, z) {
  if (z > 41) {
    if ((abs(x) < 2.15 && z <= 57.2) || (abs(x) < 2.95 && z > 56.8 && z < 61.85)) return true;
    if (z > 43.9) return false;
  }
  if (abs(x) > 57 || z < -65.2) return false;
  for (const o of OBST) if ((x - o[0]) * (x - o[0]) + (z - o[1]) * (z - o[1]) < o[2] * o[2]) return false;
  for (const o of RECT) if (x > o[0] && x < o[2] && z > o[1] && z < o[3]) return false;
  return true;
}
function walk(dt) {
  const still = ST.rel >= 0 || ST.auto || MODAL || !!ST.sit;
  let mx = max(K('KeyD'), K('ArrowRight')) - max(K('KeyA'), K('ArrowLeft')) + TCH.mx, mz = max(K('KeyW'), K('ArrowUp')) - max(K('KeyS'), K('ArrowDown')) + TCH.mz;
  const l = hypot(mx, mz); let sp = 0;
  if (l > 0.1 && !still) {
    const v = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4.6 : TCH.move >= 0 ? (l > 0.96 ? 3.4 : 2.3 * l) : 2.3) * (ST.kind >= 0 || ST.lk >= 0 ? 0.85 : 1); mx /= l; mz /= l;
    const fx = sin(P.yaw), fz = cos(P.yaw), dx = (fx * mz - fz * mx) * v * dt, dz = (fz * mz + fx * mx) * v * dt;
    if (canStand(P.x + dx, P.z + dz)) { P.x += dx; P.z += dz; sp = v; } else if (canStand(P.x + dx, P.z)) { P.x += dx; sp = abs(dx) / dt; } else if (canStand(P.x, P.z + dz)) { P.z += dz; sp = abs(dz) / dt; }
  }
  P.v += (sp - P.v) * min(1, dt * 8); P.bob += P.v * dt * 2.7; P.dist += sp * dt;
  if (P.dist > 0.74) { P.dist = 0; footstep(P.z > PIER.z0 && abs(P.x) < 3.2); }
  if (ST.sit) { if (l > 0.5 && !MODAL) standUp(); else { P.y += (ST.sit.y + 0.78 - P.y) * min(1, dt * 6); return; } }
  P.y += (surf(P.x, P.z) + 1.62 - P.y) * min(1, dt * 10);
}
// sitting down: the walker is set on the seat, facing the way it faces (toward the water); standing up puts them back where they were
function sitDown(seat) { ST.sit = seat; ST.sitFrom = [P.x, P.z]; P.x = seat.x; P.z = seat.z; P.yaw = seat.yaw; P.pit = 0.02; P.v = 0; }
function standUp() { const f = ST.sitFrom || [ST.sit.x, ST.sit.z - 1.2]; ST.sit = null; P.x = f[0]; P.z = f[1]; }
// which of the things on a stall's table is being looked at (-1: none)
function aimed(list, eye, f) {
  let best = -1, bc = 0.955;
  for (let i = 0; i < list.length; i++) { const k = list[i], vx = k[0] - eye[0], vy = k[1] - eye[1], vz = k[2] - eye[2], d = hypot(vx, vy, vz), c = (vx * f[0] + vy * f[1] + vz * f[2]) / d; if (d < 3.6 && c > bc) { bc = c; best = i; } }
  return best;
}
// What can be done here and now: [the words shown, what E does]. Worked out every frame from where the walker stands and what is in the hands.
let ACT = { tip: '', e: null };
const nearAltar = () => hypot(P.x - ALTAR[0], P.z - ALTAR[1]) < 3.2;
const onLawn = () => LSPOT.length > 0 && hypot(P.x - LAWN[0], P.z - LAWN[1]) < 13.5;
function whatNow(eye, f) {
  ACT = { tip: '', e: null };
  if (!started || ST.rel >= 0 || ST.auto || MODAL) return;
  if (ST.sit) { ACT.tip = '<kbd>E</kbd> ลุกขึ้น'; ACT.e = standUp; return; }
  if (!ST.lit && !ST.alit) for (const st of SEATS) if (hypot(P.x - st.x, P.z - st.z) < (st.name === 'ศาลา' ? 3.3 : 1.6)) { ACT.tip = `<kbd>E</kbd> นั่งพักที่${st.name}`; ACT.e = () => sitDown(st); return; }
  if (ST.lk >= 0) {      // a sky lantern in the hands: to the altar, incense lit, the wish, and it goes up
    if (!onLawn()) return;
    if (!ST.alit) { ACT.tip = '<kbd>E</kbd> จุดธูปเทียน'; ACT.e = lightAltar; return; }
    ACT.tip = '<kbd>E</kbd> อธิษฐาน'; ACT.e = () => openWish('lantern'); return;
  }
  if (ST.kind >= 0) {    // a krathong: to the water's edge, the candle and incense lit, the wish, and it goes on the water
    if (P.z < EDGE) { if (P.z > PIER.zs - 0.2) ACT.tip = 'เดินไปอีกนิด ให้ถึงริมน้ำ'; return; }
    if (!ST.lit) { ACT.tip = '<kbd>E</kbd> จุดธูปเทียน'; ACT.e = () => { ST.lit = true; strike(); }; return; }
    ACT.tip = '<kbd>E</kbd> อธิษฐาน'; ACT.e = () => openWish('krathong'); return;
  }
  if (HAS_K && hypot(P.x - STALLK[0], P.z - STALLK[1]) < 3.6) {
    const i = aimed(K_DISP, eye, f);
    if (i >= 0) { ACT.tip = `<b>${KNAME[i][0]}</b><small>${KNAME[i][1]}</small><kbd>E</kbd> ซื้อใบนี้`; ACT.e = () => { ST.kind = i; ST.lit = false; say(`ได้${KNAME[i][0]}แล้ว<small>ถือไปที่ท่าน้ำ</small>`, 4); }; }
    else ACT.tip = '<b>ร้านกระทง</b><small>มองที่กระทงบนโต๊ะเพื่อเลือกซื้อ</small>';
    return;
  }
  if (HAS_L && hypot(P.x - STALLL[0], P.z - STALLL[1]) < 3.6) {
    const i = aimed(L_DISP, eye, f);
    if (i >= 0) { ACT.tip = `<b>${LNAME[i][0]}</b><small>${LNAME[i][1]}</small><kbd>E</kbd> ซื้อใบนี้`; ACT.e = () => { ST.lk = i; ST.alit = false; ST.fill = 0; say(`ได้${LNAME[i][0]}แล้ว<small>ถือไปที่ลานโคม</small>`, 4); }; }
    else ACT.tip = '<b>ร้านโคมลอย</b><small>มองที่โคมบนโต๊ะเพื่อเลือกซื้อ</small>';
    return;
  }
}
function shopTip() {      // the other stalls: their name and what they sell, when one comes up to them
  if (ACT.tip || ST.sit) return;
  for (const sh of SHOPS) if (hypot(P.x - sh.x, P.z - sh.z) < 2.6) { ACT.tip = `<b>${sh.name}</b><small>${sh.items}</small>`; return; }
}
function lightAltar() {      // on the lawn: the lantern's wick lit, and incense - set in the altar's pot when one stands by it
  ST.alit = true; strike();
  if (!nearAltar()) return;
  for (let k = 0; k < 3; k++) { const a = Math.random() * TAU, r = Math.random() * 0.07; INC.push([ALT_POT[0] + cos(a) * r, ALT_POT[2] + sin(a) * r, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06]); }
  while (INC.length > 18) INC.shift();
}
function release() {
  ST.rel = 0; ST.relTo = [clamp(P.x + sin(P.yaw) * 0.7, -2.6, 2.6), WL - 0.005, PIER.zp + 0.55];
  if (sndOK()) burst(AC.currentTime + 1.2, 0.5, 'bandpass', 900, 400, 1.2, 0.05);
}

// --------------------------------------------------------------------------------------------------------- the wish
// E at the water's edge (or the altar) opens the box. ตกลง: the wish is sent (Wishes.send) and the krathong is set on the water,
// or the lantern is filled and let go. Left empty, it is a wish made in silence: nothing is sent, and the balloon says so.
const wishBox = $('wish'), wishText = $('wishText'), wishN = $('wishN');
let wishKind = 'krathong';
const lockMouse = () => { if (TCH.on) return; try { const p = GPU.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* dragging still looks round */ } };
function openWish(kind) {
  wishKind = kind; MODAL = true; keys.clear();
  $('wishP').textContent = kind === 'krathong' ? 'คำอธิษฐานจะลอยไปกับกระทง' : 'คำอธิษฐานจะลอยขึ้นฟ้าไปกับโคม';
  wishText.value = ''; wishN.textContent = `0 / ${Wishes.MAX}`;
  if (document.pointerLockElement) document.exitPointerLock();
  wishBox.classList.add('on'); bell(0.5);
  setTimeout(() => wishText.focus(), 60);
}
function closeWish() { MODAL = false; wishBox.classList.remove('on'); wishText.blur(); lockMouse(); }
wishText.addEventListener('input', () => { wishN.textContent = `${wishText.value.length} / ${Wishes.MAX}`; });
wishText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('wishF').requestSubmit(); } else if (e.key === 'Escape') { e.preventDefault(); closeWish(); } });
$('wishIdea').addEventListener('click', () => { wishText.value = Wishes.sample(); wishText.dispatchEvent(new Event('input')); wishText.focus(); });
$('wishNo').addEventListener('click', closeWish);
$('wishF').addEventListener('submit', (e) => {
  e.preventDefault(); if (!MODAL) return;
  const text = Wishes.clean(wishText.value);
  ST.wish = { text, real: true, own: true, silent: !text };
  if (text) Wishes.send({ text, place: PL.id, kind: wishKind });
  closeWish(); bell(0.3);
  if (wishKind === 'krathong') release(); else { ST.auto = true; ST.fill = 0; if (sndOK()) burst(AC.currentTime, 0.4, 'highpass', 1500, 4000, 0.7, 0.04); }
});

// --------------------------------------------------------------------------------------------------------- input
const canvas = GPU.canvas;
addEventListener('keydown', (e) => {
  if (!started || MODAL) return; initSound();
  if (e.code === 'KeyM' && !e.repeat) setMute(!mute);
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return; keys.add(e.code);
  if (e.code === 'KeyE' && ACT.e) ACT.e();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let drag = false;
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('pointerdown', (e) => { if (!started || MODAL || e.pointerType === 'touch') return; initSound(); drag = true; if (!locked()) lockMouse(); });
addEventListener('pointerup', () => { drag = false; });
addEventListener('mousemove', (e) => { if (!started || MODAL || TCH.look >= 0 || TCH.move >= 0 || !(drag || locked())) return; P.yaw -= e.movementX * 0.0026; P.pit = clamp(P.pit - e.movementY * 0.0026, -1.3, 1.3); lookT = time; });
$('go').addEventListener('click', () => { started = true; initSound(); startMusic(); document.body.classList.add('play'); $('intro').classList.add('off'); $('goal').classList.add('on'); $('dot').classList.add('on'); canvas.focus(); lockMouse(); });
$('bMap').addEventListener('click', () => { if (document.pointerLockElement) document.exitPointerLock(); $('ldTitle').textContent = 'แผนที่ประเทศไทย'; $('ldSub').textContent = 'เลือกสถานที่ถัดไป'; LD.root.classList.remove('off'); LD.step('กำลังกลับไปที่แผนที่', 50).then(() => { location.href = 'index.html#' + PL.id; }); });
$('bMute').addEventListener('click', () => { initSound(); setMute(!mute); });
// Touch: a finger put down on the left of the screen is a stick (it appears under the finger; push it to walk, to the rim to hurry), a finger
// on the right looks round. The button does what E does. All of it shows itself on a phone, or the first time the screen is touched.
const pad = $('pad'), knob = pad.firstElementChild, bUse = $('bUse');
const touchUI = () => { if (TCH.on) return; TCH.on = true; document.body.classList.add('touch'); $('hint').textContent = 'ลากฝั่งซ้ายเพื่อเดิน · ลากฝั่งขวาเพื่อมองรอบ · ปุ่ม ใช้ · ถือเครื่องแนวนอนจะเห็นกว้างกว่า'; };
if (MOBILE) touchUI();
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touchUI(); }, true);
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !started || MODAL) return; initSound(); e.preventDefault();
  if (e.clientX < innerWidth * 0.45 && TCH.move < 0) { TCH.move = e.pointerId; TCH.ox = e.clientX; TCH.oy = e.clientY; pad.style.left = e.clientX + 'px'; pad.style.top = e.clientY + 'px'; knob.style.transform = ''; pad.classList.add('on'); }
  else if (TCH.look < 0) { TCH.look = e.pointerId; TCH.lx = e.clientX; TCH.ly = e.clientY; }
  else return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* the finger is followed anyway while it stays on the canvas */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === TCH.move) { let dx = (e.clientX - TCH.ox) / 52, dy = (e.clientY - TCH.oy) / 52; const l = hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } TCH.mx = dx; TCH.mz = -dy; knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`; }
  else if (e.pointerId === TCH.look) { lookT = time; P.yaw -= (e.clientX - TCH.lx) * 0.0048; P.pit = clamp(P.pit - (e.clientY - TCH.ly) * 0.0048, -1.3, 1.3); TCH.lx = e.clientX; TCH.ly = e.clientY; }
});
const touchEnd = (e) => { if (e.pointerId === TCH.move) { TCH.move = -1; TCH.mx = TCH.mz = 0; pad.classList.remove('on'); } else if (e.pointerId === TCH.look) TCH.look = -1; };
canvas.addEventListener('pointerup', touchEnd); canvas.addEventListener('pointercancel', touchEnd);
bUse.addEventListener('pointerdown', (e) => { e.preventDefault(); initSound(); if (started && !MODAL && ACT.e) ACT.e(); });
addEventListener('contextmenu', (e) => { if (TCH.on) e.preventDefault(); });

// --------------------------------------------------------------------------------------------------------- wishes afloat
// A balloon over each of the krathongs and lanterns nearest the eye (BMAX at most, never two over one another), its wish written in it.
// The walker's own stays for as long as it can be seen. Which ones have a balloon is chosen a few times a second; where it is, every frame.
const FOLLOW = { o: null, until: 0 };
let lookT = -9;      // when the walker last looked round by hand
const BUB = $('bubbles'), BMAX = LOW ? 4 : 7, VP = new Float32Array(16), EYE = [0, 0, 0], SPT = [0, 0];
const bubs = [];
let bubT = 0;
const scr = (x, y, z, out) => {
  const dx = x - EYE[0], dy = y - EYE[1], dz = z - EYE[2], w = VP[3] * dx + VP[7] * dy + VP[11] * dz + VP[15]; if (w < 0.3) return false;
  out[0] = ((VP[0] * dx + VP[4] * dy + VP[8] * dz + VP[12]) / w * 0.5 + 0.5) * innerWidth;
  out[1] = (0.5 - (VP[1] * dx + VP[5] * dy + VP[9] * dz + VP[13]) / w * 0.5) * innerHeight; return true;
};
const aloft = (o) => o.y !== undefined;      // a sky lantern (krathongs have no height of their own: they ride on the water)
const anchor = (o) => (aloft(o) ? [o.x, o.y + 1.25 * o.s, o.z] : [o.x, WL + 0.45, o.z]);      // over a lantern's crown; over a krathong
const bubText = (b, o) => {
  const w = o.wish || { text: '' }, key = w.text + '|' + (o.own ? 1 : 0); if (b.key === key) return; b.key = key;
  b.el.className = 'bb' + (o.own ? ' mine' : '') + (b.o ? ' on' : ''); b.el.textContent = '';
  if (o.own) { const s = document.createElement('small'); s.textContent = 'คำอธิษฐานของคุณ'; b.el.appendChild(s); }
  b.el.appendChild(document.createTextNode(w.silent ? 'อธิษฐานในใจ 🙏' : w.text));
  b.w = b.el.offsetWidth; b.h = b.el.offsetHeight;
};
function pickBubbles(ex, ey, ez) {
  const C = [];
  for (const k of RK) { if (!k.lit && !k.own) continue; const d = hypot(k.x - ex, k.z - ez); if (k.own ? d < 220 : d > 2.2 && d < 34) C.push({ o: k, d: k.own ? -1 : d }); }
  for (const l of SL) { const d = hypot(l.x - ex, l.y - ey, l.z - ez); if (l.own ? d < 260 : d > 4 && d < 95) C.push({ o: l, d: l.own ? -1 : d * 0.8 }); }
  C.sort((a, b) => a.d - b.d);
  const pick = [], rects = [];
  for (const c of C) {
    if (pick.length >= BMAX) break;
    const a = anchor(c.o); if (!scr(a[0], a[1], a[2], SPT)) continue;
    const x = SPT[0], y = SPT[1]; if (x < 40 || x > innerWidth - 40 || y < 70 || y > innerHeight - 20) continue;
    // how big its balloon will be (a long wish runs to five or six lines), so that no two balloons are drawn over one another
    const len = c.o.wish ? c.o.wish.text.length : 10, bw = Math.min(TCH.on ? 170 : 230, len * 6.6 + 26), bh = Math.ceil(len * 6.6 / (bw - 24)) * 19.6 + (c.o.own ? 30 : 16);
    let hit = false; for (const r of rects) if (abs(r[0] - x) < (r[2] + bw) / 2 + 8 && abs((r[1] - r[3] / 2) - (y - bh / 2)) < (r[3] + bh) / 2 + 6) { hit = true; break; }
    if (hit && !c.o.own) continue;
    if (!c.o.own && c.o.wish && pick.some((o) => o.wish && o.wish.text === c.o.wish.text)) { c.o.wish = Wishes.pick(); if (pick.some((o) => o.wish && o.wish.text === c.o.wish.text)) continue; }
    pick.push(c.o); rects.push([x, y, bw, bh]);
  }
  for (const b of bubs) if (b.o && !pick.includes(b.o)) { b.o = null; b.el.classList.remove('on'); b.free = time + 0.7; }
  for (const o of pick) {
    if (bubs.some((b) => b.o === o)) continue;
    let b = bubs.find((q) => !q.o && time > q.free);
    if (!b) { if (bubs.length >= BMAX * 2) continue; b = { el: document.createElement('div'), o: null, key: '', w: 0, h: 0, free: 0 }; b.el.className = 'bb'; BUB.appendChild(b.el); bubs.push(b); }
    b.o = o; b.key = ''; bubText(b, o); placeBubble(b); b.el.classList.add('on');
  }
}
function placeBubble(b) {
  const o = b.o, a = anchor(o);
  if (!scr(a[0], a[1], a[2], SPT)) { b.el.style.setProperty('--o', 0); return; }
  const d = hypot(a[0] - EYE[0], a[1] - EYE[1], a[2] - EYE[2]), far = aloft(o) ? 95 : 34;
  b.el.style.setProperty('--o', o.own ? 1 : (1 - sm(far * 0.7, far, d)).toFixed(2));
  b.el.style.transform = `translate(${(SPT[0] - b.w / 2).toFixed(1)}px,${(SPT[1] - b.h - 8).toFixed(1)}px)`;
}
// wishes that arrive while playing go onto a krathong in sight straight away, so that they are seen
Wishes.poll(45000, (added) => {
  for (const w of added) {
    let best = null, bd = 1e9; for (const k of RK) { if (k.own || !k.lit) continue; const d = hypot(k.x - P.x, k.z - P.z); if (d > 8 && d < 30 && d < bd && !bubs.some((b) => b.o === k)) { bd = d; best = k; } }
    if (best) best.wish = { text: w.text, real: true };
  }
});

// --------------------------------------------------------------------------------------------------------- matrices
const mV = new Float32Array(16), mP = new Float32Array(16), mL = new Float32Array(16), mO = new Float32Array(16);

// --------------------------------------------------------------------------------------------------------- frame
const hud = $('hud'), elGoal2 = $('goal2'), elGoalB = $('goalB'), elGoal2T = $('goal2T'), elGoalA = $('goalA'), elGoalT = $('goalT'), elTip = $('tip'), elBar = $('bar'), elBarI = elBar.firstElementChild;
let shN = 0, rPrev = 0, rFlat = 0, rCap = 0, rKeep = 1, last = performance.now(), time = 0, fN = 0, fT = 0, fps = 60, tris = 0, upOK = 0, tipNow = '', goalNow = '', goal2Now = '';
const NEAR = 0.1, FAR = 1200, TANH = Math.tan(62 * PI / 360), SHR = 92, MOON = nrm3([-0.30, 0.44, 0.85]);
const AT = TOON
  ? { sun: [0.24, 0.27, 0.42], amb: [0.05, 0.06, 0.12], zen: [0.012, 0.022, 0.075], hor: PL.far === 'city' ? [0.05, 0.06, 0.125] : [0.045, 0.06, 0.13], ex: 2.1, fog: 0.0045, wind: 0.7 }
  : { sun: [0.17, 0.21, 0.31], amb: [0.026, 0.036, 0.060], zen: [0.004, 0.008, 0.02], hor: PL.far === 'city' ? [0.03, 0.026, 0.04] : [0.014, 0.02, 0.038], ex: 1.9, fog: 0.0036, wind: 0.7 };
const DYN = new Float32Array(9000 * 10), dynB = device.createBuffer({ size: DYN.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const GLW = new Float32Array(400 * 12), glwB = device.createBuffer({ size: GLW.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const dynLamps = [], lampPick = [];
const LAUNCH_GAP = PL.id === 'chiangmai' ? [0.5, 1.6] : [2, 6];
function frame(now) {
  const dtr = now - last; last = now; const dt = min(dtr / 1000, 0.1); time += dt;
  fN++; fT += dtr;
  if (fT > 500) {        // hold 30 fps or better: draw the picture smaller when slow, give the size back when there is room
    fps = fN * 1000 / fT;
    if (rPrev) { if (fps < rPrev * 1.08) { if (++rFlat >= 2) { rCap = fps; scale = rKeep; rFlat = 0; } } else rFlat = 0; rPrev = 0; }
    const minS = LOW ? 0.4 : 0.5, dn = rCap ? min(34, rCap * 0.8) : 34, up = rCap ? min(55, rCap * 0.92) : 55;
    if (fps < dn && scale > minS) { if (!rFlat) rKeep = scale; rPrev = fps; scale = max(minS, scale * (fps < 20 ? 0.75 : 0.9)); upOK = 0; }
    else if (fps > up && scale < 1) { if (++upOK >= 8) { scale = min(1, scale * 1.06); upOK = 0; } } else upOK = 0;
    if (hud.style.display) hud.textContent = `${fps.toFixed(0)} fps · ${W}x${H} · ${(tris / 1e6).toFixed(2)}M${LOW ? ' · low' : ''}`;
    fN = 0; fT = 0;
  }
  resize();
  if (started) walk(dt); else P.yaw = 0.22 * sin(time * 0.12);
  // the lantern filling with hot air once the wish is made, then going up
  if (ST.auto) ST.fill = min(1, ST.fill + dt / 3.2);
  ST.eyes += ((MODAL ? 0.55 : 0) - ST.eyes) * min(1, dt * 3);
  updateSound();
  // after a krathong or a lantern is let go the eye follows it a while (until the walker looks round or walks off)
  if (FOLLOW.o && time < FOLLOW.until && time - lookT > 0.6 && P.v < 0.3) {
    const o = FOLLOW.o, oy = aloft(o) ? o.y + 0.5 : WL, dx = o.x - P.x, dz = o.z - P.z;
    let dy = atan2(dx, dz) - P.yaw; dy -= Math.round(dy / TAU) * TAU; P.yaw += dy * min(1, dt * 1.6);
    P.pit += (clamp(atan2(oy - P.y, hypot(dx, dz)), -0.9, 1.05) - P.pit) * min(1, dt * 1.6);
  }
  // camera
  const pe = ST.eyes, walkBob = sin(P.bob * 2) * 0.028 * min(1, P.v / 2);
  let ex = P.x, ey = P.y + walkBob, ez = P.z; const yaw = P.yaw, pit = P.pit - 0.3 * pe;
  ex = Math.fround(ex); ey = Math.fround(ey); ez = Math.fround(ez);      // the eye exactly as the shaders will have it (they subtract it from every position)
  const cp = cos(pit), f = [sin(yaw) * cp, sin(pit), cos(yaw) * cp], r = nrm3(cross(f, [0, 1, 0])), u = cross(r, f), O3 = [0, 0, 0], eye = [ex, ey, ez];
  view(mV, O3, f, r, u);            // all matrices are for positions relative to the eye
  const asp = W / H; mP.fill(0); mP[0] = 1 / (TANH * asp); mP[5] = 1 / TANH; mP[10] = FAR / (NEAR - FAR); mP[11] = -1; mP[14] = NEAR * FAR / (NEAR - FAR);
  mul(UB, mP, mV); VP.set(UB.subarray(0, 16)); EYE[0] = ex; EYE[1] = ey; EYE[2] = ez;
  whatNow(eye, f); if (started && !MODAL && ST.rel < 0 && !ST.auto) shopTip();
  movePeople(dt, ex, ez);

  // ---- everything that moves: tubes into DYN, patches of light on the water into GLW, lamps into dynLamps
  let nD = 0, nG = 0; dynLamps.length = 0;
  const glow = (x, z, d, dxn, dzn, k) => { if (nG >= 400) return; const len = clamp(d * 0.11, 0.4, 6), wd = 0.14 + d * 0.006; GLW.set([x + dxn * (len * 0.42 + 0.08), WL + 0.012, z + dzn * (len * 0.42 + 0.08), atan2(dxn, dzn), wd, 0.01, len, 0, k, wd, len, 0], nG * 12); nG++; };
  for (const k of RK) {
    if (RIVER) {
      k.x += (k.sp + 0.05 * sin(time * 0.1 + k.ph)) * dt;
      if (k.x > 150) { if (k.mine) continue; k.x = -150; k.z = riverZ(-150, R()); k.kind = floor(R() * 4); k.wish = Wishes.pick(); }
    } else {
      k.x += (k.sp + 0.012 * sin(time * 0.1 + k.ph)) * dt;
      if ((k.x > PONDX && k.sp > 0) || (k.x < -PONDX && k.sp < 0)) k.sp = -k.sp;
      const zl = bankZ(k.x) + 3, zh = farZ(k.x) - 5; if (k.z < zl) k.vz = abs(k.vz) + 0.02; if (k.z > zh) k.vz = -abs(k.vz) - 0.02;
      if (!k.own && Math.random() < dt * 0.006 && hypot(k.x - ex, k.z - ez) > 45) k.wish = Wishes.pick();      // (a pond keeps its krathongs: far off, now and then one carries another wish)
    }
    k.z += (0.03 * sin(time * 0.13 + k.ph * 3) + k.vz) * dt; k.vz *= 1 - min(1, dt * 0.25); k.yaw += k.w * dt;
    if (abs(k.x) < 4.2 && k.z < PIER.zp + 0.45) k.z = PIER.zp + 0.45;                 // the water carries them round the landing
    const dx = ex - k.x, dz = ez - k.z, d = hypot(dx, dz), fl = 0.85 + 0.25 * vnoise(time * 9 + k.ph * 10, k.ph);
    if (nD < 8900) nD = putK(DYN, nD, KT[k.kind], k.x, WL - 0.006 + 0.006 * sin(time * 1.3 + k.ph), k.z, k.yaw, 1, k.lit, max(1, d / 14) * fl, d > (LOW ? 18 : 42));
    if (k.lit) glow(k.x, k.z, d, dx / d, dz / d, (k.mine ? 3.2 : 2.4) * fl);
    if (k.mine && d < 60) dynLamps.push({ x: k.x, y: WL + 0.3, z: k.z, r: 4, c: CANDLE, k: 0.3, i: 0.5 * fl });
  }
  // the people, and the krathongs some of them carry (in the light way of drawing: coarse figures sooner, and none at all far off)
  let nP = 0, nKL = 0;
  for (const q of PPL) {
    const d = hypot(q.x - ex, q.z - ez); if (d > (LOW ? 80 : 160)) continue;
    nP = putPerson(nP, q, d > (LOW ? 20 : 55));
    if (q.lan >= 0 && nD < 8900) {
      const fill = clamp(1 - q.wait / q.lanW, 0, 1), lit = fill > 0.12, ly = q.ky - 0.05 + 0.35 * sm(0.5, 1, fill);
      nD = putLantern(DYN, nD, q.kx, ly, q.kz, 0.9, lit, d > (LOW ? 40 : 90), q.lan);
      if (lit && d < 30 && nKL++ < 4) dynLamps.push({ x: q.kx, y: ly + 0.3, z: q.kz, r: 7, c: LANT, k: 0.15, i: 0.4 + 0.5 * fill });
    }
    if (q.hold >= 0 && nD < 8900) {
      const a = q.rel || 0, fl = 0.85 + 0.25 * vnoise(time * 9 + q.ph * 10, q.ph), kx = q.kx, ky = mix(q.ky, WL - 0.005, a) + sin(PI * a) * 0.06, kz = mix(q.kz, PIER.zp + 0.5, a);
      nD = putK(DYN, nD, KT[q.hold], kx, ky, kz, q.yaw, 1, q.lit, max(1, d / 14) * fl, d > (LOW ? 14 : 30));
      if (q.lit && d < 25 && nKL++ < 3) dynLamps.push({ x: kx, y: ky + 0.3, z: kz, r: 4, c: CANDLE, k: 0.4, i: 0.5 * fl });
    }
  }
  Q.writeBuffer(partB, 0, PART, 0, nP * 12);
  // the krathong in the hands, or on its way down to the water
  const sway = sin(P.bob) * 0.012 * min(1, P.v / 2), hold = (fw, dn, sd) => [ex + f[0] * fw - u[0] * dn + r[0] * (sway + sd), ey + f[1] * fw - u[1] * dn + r[1] * sd, ez + f[2] * fw - u[2] * dn + r[2] * (sway + sd)];
  if (ST.kind >= 0) {
    let hp = hold(mix(0.66, 0.52, pe), mix(0.27, 0.15, pe), mix(0.2, 0, pe));
    if (ST.rel >= 0) {
      if (!ST.relFrom) ST.relFrom = hp; ST.rel += dt / 1.7; const a = sm(0, 1, min(ST.rel, 1));
      hp = [mix(ST.relFrom[0], ST.relTo[0], a), mix(ST.relFrom[1], ST.relTo[1], a) + sin(PI * a) * 0.12, mix(ST.relFrom[2], ST.relTo[2], a)];
      if (ST.rel >= 1) {
        RK.push({ x: hp[0], z: hp[2], yaw: P.yaw, w: 0.12, kind: ST.kind, sp: RIVER ? 0.2 : 0.05, lit: true, vz: 0.55, ph: R() * TAU, mine: true, own: true, wish: ST.wish }); FOLLOW.o = RK[RK.length - 1]; FOLLOW.until = time + 6;
        ST.kind = -1; ST.lit = false; ST.rel = -1; ST.relFrom = null; ST.sent++;
        say(`กระทงของคุณลอยไปกับสายน้ำแล้ว<small>${ST.wish && !ST.wish.silent ? '“' + esc(ST.wish.text) + '”' : 'ขอให้สมดังที่ตั้งใจ'}</small>`, 8);
      }
    }
    if (ST.kind >= 0) {
      const fl = 0.85 + 0.25 * vnoise(time * 9, 2.2);
      nD = putK(DYN, nD, KT[ST.kind], hp[0], hp[1], hp[2], P.yaw + time * 0.05, 1, ST.lit, fl);
      if (ST.lit) dynLamps.push({ x: hp[0], y: hp[1] + 0.3, z: hp[2], r: 5, c: CANDLE, k: 0.5, i: 0.55 * fl });
    }
  }
  // the sky lantern in the hands: paper until the wish is made, then the flame lit at its mouth and the paper filling, rising a little, and away
  if (ST.lk >= 0) {
    const lit = ST.auto || ST.alit, fh = hypot(f[0], f[2]) || 1, lx = ex + f[0] / fh * 1.35 + r[0] * 0.25 * (1 - ST.fill), lz = ez + f[2] / fh * 1.35 + r[2] * 0.25 * (1 - ST.fill), ly = ey - 1.25 + 0.75 * sm(0, 1, ST.fill) + (lit ? 0.02 * sin(time * 2.2) : 0);
    if (ST.fill >= 1) {
      const fh2 = hypot(f[0], f[2]) || 1; FOLLOW.o = launch(lx, ly, lz, true, ST.lk, ST.wish, f[0] / fh2 * 0.9, f[2] / fh2 * 0.9); FOLLOW.until = time + 9;
      ST.lk = -1; ST.fill = 0; ST.auto = false; ST.alit = false; ST.lans++;
      say(`โคมลอยขึ้นฟ้าไปแล้ว<small>${ST.wish && !ST.wish.silent ? '“' + esc(ST.wish.text) + '”' : 'ปล่อยทุกข์โศกไปกับโคม'}</small>`, 8);
    } else { nD = putLantern(DYN, nD, lx, ly, lz, 1, lit, false, ST.lk); if (lit) dynLamps.push({ x: lx, y: ly + 0.3, z: lz, r: 8, c: LANT, k: 0.15, i: 0.5 + 0.5 * ST.fill }); }
  }
  // incense smouldering in the altar's pot
  for (const s of INC) { if (nD > 8980) break; const tx = s[0] + s[2], tz = s[1] + s[3], ty = ALT_POT[1] + 0.33; DYN.set([s[0], ALT_POT[1], s[1], 0.003, tx, ty, tz, 0.0025, -1, 16], nD * 10); nD++; DYN.set([tx, ty, tz, 0.0045, tx, ty + 0.012, tz, 0.001, -1, 9], nD * 10); nD++; }
  // lanterns let go from the lawn and from places round about, now and then (at Yi Peng, all the time)
  if (PL.sky > 0 && (launch.next === undefined || time > launch.next)) {
    launch.next = time + rnd(LAUNCH_GAP[0], LAUNCH_GAP[1]); const s = Math.random();
    if (s < 0.3 && LSPOT.length) { const p = LSPOT[floor(Math.random() * LSPOT.length)]; launch(p[0] + rnd(-1, 1), 0.9, p[1] + rnd(-1, 1)); }
    else {      // a lantern already aloft, somewhere round about - where the eye is not looking (or far off), so that none is seen to appear from nothing
      let x = 0, z = 0, y = 0;
      for (let k = 0; k < 12; k++) { [x, z] = ROUND(); y = rnd(40, 200); const dx = x - ex, dy = y - ey, dz = z - ez, d = hypot(dx, dy, dz); if (d > 260 || (dx * f[0] + dy * f[1] + dz * f[2]) / d < 0.3) break; }
      launch(x, y, z).vy = 1.4;
    }
  }
  for (let i = SL.length - 1; i >= 0; i--) {
    const l = SL[i]; l.age += dt; l.vy = min(l.own ? 1.1 : 1.9, l.vy + dt * (l.own ? 0.12 : 0.25)); l.y += l.vy * dt; l.x += (0.35 + l.y * 0.006 + 0.25 * sin(time * 0.3 + l.ph) + l.vx) * dt; l.z += (0.2 + 0.2 * cos(time * 0.23 + l.ph * 2) + l.vz) * dt; l.vx *= 1 - dt * 0.05; l.vz *= 1 - dt * 0.05;
    if (l.y > 270) { SL.splice(i, 1); continue; }
    const d = hypot(l.x - ex, l.y - ey, l.z - ez);
    if (nD < 8990) nD = putLantern(DYN, nD, l.x, l.y, l.z, l.s, true, d > 110, l.kind);
    if (d < 40 && l.y < 30) dynLamps.push({ x: l.x, y: l.y + 0.3, z: l.z, r: 9, c: LANT, k: 0.12, i: 0.8 });
  }
  Q.writeBuffer(dynB, 0, DYN, 0, nD * 10); Q.writeBuffer(glwB, 0, GLW, 0, nG * 12);
  // fireworks over the far bank
  if (PL.fireworks > 0 && time > fwNext) { const w = FWK[fwI++ & 1]; w.az = PI / 2 + rnd(-0.75, 0.75); w.el = rnd(0.2, 0.42); const rise = rnd(0.8, 1.2); w.t0 = time + rise; w.seed = Math.random(); fwNext = time + rise + (Math.random() < 0.4 ? rnd(0.5, 1.4) : rnd(5, 15) / PL.fireworks); fwSound(rise, rnd(0.35, 0.7), clamp((PI / 2 - w.az) * 1.2, -0.9, 0.9) * (cos(P.yaw) > 0 ? 1 : -1)); }
  let flash = 0; for (let i = 0; i < 2; i++) { const a = time - FWK[i].t0; UB.set([FWK[i].az, FWK[i].el, a > 0 && a < 3.4 ? a : 0, FWK[i].seed], 84 + i * 4); if (a > 0 && a < 1.2) flash += (1 - a / 1.2) * 0.012; }
  // the lamps: the forty that matter most where the eye is
  lampPick.length = 0;
  for (const l of LAMPS) { const d2 = (l.x - ex) * (l.x - ex) + (l.z - ez) * (l.z - ez); l.s = l.r * l.r / (60 + d2); l.i = 1 + (l.fl ? l.fl * (vnoise(time * 6 + l.ph, l.ph) - 0.5) * 2 : 0); lampPick.push(l); }
  for (const l of dynLamps) { l.s = 9; lampPick.push(l); }
  lampPick.sort((a, b) => b.s - a.s);
  const nLamp = min(NL, lampPick.length);
  for (let i = 0; i < nLamp; i++) { const l = lampPick[i]; UB.set([l.x, l.y, l.z, l.r], 92 + i * 4); UB.set([l.c[0] * l.i, l.c[1] * l.i, l.c[2] * l.i, l.k], 92 + NL * 4 + i * 4); }

  // the shadow map: the moon does not move and the fair is small, so one box of light laid over the whole of it serves
  const L = MOON, lf = [-L[0], -L[1], -L[2]], lr = nrm3(cross(lf, [0, 1, 0])), lu = cross(lr, lf), sc = [0, 0, -6];
  view(mL, [sc[0] + L[0] * 300 - ex, sc[1] + L[1] * 300 - ey, sc[2] + L[2] * 300 - ez], lf, lr, lu);
  mO.fill(0); mO[0] = 1 / SHR; mO[5] = 1 / SHR; mO[10] = 1 / (1 - 700); mO[14] = 1 / (1 - 700); mO[15] = 1;
  mul(UBS, mO, mL); UB.set(UBS.subarray(0, 16), 16);
  UB.set([ex, ey, ez, time, L[0], L[1], L[2], 0, AT.sun[0], AT.sun[1], AT.sun[2], 0, f[0], f[1], f[2], 0, r[0], r[1], r[2], TANH * asp, u[0], u[1], u[2], TANH,
    AT.fog, 420, 0.5, 0, W, H, 0, 0, AT.amb[0] + flash, AT.amb[1] + flash, AT.amb[2] + flash, 0, 0, AT.wind * (0.6 + 0.8 * vnoise(time * 0.05, 9.1)), AT.ex, 1,
    AT.zen[0], AT.zen[1], AT.zen[2], 0, AT.hor[0], AT.hor[1], AT.hor[2], 0], 32);
  UB[80] = ((ex % 256) + 256) % 256; UB[81] = ((ez % 256) + 256) % 256; UB[82] = nLamp; UB[83] = 0;
  UBS.set(UB.subarray(16, UBN), 16);
  Q.writeBuffer(ubo, 0, UB); Q.writeBuffer(uboS, 0, UBS);
  Q.writeBuffer(uFinal, 0, new Float32Array([AT.ex * (1 - 0.93 * ST.eyes), 0, time, 0]));

  const enc = device.createCommandEncoder();
  // 1. shadows (in the light way of drawing: only in the first few frames)
  let p;
  if (!LOW || shN++ < 4) {
    p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: vShadowT, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    p.setBindGroup(0, bgShadow);
    for (const c of chunks.values()) {
      if (hypot(c.x - sc[0], c.z - sc[2]) > SHR * 1.5 + CH) continue;
      p.setPipeline(pTerrainS); p.setVertexBuffer(0, c.vb); p.setIndexBuffer(ibGrid, 'uint16'); p.drawIndexed(gridI.length);
      if (c.nSegFar) { p.setPipeline(pBranchS); p.setVertexBuffer(0, vbTube); p.setVertexBuffer(1, c.segB); p.setIndexBuffer(ibTube, 'uint16'); p.drawIndexed(tubeI.length, c.nSegFar); }
      if (c.nBox) { p.setPipeline(pBoxS); p.setVertexBuffer(0, vbCube); p.setVertexBuffer(1, c.boxB); p.setIndexBuffer(ibCube, 'uint16'); p.drawIndexed(36, c.nBox); }
      if (c.nLeaf) { const l = LOW || hypot(c.x - ex, c.z - ez) > 120 ? 2 : 1; p.setPipeline(l === 2 ? pLeafS2 : pLeafS); p.setVertexBuffer(0, c.leafB); p.draw(10, floor(c.nLeaf / LODN[l])); }
    }
    if (nP && !LOW) { p.setPipeline(pPartS); p.setVertexBuffer(0, vbCube); p.setVertexBuffer(1, partB); p.setIndexBuffer(ibCube, 'uint16'); p.drawIndexed(36, nP); }
    p.end();
  }
  // 2. the picture, in HDR
  p = enc.beginRenderPass({ colorAttachments: [AA > 1 ? { view: vMS, resolveTarget: vScene, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'discard' } : { view: vScene, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }],
    depthStencilAttachment: { view: vDepth, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
  p.setBindGroup(0, bgScene); tris = 0;
  for (const c of chunks.values()) {
    const dx = c.x - ex, dz = c.z - ez, d = hypot(dx, dz);
    if (d > CH) {                          // behind the camera or off to the side of what the screen shows
      const fh = hypot(f[0], f[2]) || 1, fw = (dx * f[0] + dz * f[2]) / fh, k = TANH * (W / H) / max(cp - TANH * abs(f[1]), 0.05), Rc = 80;
      if (abs(f[1]) < 0.3 ? (fw < -Rc || Math.sqrt(max(d * d - fw * fw, 0)) > k * max(fw, 0) + Rc * hypot(1, k)) : (dx * f[0] + dz * f[2]) / d < -0.35) continue;
    }
    p.setPipeline(pTerrain); p.setVertexBuffer(0, c.vb); p.setIndexBuffer(ibGrid, 'uint16'); p.drawIndexed(gridI.length); tris += GN * GN * 2;
    if (c.nSeg) { const n = d < 110 ? c.nSeg : c.nSegFar; if (n) { p.setPipeline(pBranch); p.setVertexBuffer(0, vbTube); p.setVertexBuffer(1, c.segB); p.setIndexBuffer(ibTube, 'uint16'); p.drawIndexed(tubeI.length, n); tris += n * SIDES * 2; } }
    if (c.nBox) { p.setPipeline(pBox); p.setVertexBuffer(0, vbCube); p.setVertexBuffer(1, c.boxB); p.setIndexBuffer(ibCube, 'uint16'); p.drawIndexed(36, c.nBox); tris += c.nBox * 12; }
    if (c.nLeaf) { const l = LOW ? (d < 40 ? 1 : 2) : d < 75 ? 0 : d < 180 ? 1 : 2, n = floor(c.nLeaf / LODN[l]); p.setPipeline(pLeaf[l]); p.setVertexBuffer(0, c.leafB); p.draw(10, n); tris += n * 8; }
  }
  if (nP) { p.setPipeline(pPart); p.setVertexBuffer(0, vbCube); p.setVertexBuffer(1, partB); p.setIndexBuffer(ibCube, 'uint16'); p.drawIndexed(36, nP); tris += nP * 12; }
  if (nD) { p.setPipeline(pBranch); p.setVertexBuffer(0, vbTube); p.setVertexBuffer(1, dynB); p.setIndexBuffer(ibTube, 'uint16'); p.drawIndexed(tubeI.length, nD); tris += nD * SIDES * 2; }
  p.setPipeline(pSky); p.draw(3);
  if (nG) { p.setPipeline(pGlow); p.setVertexBuffer(0, vbCube); p.setVertexBuffer(1, glwB); p.setIndexBuffer(ibCube, 'uint16'); p.drawIndexed(36, nG); }
  p.end();
  // 3. bloom, then 4. to the screen (exposure, filmic curve, vignette): the engine does both
  post(enc);
  Q.submit([enc.finish()]);

  // ---- wishes afloat
  if (time > bubT) { bubT = time + 0.3; pickBubbles(ex, ey, ez); }
  for (const b of bubs) if (b.o) placeBubble(b);

  // ---- the words on the screen: what to do next and which way, what can be done here
  if (started) {
    let goal = '', tgt = null, two = null;
    const kDone = ST.sent > 0, lDone = ST.lans > 0;
    if (ST.lk >= 0) {
      if (ST.auto) goal = '<b>ปล่อยโคมลอย</b>';
      else if (!onLawn()) { goal = 'ถือโคมไปที่ <b>ลานโคม</b>'; tgt = LAWN; }
      else goal = !ST.alit ? '<b>จุดธูปเทียน</b>' : '<b>อธิษฐาน</b> แล้วปล่อยโคม';
    } else if (ST.kind >= 0) {
      if (ST.rel >= 0) goal = '<b>ลอยกระทง</b>';
      else if (P.z < EDGE) { goal = 'ถือกระทงไปที่ <b>ท่าน้ำ</b>'; tgt = [0, 60.4]; }
      else goal = !ST.lit ? '<b>จุดธูปเทียน</b>' : '<b>อธิษฐาน</b> แล้วลอยกระทง';
    } else {
      const want = PL.modes.filter((m) => (m === 'krathong' ? !kDone : !lDone));
      const where = (m) => (m === 'krathong' ? ['เลือกกระทงที่ <b>ร้านกระทง</b>', STALLK, 'ร้านกระทง'] : ['ซื้อโคมที่ <b>ร้านโคม</b>', STALLL, 'ร้านโคม']);
      if (want.length) { const w = where(want[0]); goal = w[0]; tgt = w[1]; if (want[1]) two = where(want[1]); }
      else goal = 'เดินเที่ยวงานได้ตามใจ';
    }
    const point = (el, t) => { const dx = t[0] - P.x, dz = t[1] - P.z; let rel = atan2(dx, dz) - P.yaw; rel -= Math.round(rel / TAU) * TAU; el.style.transform = `rotate(${(-rel * 180 / PI - 90).toFixed(0)}deg)`; return hypot(dx, dz); };
    if (tgt) { const d = point(elGoalA, tgt); elGoalA.style.opacity = d > 3 ? 1 : 0.25; if (d > 3) goal += ` <span>· ${d.toFixed(0)} ม.</span>`; } else elGoalA.style.opacity = 0.25;
    elGoal2.classList.toggle('on', !!two);
    if (two) { const d = point(elGoalB, two[1]), t2 = `${two[2]} <span>· ${d.toFixed(0)} ม.</span>`; if (t2 !== goal2Now) { goal2Now = t2; elGoal2T.innerHTML = t2; } }
    if (goal !== goalNow) { goalNow = goal; elGoalT.innerHTML = goal; }
    let tip = ACT.tip || (!locked() && !drag && !MODAL && !TCH.on && time > 4 && P.v < 0.1 && !ST.sent && !ST.lans && ST.kind < 0 && ST.lk < 0 ? 'คลิกที่ภาพเพื่อมองรอบ' : '');
    if (TCH.on) { tip = tip.replace('<kbd>E</kbd>', '<kbd>ใช้</kbd>'); bUse.classList.toggle('on', !!ACT.e); }
    if (tip !== tipNow) { tipNow = tip; if (tip) elTip.innerHTML = tip; elTip.classList.toggle('on', !!tip); }
    const prog = ST.auto ? ST.fill : ST.rel >= 0 ? min(1, ST.rel) : 0; elBar.classList.toggle('on', prog > 0); elBarI.style.width = (prog * 100).toFixed(1) + '%';
    if (msgT && time > msgT) { $('msg').classList.remove('on'); msgT = 0; }
  }
}
// a failed frame says so on the page (in #err) instead of stopping the loop silently
function tick(now) { requestAnimationFrame(tick); try { frame(now); } catch (e) { if (!tick.failed) { tick.failed = true; Engine.fail('JS: ' + (e.stack || e)); } } }

// --------------------------------------------------------------------------------------------------------- ready
$('inVenue').textContent = PL.venue; $('inName').textContent = PL.name; $('inBlurb').textContent = PL.blurb;
await LD.step('จุดเทียนรอบงาน', 96);
resize();
last = performance.now(); frame(last);              // one frame drawn behind the loading screen, so that the first thing seen is the fair
await device.queue.onSubmittedWorkDone();
await LD.step('พร้อมแล้ว', 100);
LD.done(); $('intro').classList.remove('off');
requestAnimationFrame(tick);
// hot reload (bun run dev): before the page loads itself again it puts aside where the walker stands, and takes it up again here
window.liveKeep = () => { try { sessionStorage.setItem('lk.live', JSON.stringify({ loc: PL.id, x: P.x, z: P.z, yaw: P.yaw, pit: P.pit, started, mute })); } catch (_) { /* not kept */ } };
try {
  const k = JSON.parse(sessionStorage.getItem('lk.live') || 'null'); sessionStorage.removeItem('lk.live');
  if (k && k.loc === PL.id) { if (canStand(k.x, k.z)) { P.x = k.x; P.z = k.z; P.y = surf(P.x, P.z) + 1.62; } P.yaw = k.yaw; P.pit = k.pit; if (k.mute) setMute(true); if (k.started) $('go').click(); }
} catch (_) { /* start as usual */ }
window.__dbg = { PL, P, ST, K_DISP, L_DISP, ALTAR, get STALLK() { return STALLK; }, get STALLL() { return STALLL; }, PPL, TCH, MOBILE, LOW, NL, RK, SL, LAMPS, chunks, AT, bubs, INC, start: () => $('go').click(), key: (c, on) => { if (on) keys.add(c); else keys.delete(c); },
  act: () => ACT, press: () => ACT.e && ACT.e(), wish: (t) => { wishText.value = t; $('wishF').requestSubmit(); }, get modal() { return MODAL; }, get fps() { return fps; }, get tris() { return tris; }, get time() { return time; } };
})();
