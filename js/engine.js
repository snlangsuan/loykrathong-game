// =====================================================================================================================
// The Endless engine: what the pages in this folder share (endless.html, loykrathong.html). WebGPU, no build step, no dependencies.
// A page loads this file with <script src="engine.js"></script> before its own script, and then:
//
//   const { clamp, mix, sm, fbm, rng, makeTree, ... } = Engine;       numbers, matrices and the plant makers: plain functions
//   const GPU = await Engine.boot({ shadow, aa });                    the device and the canvas
//   const R = await Engine.renderer(GPU, { wgsl: WGSL, floats, ... });   shaders, pipelines, the shared meshes, the render targets
//   each frame: R.resize(scale), write the uniforms, draw the picture with R's pipelines, then R.post(enc)
//
// What is drawn, and how: every leaf and grass blade is real geometry (instanced, shaped in the vertex shader), light passes through
// leaves, trunks are tubes and buildings are boxes whose surfaces are painted by the fragment shader, a shadow map, distance fading
// into the colour of the horizon, the picture rendered in HDR then bloomed and tone mapped.
//
// The shaders are written here once, with places left open for what a page has of its own. A page fills them through WGSL
// (strings of WGSL; all but the four marked * may be left out):
//   uniforms      more members for the uniform block G, after camM (begin with a comma)
//   common        functions and constants for every stage, the shadow pass included: the page's land, vertex stages of its own
//   leafTint      statements in the leaf vertex stage once a leaf has its colour (col)
//   barkV         the v coordinate of a tube's skin (an expression; height above the ground if left out)
//   ground *      fsTerrain, once turf and bare earth are laid: paint the page's ground (alb, bump, gloss, wet, n)
//   groundLight * fsTerrain, once sun and shadow are known (L, V, ndl, sh, E): light the ground and return the pixel
//   branchLight * fsBranch: light a trunk or pole into `c` (declare E and c)
//   boxMats       fsBox: further arms of the chain of box materials (else if (mat == ...) { ... })
//   grade         the last pass, after the filmic curve: statements that grade the colour c (0..1) before it goes to the screen
//   bloom         how much of the bloom is added back (a number; .22 if left out)
//   scene *       functions for the fragment stages: it must hold head(wp, n) (light other than the sun's falling on a point)
//                 and the entry point fsSky; whatever else the page draws with goes here too
// =====================================================================================================================
const Engine = (() => {
const { sin, cos, abs, min, max, floor, sqrt, hypot, atan2, PI, exp } = Math, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), mix = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (v) => v - floor(v);
// what went wrong is written on the page, in the element with id="err"
const $ = (id) => document.getElementById(id);
const fail = (m) => { const e = $('err'); e.style.display = 'block'; e.textContent += m + '\n\n'; };
addEventListener('error', (e) => fail('JS: ' + e.message + ' @' + e.lineno));
addEventListener('unhandledrejection', (e) => fail('JS: ' + (e.reason && (e.reason.stack || e.reason))));

// --------------------------------------------------------------------------------------------------------- numbers
// hash, vnoise, fbm: the noise the land is shaped with. ph, pn, turfAt: the hash on whole numbers that the shaders have too (ph, pn and turf there),
// so that script and shader agree where the ground is turf and where bare earth. rng: a seeded run of random numbers.
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, y) => { const ix = floor(x), iy = floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); return mix(mix(hash(ix, iy), hash(ix + 1, iy), ux), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux), uy); };
const fbm = (x, y, o = 4) => { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; a *= 0.5; } return s / (1 - a * 2 + 1e-9) * (1 - 0) ; };
const ph = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const pn = (x, y) => { const ix = floor(x), iy = floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); return mix(mix(ph(ix, iy), ph(ix + 1, iy), ux), mix(ph(ix, iy + 1), ph(ix + 1, iy + 1), ux), uy); };
const turfAt = (x, z) => pn(x * 0.09, z * 0.09) * 0.5 + pn(x * 0.37, z * 0.37) * 0.32 + pn(x * 1.3, z * 1.3) * 0.18;
const rng = (seed) => { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

// --------------------------------------------------------------------------------------------------------- matrices
const mul = (o, a, b) => { for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
const view = (m, e, f, r, u) => { m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = -(r[0] * e[0] + r[1] * e[1] + r[2] * e[2]); m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = f[0] * e[0] + f[1] * e[1] + f[2] * e[2]; m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// --------------------------------------------------------------------------------------------------------- plants
// A plant is designed once as a template (branch pieces + leaves around the origin) and then stamped into the world
// turned and scaled. Leaf: x y z len | yaw el halfWidth droop | kind seed shade height. Piece: x0 y0 z0 r0 | x1 y1 z1 r1 | h0 h1
const nrm3 = (v) => { const l = hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
function shuffleLeaves(L, R) { const n = L.length / 12, t = new Array(12); for (let i = n - 1; i > 0; i--) { const j = floor(R() * (i + 1)); for (let k = 0; k < 12; k++) { t[k] = L[i * 12 + k]; L[i * 12 + k] = L[j * 12 + k]; L[j * 12 + k] = t[k]; } } }
// broadleaf tree: each limb carries its children spaced along it, spiralling round at the golden angle
function makeTree(seed, o) {
  const R = rng(seed), segs = [[], [], [], []], twigs = [];
  const branch = (p0, d0, len, rad, lvl) => {
    const n = lvl === 0 ? 7 : lvl === 1 ? 5 : 3, pts = [p0.slice()], dirs = [], d = d0.slice(), p = p0.slice(), wob = o.wob * (lvl ? 1 : 0.35), tip = lvl === 0 ? 0.16 : 0.4;
    for (let i = 0; i < n; i++) {
      d[0] += (R() - 0.5) * wob; d[2] += (R() - 0.5) * wob; d[1] += lvl ? o.trop * 0.35 : 0.06; nrm3(d);
      const r0 = rad * (1 - (1 - tip) * i / n) * (lvl === 0 && i === 0 ? 1.6 : 1), r1 = rad * (1 - (1 - tip) * (i + 1) / n);
      const q = [p[0] + d[0] * len / n, p[1] + d[1] * len / n, p[2] + d[2] * len / n];
      segs[lvl].push(p[0], p[1], p[2], r0, q[0], q[1], q[2], r1, max(p[1], 0), max(q[1], 0));
      p[0] = q[0]; p[1] = q[1]; p[2] = q[2]; pts.push(q); dirs.push(d.slice());
    }
    if (lvl >= o.n.length - 1) twigs.push(pts);
    if (lvl >= o.n.length) return;
    const cnt = o.n[lvl], f0 = lvl === 0 ? o.crown : 0.2;
    for (let k = 0; k < cnt; k++) {
      const t = (k + R() * 0.7) / cnt, f = min(0.999, f0 + (1 - f0) * t), fi = f * n, i0 = floor(fi), tg = dirs[i0];
      const pos = [mix(pts[i0][0], pts[i0 + 1][0], fi - i0), mix(pts[i0][1], pts[i0 + 1][1], fi - i0), mix(pts[i0][2], pts[i0 + 1][2], fi - i0)];
      const ax = abs(tg[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
      const p1 = nrm3([ax[1] * tg[2] - ax[2] * tg[1], ax[2] * tg[0] - ax[0] * tg[2], ax[0] * tg[1] - ax[1] * tg[0]]);
      const p2 = [tg[1] * p1[2] - tg[2] * p1[1], tg[2] * p1[0] - tg[0] * p1[2], tg[0] * p1[1] - tg[1] * p1[0]];
      const az = k * 2.39996 + R() * 0.6, a = o.ang[lvl] * (0.82 + R() * 0.36) * (lvl === 0 ? 1.2 - 0.5 * t : 1), ca = cos(a), sa = sin(a);
      const nd = nrm3([tg[0] * ca + (p1[0] * cos(az) + p2[0] * sin(az)) * sa, tg[1] * ca + (p1[1] * cos(az) + p2[1] * sin(az)) * sa + o.trop, tg[2] * ca + (p1[2] * cos(az) + p2[2] * sin(az)) * sa]);
      const cl = (lvl === 0 ? o.H * o.len0 * (0.62 + 0.42 * sin(PI * (0.12 + 0.8 * t))) : len * o.lenR * (1 - 0.45 * t)) * (0.8 + R() * 0.4);
      branch(pos, nd, cl, max(0.012, rad * (1 - (1 - tip) * f) * (lvl === 0 ? 0.5 : 0.6)), lvl + 1);
    }
  };
  branch([0, -0.3, 0], nrm3([(R() - 0.5) * 0.12, 1, (R() - 0.5) * 0.12]), o.H, o.r, 0);
  // the crown's middle and reach, for shading leaves deep inside it darker
  let cx = 0, cy = 0, cz = 0, cn = 0, rad = 0;
  for (const t of twigs) for (const p of t) { cx += p[0]; cy += p[1]; cz += p[2]; cn++; }
  cx /= cn; cy /= cn; cz /= cn;
  for (const t of twigs) for (const p of t) rad = max(rad, hypot(p[0] - cx, p[1] - cy, p[2] - cz));
  const leaves = [];
  for (const t of twigs) for (let i = 1; i < t.length; i++) for (let j = 0; j < o.per; j++) {
    const f = R(), a = i < t.length - 1 ? t[i] : t[i - 1], b = i < t.length - 1 ? t[i + 1] : t[i];
    const x = mix(a[0], b[0], f), y = mix(a[1], b[1], f), z = mix(a[2], b[2], f);
    const dist = hypot(x - cx, y - cy, z - cz) / rad, shade = 0.42 + 0.58 * clamp((dist - 0.25) / 0.6, 0, 1), L = o.leaf * (0.7 + R() * 0.6);
    leaves.push(x, y, z, L, R() * TAU, -0.35 + R() * 1.1, L * o.wide, 0.5 + R() * 1.0, 0, R(), shade, y);
  }
  shuffleLeaves(leaves, R);
  const all = [].concat(segs[0], segs[1], segs[2], segs[3]);
  return { segs: new Float32Array(all), nSeg: all.length / 10, nSegFar: (segs[0].length + segs[1].length) / 10, nSegMid: (segs[0].length + segs[1].length + segs[2].length) / 10, leaves: new Float32Array(leaves), nLeaf: leaves.length / 12 };
}
// coconut palm: a leaning ringed trunk, arching fronds, each a rib carrying two rows of hanging leaflets
function makePalm(seed) {
  const R = rng(seed), segs = [], leaves = [], Hh = 9 + R() * 3, bend = 0.12 + R() * 0.12, ba = R() * TAU;
  const tp = (t) => [cos(ba) * sin(t * 1.4) * Hh * bend, t * Hh - 0.3, sin(ba) * sin(t * 1.4) * Hh * bend];
  for (let i = 0; i < 10; i++) { const a = tp(i / 10), b = tp((i + 1) / 10); segs.push(a[0], a[1], a[2], 0.26 - 0.09 * i / 10 + (i === 0 ? 0.1 : 0), b[0], b[1], b[2], 0.26 - 0.09 * (i + 1) / 10, max(a[1], 0), b[1]); }
  const top = tp(1);
  for (let k = 0; k < 7; k++) { const a = k * 0.9 + R(), r = 0.2 + R() * 0.12, y = top[1] - 0.35 - R() * 0.3; segs.push(top[0] + cos(a) * r, y, top[2] + sin(a) * r, 0.13, top[0] + cos(a) * r, y - 0.24, top[2] + sin(a) * r, 0.11, y, y); }
  const nTrunk = segs.length / 10;
  for (let k = 0; k < 19; k++) {
    const dead = k >= 16, a = k * 2.39996 + R() * 0.4, el = dead ? -0.9 - R() * 0.3 : -0.15 + R() * 1.0, L = 3.4 + R() * 1.3, dx = cos(a) * cos(el), dy = sin(el), dz = cos(el) * sin(a), sag = 0.4 + R() * 0.25;
    const rib = (t) => [top[0] + dx * L * t, top[1] + dy * L * t - t * t * L * sag, top[2] + dz * L * t];
    for (let i = 0; i < 6; i++) { const p = rib(i / 6), q = rib((i + 1) / 6); segs.push(p[0], p[1], p[2], 0.045 - 0.006 * i, q[0], q[1], q[2], 0.039 - 0.006 * i, p[1], q[1]); }
    for (let j = 0; j < 24; j++) for (const s of [1, -1]) {
      const t = 0.1 + 0.9 * (j + 0.5) / 24, p = rib(t), ll = L * (0.1 + 0.26 * sin(PI * Math.pow(t, 0.7)));
      leaves.push(p[0], p[1], p[2], ll, a + s * (1.25 - t * 0.35), -0.25 - R() * 0.3, 0.055, 1.1 + R() * 0.7, dead ? 7 : 1, R(), 0.6 + 0.4 * t, p[1]);
    }
  }
  shuffleLeaves(leaves, R);
  return { segs: new Float32Array(segs), nSeg: segs.length / 10, nSegFar: nTrunk + 114, leaves: new Float32Array(leaves), nLeaf: leaves.length / 12 };
}
// sugar palm (ต้นตาล): a tall straight trunk and a round head of stiff fans
function makeSugarPalm(seed) {
  const R = rng(seed), segs = [], leaves = [], Hh = 11 + R() * 4;
  for (let i = 0; i < 6; i++) segs.push((R() - 0.5) * 0.08, i / 6 * Hh - 0.3, 0, 0.27 - 0.02 * i + (i === 0 ? 0.12 : 0), (R() - 0.5) * 0.08, (i + 1) / 6 * Hh - 0.3, 0, 0.25 - 0.02 * i, i / 6 * Hh, (i + 1) / 6 * Hh);
  const nTrunk = 6, top = [0, Hh - 0.3, 0];
  for (let k = 0; k < 26; k++) {
    const az = k * 2.39996, el = -0.7 + R() * 1.9, st = 0.8 + R() * 0.5, dx = cos(az) * cos(el), dy = sin(el), dz = sin(az) * cos(el), sx = -sin(az), sz = cos(az);
    const hub = [top[0] + dx * st, top[1] + dy * st, top[2] + dz * st];
    segs.push(top[0], top[1], top[2], 0.035, hub[0], hub[1], hub[2], 0.025, top[1], hub[1]);
    for (let j = 0; j < 14; j++) {
      const fa = (j / 13 - 0.5) * 3.3, bx = dx * cos(fa) + sx * sin(fa), by = dy * cos(fa), bz = dz * cos(fa) + sz * sin(fa);
      leaves.push(hub[0], hub[1], hub[2], 1.05 + R() * 0.3, atan2(bz, bx), Math.asin(clamp(by, -1, 1)), 0.075, 0.2 + R() * 0.3, 1, R(), 0.5 + 0.5 * clamp((el + 0.7) / 1.9, 0, 1), hub[1]);
    }
  }
  shuffleLeaves(leaves, R);
  return { segs: new Float32Array(segs), nSeg: segs.length / 10, nSegFar: nTrunk + 26, leaves: new Float32Array(leaves), nLeaf: leaves.length / 12 };
}
// banana clump (กอกล้วย), as Endless's src/plants.js has it (tube materials here: 2 stalk, 5 bud, 33 fruit, 34 the stem's brown foot, 35 its green top): four or five thick stems of different heights leaning apart, brown and stringy at the foot and green above.
// Each stem carries a head of big paddle leaves on long stalks - the young ones standing up in the middle, the old ones arching over
// and hanging, torn along the veins. The tallest stem carries the bunch (เครือ): a thick stalk bends over out of the crown and hangs
// straight down, with hands of fruit in tiers round it, a bare length below them, and the purple bud (ปลี) at the end.
function makeBanana(seed) {
  const R = rng(seed), segs = [], fine = [], leaves = [], tube = (a, ra, b, rb, mat, o = segs) => o.push(a[0], a[1], a[2], ra, b[0], b[1], b[2], rb, -2 - max(0, (a[1] + b[1]) / 2), mat);      // (-2 - height: a made piece that goes with the plant's sway, as its leaves do - stems, bunch and bud; at -1 they stood still while the leaves moved)
  const HS = [3.4, 2.7, 3.0, 2.1, 1.0];
  for (let s = 0; s < 5; s++) {
    const a0 = s * 2.4 + R() * 0.7, rr = s ? 0.42 + R() * 0.25 : 0.08, bx = cos(a0) * rr, bz = sin(a0) * rr, Hs = HS[s] * (0.92 + R() * 0.16), k = Hs / 3.4, lean = s ? 0.3 + R() * 0.35 : 0.12;
    const sp = (t) => [bx + cos(a0) * lean * k * t * t, -0.2 + (Hs + 0.2) * t, bz + sin(a0) * lean * k * t * t];
    const rad = (t) => (0.095 + 0.115 * Math.pow(1 - t, 1.4)) * (0.5 + 0.5 * k) + (t === 0 ? 0.05 : 0);
    for (let i = 0; i < 6; i++) tube(sp(i / 6), rad(i / 6), sp((i + 1) / 6), rad((i + 1) / 6), i < 3 ? 34 : 35);
    const top = sp(1), nl = s === 4 ? 5 : 9 + floor(R() * 3);
    for (let j = 0; j < nl; j++) {
      const az = j * 2.39996 + R() * 0.5 + s, age = j / (nl - 1), el = 1.32 - age * 1.3 + (R() - 0.5) * 0.2, L = (1.9 + R() * 0.6) * (0.45 + 0.55 * k) * (0.8 + 0.2 * sin(PI * age) + 0.1), droop = 0.45 + age * 0.95 + R() * 0.2;
      const pel = el * 0.55 + 0.7, pl = (0.4 + R() * 0.3) * (0.5 + 0.5 * k);                                  // the leaf stalk leaves the stem more steeply than the blade it carries
      const pe = [top[0] + cos(az) * cos(pel) * pl, top[1] + sin(pel) * pl, top[2] + sin(az) * cos(pel) * pl];
      tube([top[0], top[1] - 0.35 * k, top[2]], 0.06 * (0.5 + 0.5 * k), pe, 0.028, 10);
      leaves.push(pe[0], pe[1], pe[2], L, az, el, L * 0.175, droop, 5, clamp(age * 0.9 + (R() - 0.5) * 0.15, 0, 0.99), 0.85 + R() * 0.15, pe[1]);
    }
    if (s < 4) for (let j = 0; j < 3; j++) { const az = R() * TAU, p = sp(0.86 + R() * 0.1); leaves.push(p[0] + cos(az) * 0.1, p[1], p[2] + sin(az) * 0.1, (1.0 + R() * 0.5) * k, az, -1.25, 0.15, 0.3, 7, R(), 0.6, p[1]); }    // dead leaves hang down against the stem
    if (s === 0) {
      const az = a0 + 1.2 + R() * 3.9, cx = cos(az), cz = sin(az);
      const q = (t) => { const u = min(t / 0.25, 1), out = 0.45 * sin(u * PI / 2); return [top[0] + cx * out, top[1] - 0.1 + 0.5 * u * (1 - u) - 0.12 * u - max(t - 0.25, 0) * 1.95, top[2] + cz * out]; };
      for (let i = 0; i < 14; i++) tube(q(i / 14 * 0.88), 0.042 - 0.001 * i, q((i + 1) / 14 * 0.88), 0.041 - 0.001 * i, 2);
      const e = q(0.88), dn = (d) => [e[0], e[1] - d, e[2]];                                                 // the bud: a fat purple teardrop
      tube(e, 0.03, dn(0.07), 0.078, 5); tube(dn(0.07), 0.078, dn(0.17), 0.07, 5); tube(dn(0.17), 0.07, dn(0.34), 0.008, 5);
      for (let hd = 0; hd < 8; hd++) {                                                                       // the hands: each a ring of fingers that leave the stalk and curve upward, smaller toward the bud
        const b = q(0.33 + hd * 0.05), sz = 1 - hd * 0.055, nf = 13 - floor(hd / 2);
        for (let f = 0; f < nf; f++) {
          const fa = f / nf * TAU + hd * 0.9, inr = f & 1, fx = cos(fa), fz = sin(fa), l = (0.17 + R() * 0.04) * sz, r0 = 0.035 + inr * 0.03;
          const a = [b[0] + fx * 0.03, b[1] + inr * 0.03, b[2] + fz * 0.03], m = [b[0] + fx * (r0 + l * 0.6), b[1] + l * 0.12 + inr * 0.03, b[2] + fz * (r0 + l * 0.6)], e2 = [b[0] + fx * (r0 + l * 0.85), b[1] + l * 0.85 + inr * 0.03, b[2] + fz * (r0 + l * 0.85)];
          tube(a, 0.02 * sz, m, 0.034 * sz, 33, fine); tube(m, 0.034 * sz, e2, 0.014 * sz, 33, fine);
        }
      }
      tube(top, 0.05, [top[0] + (R() - 0.5) * 0.15, top[1] + 1.0, top[2] + (R() - 0.5) * 0.15], 0.03, 2); tube([top[0], top[1] + 1.0, top[2]], 0.03, [top[0], top[1] + 1.6, top[2]], 0.008, 2);      // the new leaf, still rolled, stands straight up out of the middle
    }
  }
  shuffleLeaves(leaves, R);
  const all = segs.concat(fine);
  return { segs: new Float32Array(all), nSeg: all.length / 10, nSegFar: segs.length / 10, leaves: new Float32Array(leaves), nLeaf: leaves.length / 12 };
}
// Houses are assembled from boxes and gable prisms: [x y z, sx sy sz, tilt, material, shape (1 = gable)].
// materials: 0 upright boards, 1 corrugated sheet, 2 concrete, 3 dark opening, 4 dark timber, 9 roof tiles, 16 weatherboard, 17 glass, 18 painted render, 19 white trim
const mkB = () => { const B = []; B.box = (x, y, z, sx, sy, sz, mat, tilt = 0, shape = 0) => { B.push([x, y, z, sx, sy, sz, tilt, mat, shape]); return B; }; return B; };
// a gable roof over a W x D plan whose walls end at height top: gable ends, two overhanging slopes, ridge cap, fascia boards
function addGableRoof(B, W, D, top, rise, over, wallMat, roofMat) {
  const pit = Math.atan2(rise, D / 2), half = D / 2 + over, run = half / cos(pit);
  B.box(0, top + rise / 2, 0, W, rise, D, wallMat, 0, 1);
  const cy = top + rise - Math.tan(pit) * half / 2 + 0.07;
  B.box(0, cy, -half / 2, W + over * 2, 0.06, run, roofMat, -pit); B.box(0, cy, half / 2, W + over * 2, 0.06, run, roofMat, pit);
  B.box(0, top + rise + 0.1, 0, W + over * 2, 0.07, 0.3, roofMat);
  for (const s2 of [-1, 1]) B.box(0, top - Math.tan(pit) * over + 0.02, s2 * (half - 0.02), W + over * 2, 0.16, 0.035, 4);
}
// a shrub: a low dome of small leaves; some bloom (bougainvillea)
function makeBush(seed, flower) {
  const R = rng(seed), segs = [], leaves = [];
  for (let k = 0; k < 16; k++) {
    const a = k * 2.39996, el = 0.25 + R() * 1.1, L = 0.6 + R() * 0.7, dx = cos(a) * cos(el), dy = sin(el), dz = sin(a) * cos(el);
    segs.push(0, -0.1, 0, 0.03, dx * L, dy * L, dz * L, 0.012, 0, dy * L);
    for (let j = 0; j < 26; j++) { const t = 0.3 + 0.7 * R(), sp = 0.3; leaves.push(dx * L * t + (R() - 0.5) * sp, dy * L * t + (R() - 0.5) * sp, dz * L * t + (R() - 0.5) * sp, 0.16 + R() * 0.12, R() * TAU, -0.3 + R() * 1.2, 0.055, 0.4 + R(), flower && R() < 0.4 && t > 0.6 ? 6 : 0, R(), 0.5 + 0.5 * t, dy * L * t); }
  }
  shuffleLeaves(leaves, R);
  return { segs: new Float32Array(segs), nSeg: 16, nSegFar: 0, leaves: new Float32Array(leaves), nLeaf: leaves.length / 12 };
}
// boats. Both lie along z, bow toward +z. The long-tail (เรือหางยาว): a narrow wooden hull, a tall prow hung with garlands and ribbons,
// a canopy on four posts, the engine at the stern with its long propeller shaft. The fishing boat: deep painted hull, wheelhouse, mast and booms.
const LONGTAIL = mkB().box(0, 0.28, 0, 1.25, 0.5, 6.4, 25).box(0, 0.3, 3.7, 0.85, 0.46, 1.2, 25).box(0, 0.32, -3.5, 0.95, 0.44, 0.8, 25).box(0, 0.56, 0, 1.33, 0.07, 6.5, 4)
  .box(0, 1.05, 4.9, 0.2, 0.2, 2.6, 4, -0.62).box(0, 1.62, 5.75, 0.27, 0.3, 0.3, 20).box(0, 1.38, 5.42, 0.25, 0.28, 0.25, 14)
  .box(-0.55, 1.15, 1.2, 0.05, 1.25, 0.05, 4).box(0.55, 1.15, 1.2, 0.05, 1.25, 0.05, 4).box(-0.55, 1.15, -1.6, 0.05, 1.25, 0.05, 4).box(0.55, 1.15, -1.6, 0.05, 1.25, 0.05, 4)
  .box(0, 1.8, -0.2, 1.5, 0.05, 3.4, 1).box(0, 0.5, 0.6, 1.1, 0.06, 0.3, 4).box(0, 0.5, -0.9, 1.1, 0.06, 0.3, 4).box(0, 0.85, -3.3, 0.38, 0.45, 0.6, 12).box(0, 0.75, -5.3, 0.05, 0.05, 3.8, 12, -0.16);
const SALA = [[-1.6, 1.2, -1, 0.12, 2.4, 0.12, 0, 4], [1.6, 1.2, -1, 0.12, 2.4, 0.12, 0, 4], [-1.6, 1.2, 1, 0.12, 2.4, 0.12, 0, 4], [1.6, 1.2, 1, 0.12, 2.4, 0.12, 0, 4],
  [0, 0.42, 0, 3.4, 0.08, 2.2, 0, 0], [0, 0.75, -0.95, 3.2, 0.5, 0.06, 0, 0], [0, 2.75, -0.68, 4.0, 0.06, 1.7, -0.5, 1], [0, 2.75, 0.68, 4.0, 0.06, 1.7, 0.5, 1]];

// --------------------------------------------------------------------------------------------------------- the device
// boot(): the WebGPU device and the canvas (id="c") made ready. shadow: the side of the shadow map, aa: samples per pixel.
// Hands back null when this browser cannot do it (having said so on the page).
async function boot({ shadow = 4096, aa = 4 } = {}) {
if (!navigator.gpu) { fail('เบราว์เซอร์นี้ไม่รองรับ WebGPU'); return null; }
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) { fail('ไม่พบการ์ดจอที่รองรับ WebGPU'); return null; }
const device = await adapter.requestDevice();
device.addEventListener('uncapturederror', (e) => fail('GPU: ' + e.error.message));
const canvas = $('c'), ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
return { device, canvas, ctx, FMT, Q: device.queue, HDR: 'rgba16float', DEPTH: 'depth24plus', SHADOW: shadow, AA: aa };
}

// --------------------------------------------------------------------------------------------------------- shaders
// The WGSL both pages draw with. X holds what the page puts into the open places (see the head of this file).
function wgsl(X, SHADOW, PCF) {
const W_COMMON = /* wgsl */`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, sun: vec4f, sunCol: vec4f, fwd: vec4f, right: vec4f, up: vec4f,
  fog: vec4f, res: vec4f, amb: vec4f, misc: vec4f, zen: vec4f, hor: vec4f, camM: vec4f${X.uniforms || ''} };
// cam.w time · fwd/right/up: camera basis (right.w, up.w = tan half fov x, y) · fog: x density, y far edge · misc: y wind, z exposure, w night
// camM: xy the eye's place in its 256 m tile. What the remaining places hold is each page's own affair, and so is whatever it adds after camM.
@group(0) @binding(0) var<uniform> g: G;
${X.common || ''}
// Value noise on the whole-number hash: the script has the same function (pn), so both get the same numbers. turf() says where the
// ground is grown over and where it is bare earth; the blades of grass are planted by the same rule, so they stand exactly on the turf.
fn pn(p: vec2f) -> f32 { let i = vec2i(floor(p)); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(ph(i), ph(i + vec2i(1, 0)), u.x), mix(ph(i + vec2i(0, 1)), ph(i + vec2i(1, 1)), u.x), u.y); }
fn turf(P: vec2f) -> f32 { return pn(P * .09) * .5 + pn(P * .37) * .32 + pn(P * 1.3) * .18; }
// blades of grass lying one way: fine streaks close by, the same in broader tufts further off (each scale fades out before it is too fine for the pixels)
// vn with its lattice wrapped every n cells: with a position taken modulo 256 m it has no seam where the position wraps
fn vnp(p: vec2f, n: f32) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f); let a = i - n * floor(i / n); let b = (i + 1.) - n * floor((i + 1.) / n);
  return mix(mix(h2(a), h2(vec2f(b.x, a.y)), u.x), mix(h2(vec2f(a.x, b.y)), h2(b), u.x), u.y); }
fn stk(P: vec2f, a: vec2f, off: f32, px: f32) -> f32 {
  let q = vec2f(dot(P, a), dot(P, vec2f(-a.y, a.x)));
  return .5 + (vn(vec2f(q.x * 75., q.y * 8.) + off) - .5) * (1. - ss(.5, 1.4, px * 75.)) * .8 + (vn(vec2f(q.x * 22., q.y * 2.6) + off + 11.) - .5) * (1. - ss(.5, 1.4, px * 22.)) * .6
    + (vn(vec2f(q.x * 7., q.y * 2.4) + off + 23.) - .5) * (1. - ss(.5, 1.4, px * 7.)) * .26; }      // (the broadest scale is faint and short: tufts, not strokes a metre long)
// stones lying on bare earth. x: 1 on a stone, y: which stone, z: how near its middle (for the light on its rounded top)
fn pebble(P: vec2f, dens: f32) -> vec3f {
  let c = floor(P); var o = vec3f(0.);
  for (var j = -1; j <= 1; j++) { for (var k = -1; k <= 1; k++) {
    let id = c + vec2f(f32(k), f32(j)); let h = h2(id); if (h > dens) { continue; }
    let ctr = id + .5 + (vec2f(h2(id + 3.1), h2(id + 7.7)) - .5) * .7; let dv = (P - ctr) * vec2f(1., .7 + .6 * h2(id + 2.3)); let d = length(dv) / (.13 + .30 * h2(id + 11.3));
    if (d < 1.) { o = vec3f(1., h2(id + 5.), 1. - d * d); } } }
  return o; }
fn h2(p: vec2f) -> f32 { var q = fract(p.xyx * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn vn(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2f(1., 0.)), u.x), mix(h2(i + vec2f(0., 1.)), h2(i + vec2f(1., 1.)), u.x), u.y); }
fn fbm(p: vec2f) -> f32 { var s = 0.; var a = .5; var q = p; for (var i = 0; i < 4; i++) { s += a * vn(q); q = q * 2.03 + vec2f(17.1, 9.7); a *= .5; } return s / .9375; }
fn ph(c: vec2i) -> f32 { var h = bitcast<u32>(c.x) * 374761393u + bitcast<u32>(c.y) * 668265263u; h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u); return f32(h) / 4294967296.; }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
// wind: the whole plant leans with height; nearby parts share a phase so leaves stay on their branches
fn gust(p: vec2f) -> f32 { let t = g.cam.w; return vn(p * .02 - vec2f(t * .35, t * .22)); }      // gusts travel over the land with the wind
fn wind(p: vec2f, hgt: f32) -> vec2f {
  let t = g.cam.w; let W = g.misc.y; let gs = gust(p); let ph = dot(p, vec2f(.021, .017));
  let sway = vec2f(sin(t * 2.1 + ph) + .4 * sin(t * 4.3 + ph * 2.1), cos(t * 1.7 + ph * 1.3) + .35 * sin(t * 3.7 + ph));
  return pow(hgt, 1.5) * .008 * W * (vec2f(.8, .55) * (.15 + 1.0 * gs) + sway * (.25 + .5 * gs));
}
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec2f };
override WS: f32 = 1.;
// One leaf or blade: a strip of 10 vertices bent, tapered and moved here from 12 numbers per instance.
// a: base xyz, length · b: yaw, elevation, half width, droop · c: kind (0 leaf, 1 palm leaflet, 2 grass, 3 green rice, 4 ripe rice, 5 banana leaf), seed, shade, height above the plant's foot
fn leafV(vi: u32, a: vec4f, b: vec4f, c: vec4f) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = f32(vi >> 1u) / 4.;
  let kind = i32(c.x + .5);
  let cy = cos(b.x); let sy = sin(b.x); let ce = cos(b.y); let se = sin(b.y);
  var dir = vec3f(ce * cy, se, ce * sy); var side = vec3f(-sy, 0., cy);
  var shp = pow(max(sin(3.14159 * pow(v, .75)), 0.), .6);
  if (kind == 0) { shp = 1.; }                                         // a sprig: the fragment stage cuts the leaves out of it
  if (kind == 1) { shp = pow(max(sin(3.14159 * pow(v, .5)), 0.), .5); }
  let blade = kind >= 2 && kind <= 4;
  if (blade) { shp = 1. - v * .93; }
  if (kind == 5) { shp = 1.; }      // a whole banana leaf: narrow at the stalk, then a long even paddle, rounded at the end (cut out in fsLeaf)
  if (kind == 7) { shp = 1. - v * .6; }
  if (kind == 8) { shp = 1. - v * .35; }
  if (kind == 9) { shp = 1.; }                                         // a flower head: a square the fragment stage cuts petals from                                // a spray of needles: the fragment stage draws the needles
  var vv = v;
  if (kind == 9) {                                                     // a flower head turns its face to the eye (leaning back a little, each its own way), and is hung by its middle
    let tc = normalize(a.xz - g.cam.xz + vec2f(1e-4, 0.)); let j = (c.y - .5) * 1.2; let cj = cos(j); let sj = sin(j); let t2 = vec2f(tc.x * cj - tc.y * sj, tc.x * sj + tc.y * cj);
    dir = vec3f(t2.x * ce, se, t2.y * ce); side = vec3f(-t2.y, 0., t2.x); vv = v - .5;
  }
  var p = (a.xyz - g.cam.xyz) + a.w * (dir * vv + vec3f(0., -1., 0.) * (b.w * v * v * .5));      // relative to the eye from here on
  let tng = normalize(dir + vec3f(0., -b.w * v, 0.));
  var n = normalize(cross(side, tng));
  let t = g.cam.w;
  let w = wind(a.xz, c.w + v * a.w * se); let gs = gust(a.xz);
  p.x += w.x; p.z += w.y;
  if (blade) { let bend = g.misc.y * (.08 + .5 * gs) * v * v * a.w * .55; p.x += .8 * bend; p.z += .55 * bend; p.y -= bend * .35; }      // waves run through grass and rice
  if (kind == 9) { let bend = g.misc.y * (.08 + .5 * gs) * c.w * .55; p.x += .8 * bend; p.z += .55 * bend; p.y -= bend * .35; }      // rides on the tip of its stalk
  let fl = g.misc.y * (.4 + 1.2 * gs) * sin(t * (6. + c.y * 4.) + c.y * 40. + a.x * 1.7) * .07 * v * a.w;
  p += mix(n, side, f32(blade)) * fl + side * (fl * .4 * (1. - f32(blade)));
  if (!blade) { let bp = h2(floor(a.xz / 1.3) + floor(a.y / 1.3) * 7.); p += vec3f(.8, .35, .55) * (g.misc.y * (.2 + gs) * .006 * min(c.w, 9.) * sin(t * 3.1 + bp * 6.2832)); }      // each bough tosses on its own
  p += side * (u * b.z * shp * WS);
  o.wp = p + g.cam.xyz; o.n = normalize(n + side * (u * .35)); o.uv = vec2f(u, v); o.cp = g.vp * vec4f(p, 1.);
  var col = mix(vec3f(.070, .140, .020), vec3f(.045, .100, .020), c.y);
  var tr = 1.;
  if (c.y > .86) { col = vec3f(.14, .15, .03); }
  if (kind == 1) { col = mix(vec3f(.07, .15, .03), vec3f(.10, .17, .035), c.y); }
  if (kind == 2) { col = mix(vec3f(.11, .17, .03), vec3f(.17, .20, .045), c.y); if (c.y > .8) { col = vec3f(.24, .21, .07); } }
  if (kind == 3) { col = mix(vec3f(.085, .20, .025), vec3f(.13, .23, .035), c.y); }
  if (kind == 4) { col = mix(vec3f(.30, .24, .06), vec3f(.36, .27, .08), c.y); }
  if (kind == 5) { col = mix(vec3f(.10, .23, .03), vec3f(.065, .17, .025), c.y); if (c.y > .93) { col = vec3f(.20, .21, .05); } }
  if (kind == 7) { col = mix(vec3f(.20, .13, .06), vec3f(.26, .19, .09), c.y); tr = .3; }
  if (kind == 6) { col = mix(vec3f(.70, .06, .32), vec3f(.85, .30, .50), c.y); if (c.y > .8) { col = vec3f(.85, .80, .75); } }
  // dry season: grass turns to straw, trees yellow a little
  if (kind == 2) { col = mix(col, vec3f(.27, .22, .08), g.fog.w * .8); }
  if (kind == 0) { col = mix(col, vec3f(.13, .13, .03), g.fog.w * .4); }
  if (kind == 8) { col = mix(vec3f(.060, .105, .050), vec3f(.105, .150, .065), c.y); }
  if (kind == 9) { col = mix(vec3f(.90, .48, .03), vec3f(.95, .72, .06), c.y); if (c.z < .8) { col = mix(vec3f(.80, .25, .50), vec3f(.88, .84, .86), step(.6, c.y)); } tr = .7; }      // a flower head
${X.leafTint || ''}
  o.col = col; o.pr = vec2f(c.z, tr + 2. * f32(kind == 0) + 4. * c.y * f32(kind == 0) + 10. * f32(kind == 8) + 20. * f32(kind == 9) + (30. + 4. * c.y) * f32(kind == 5));
  return o;
}
struct BO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) @interpolate(flat) m: f32 };
// One piece of trunk or branch: a tapered tube between two points (p0 r0 → p1 r1), h = heights above the foot for the wind
fn branchV(v: vec3f, p0: vec4f, p1: vec4f, h: vec2f) -> BO {
  var o: BO;
  let ax = p1.xyz - p0.xyz; let d = ax / max(length(ax), 1e-4);
  var upv = vec3f(0., 1., 0.); if (abs(d.y) > .95) { upv = vec3f(1., 0., 0.); }
  let x = normalize(cross(upv, d)); let y = cross(d, x);
  let nn = x * v.x + y * v.y;
  let pc = mix(p0.xyz - g.cam.xyz, p1.xyz - g.cam.xyz, v.z); var rr = mix(p0.w, p1.w, v.z);      // relative to the eye
  if (h.x < -.5) { rr = max(rr, length(pc) * .0009); }      // a wire is never drawn thinner than a pixel: it would break up into flickering dots
  var p = pc + nn * rr;
  let plant = step(-.5, h.x);                                  // h.x = -1 marks a made thing: h.y 0 concrete pole, 1 wire, 2 green stem
  let w = wind(mix(p0.xz, p1.xz, v.z), max(mix(h.x, h.y, v.z), 0.)) * plant;
  p.x += w.x; p.z += w.y;
  if (h.x < -1.5) { let w2 = wind(mix(p0.xz, p1.xz, v.z), -h.x - 2.); p.x += w2.x; p.z += w2.y; }      // a made thing fixed to a plant (h.x = -2 - its height) sways with it, as its leaves do: a banana's stems, bunch and bud
  o.m = (1. - plant) * (h.y + 1.);
  o.wp = p + g.cam.xyz; o.n = nn; o.uv = vec2f(atan2(v.y, v.x) / 6.2832, ${X.barkV || 'p.y + g.cam.y'}); o.cp = g.vp * vec4f(p, 1.);
  return o;
}
`;
// vertex stages, shared by the picture and by the shadow map (which uses the light's matrix as vp)
const W_VERT = /* wgsl */`
struct TO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) w: f32, @location(3) rel: vec3f };
@vertex fn vsTerrain(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) w: f32) -> TO { var o: TO; o.wp = p; o.n = n; o.w = w; o.rel = p - g.cam.xyz; o.cp = g.vp * vec4f(o.rel, 1.); return o; }
@vertex fn vsLeaf(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f) -> LO { return leafV(vi, a, b, c); }
struct XO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) @interpolate(flat) ln: vec3f, @location(4) @interpolate(flat) m: vec4f };
// a box (walls, floors, roof sheets, posts): a centre + turn about the vertical, b size + tilt about its long axis, c material + seed
@vertex fn vsBox(@location(0) v: vec3f, @location(1) nv: vec3f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f) -> XO {
  var o: XO; var vv = v; var nn = nv;
  if (c.w > .5 && c.w < 1.5) {                      // a gable: the top edge is pulled in to a ridge along x
    if (v.y > 0.) { vv.z = 0.; }
    if (abs(nv.z) > .5) { nn = normalize(vec3f(0., b.z * .5, sign(nv.z) * b.y)); }
  }
  var l = vv * b.xyz; let ct = cos(b.w); let st = sin(b.w);
  l = vec3f(l.x, l.y * ct - l.z * st, l.y * st + l.z * ct); var n = vec3f(nn.x, nn.y * ct - nn.z * st, nn.y * st + nn.z * ct);
  let cy = cos(a.w); let sy = sin(a.w);
  let lo = vec3f(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy); let w0 = lo + a.xyz;
  var wf = w0; if (c.w > 1.5) { let t = g.cam.w; wf.y += .10 * sin(w0.x * .42 + w0.z * .17 + t * 1.3) + .07 * sin(w0.z * .5 - w0.x * .2 + t * .9); }      // afloat: rides the swell
  let w = wf; o.wp = w; o.n = vec3f(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy); o.lp = vv * b.xyz; o.ln = nv; o.m = c;
  // Places far from the origin are drawn from where they stand relative to the eye, not from their world position: 40 km out a world
  // coordinate is only good to 4 mm, and every corner of every box would jitter from frame to frame.
  o.cp = g.vp * vec4f(lo + (a.xyz - g.cam.xyz) + vec3f(0., wf.y - w0.y, 0.), 1.);
  return o;
}
@vertex fn vsBranch(@location(0) v: vec3f, @location(1) p0: vec4f, @location(2) p1: vec4f, @location(3) h: vec2f) -> BO { return branchV(v, p0, p1, h); }
`;
const W_SCENE = W_COMMON + W_VERT + /* wgsl */`
@group(0) @binding(1) var tSh: texture_depth_2d;
@group(0) @binding(2) var sSh: sampler_comparison;
fn shadow(wp: vec3f) -> f32 {
  let s = g.sm * vec4f(wp - g.cam.xyz, 1.); let uv = vec2f(s.x * .5 + .5, .5 - s.y * .5);
  if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1. || s.z > 1.) { return 1.; }
  let e = 1.3 / ${SHADOW}.; var a = 0.;
  for (var x = -${PCF}; x <= ${PCF}; x++) { for (var y = -${PCF}; y <= ${PCF}; y++) { a += textureSampleCompareLevel(tSh, sSh, uv + vec2f(f32(x), f32(y)) * e, s.z - .0012); } }
  let edge = ss(.5, .44, max(abs(uv.x - .5), abs(uv.y - .5)));
  return mix(1., a / ${(2 * PCF + 1) ** 2}., edge);
}
// the colour of the far distance in a given direction: the sky's horizon, glowing toward the sun
fn horizon(rd: vec3f) -> vec3f {
  let hd = normalize(vec3f(rd.x, 0., rd.z) + vec3f(1e-5, 0., 0.));
  let sd = max(dot(hd, normalize(vec3f(g.sun.x, 0., g.sun.z) + vec3f(1e-5, 0., 0.))), 0.);
  return g.hor.rgb + g.sunCol.rgb * (pow(sd, 6.) * .05 + pow(sd, 40.) * .08) * ss(-.1, .5, 1. - g.sun.y);
}
fn sky(n: vec3f) -> vec3f { let up = n.y * .5 + .5; return g.amb.rgb * (.30 + .70 * up * up) + g.sunCol.rgb * vec3f(.05, .045, .03) * max(-n.y, 0.); }
fn fogged(c: vec3f, wp: vec3f) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v); let hc = horizon(v / d);
  return mix(c, hc, max(1. - exp(-d * g.fog.x), ss(g.fog.y * .72, g.fog.y, d)));
}
@fragment fn fsTerrain(i: TO) -> @location(0) vec4f {
  let wp = i.wp; let P = wp.xz; var n = normalize(i.n);
  // px: how much ground one pixel covers (m). A pattern of F cycles to the metre can only be drawn while px * F is well under 1; past that it is
  // faded to its mean value, or it would crawl and sparkle as the car moves. (So: fine grain near, coarser grain further off, tone only far away.)
  // Pf: the place within a 256 m tile, worked out from the position relative to the eye (exact) and the eye's own place in the tile (g.camM,
  // reckoned in double precision by the script). All fine grain is drawn from Pf: an absolute position is only good to millimetres far from the origin.
  let Pf = fract((i.rel.xz + g.camM.xy) / 256.) * 256.;
  let dPx = dpdx(i.rel.xz); let dPy = dpdy(i.rel.xz); let pxa = length(dPx); let pxb = length(dPy); let px = sqrt(max(sqrt(pxa * pxb) * max(pxa, pxb), 1e-10));      // between the pixel's mean size and its long side on the ground
  let n1 = fbm(P * .045); let n2 = vn(P * .55); let n3 = mix(.5, vn(P * 3.7), 1. - ss(.5, 1.4, px * 3.7)); let n4 = mix(.5, vnp(Pf * 14., 3584.), 1. - ss(.5, 1.4, px * 14.));
  let e = .12; let f3 = 1. - ss(.5, 1.4, px * 3.7); let r3 = vn(P * 3.7); let bx = (vn((P + vec2f(e, 0.)) * 3.7) - r3) * f3; let bz = (vn((P + vec2f(0., e)) * 3.7) - r3) * f3;
  // dry verge: patchy turf over red-brown laterite soil
  // Seen close, the ground has grain: on the turf, blades lying this way and that over dark thatch, straw among the green, hollows between
  // the clumps; on bare earth, grit, small stones, hairline cracks and pale dust where it has baked hard. Beyond 60 m only the tones are left.
  let dcam = length(i.rel); let nk = 1. - ss(16., 60., dcam); let Vg = -i.rel / max(dcam, .01);
  let e2 = .02; let Pr = vec2f(Pf.x * .809 + Pf.y * .588, Pf.y * .809 - Pf.x * .588);      // turned, so the fine grain does not line up with the coarse
  let f5 = 1. - ss(.5, 1.4, px * 34.); let r5 = vn(Pr * 23.) * .6 + vn(Pr * 51. + 7.) * .4; let n5 = mix(.5, r5, f5);
  let fbx = (vn((Pr + vec2f(e2, 0.)) * 23.) * .6 + vn((Pr + vec2f(e2, 0.)) * 51. + 7.) * .4 - r5) * f5; let fbz = (vn((Pr + vec2f(0., e2)) * 23.) * .6 + vn((Pr + vec2f(0., e2)) * 51. + 7.) * .4 - r5) * f5;
  let tfv = turf(P); let rag = (mix(.5, vnp(Pf * 6., 1536.), 1. - ss(.5, 1.4, px * 6.)) * .55 + n5 * .45 - .5) * .17;                 // the turf's edge is ragged: tufts push out over the earth
  let s1 = stk(Pf, vec2f(.955, .296), 0., px); let s2 = stk(Pf, vec2f(.17, .985), 31., px); let s3 = stk(Pf, vec2f(-.80, .60), 57., px);
  let wsel = vn(P * 1.3 + 5.); let blades = max(mix(s1, s2, ss(.35, .65, wsel)), s3 * .85);
  let straw = vec3f(.27, .22, .08);
  let gcol = mix(mix(vec3f(.085, .135, .025), vec3f(.150, .170, .045), n1), straw * .85, g.fog.w * .75);      // the blades' own colours
  var grass = mix(mix(vec3f(.045, .050, .020), gcol * .45, .5), gcol * 1.2, ss(.42, .82, blades));          // thatch in the gaps, lit blades over it
  grass = mix(grass, straw * 1.05, ss(.74, .9, s3) * ss(.4, .7, vn(P * .7 + 21.)) * .7);                      // dead blades, more in some patches
  grass *= (.62 + .62 * n2) * (.80 + .40 * n3);                                                             // clumps and the hollows between them
  grass = mix(gcol * (.70 + .55 * n2) * (.9 + .2 * n3), grass, nk);
  let graze = pow(1. - max(Vg.y, 0.), 3.);
  grass = mix(grass, mix(gcol, vec3f(dot(gcol, vec3f(.3, .6, .1))), .2), graze * .45);                                        // looking along the ground you see only the tips
  var soil = mix(vec3f(.27, .15, .085), vec3f(.20, .13, .09), pn(P * .21)) * (.68 + .55 * n3);
  soil = mix(soil, vec3f(.34, .24, .155) * (.8 + .3 * n3), ss(.5, .8, vn(P * .9 + 13.)) * .4);
  let gedge = tfv - .40 + rag + graze * .05; let gm = ss(-.03, .03, gedge);                                 // seen along the ground the grass hides the gaps
  if (nk > .01) {
    soil *= 1. + nk * ((n5 - .5) * .7 + (n4 - .5) * .4);
    soil *= 1. - .35 * nk * f5 * ss(.035, .0, abs(vnp(Pf * 4.296875 + 40., 1100.) - .5)) * ss(.45, .7, vn(P * .5 + 3.));
    let pb = pebble(Pr * 17., .22); soil = mix(soil, mix(soil * .7, mix(vec3f(.24, .19, .15), vec3f(.36, .31, .26), pb.y), .75) * (.6 + .6 * pb.z), pb.x * nk * f5);
    let lf = pebble(Pr * vec2f(9., 14.) + 70., .03 + .09 * ss(.5, .8, vn(P * .3))); soil = mix(soil, mix(vec3f(.17, .11, .05), vec3f(.30, .22, .10), lf.y), lf.x * nk * .8 * (1. - ss(.5, 1.4, px * 20.)));      // dry leaves and bits of straw
  }
  var alb = mix(soil * (1. - .28 * ss(-.14, 0., gedge)), grass, gm);                                         // the earth is darker and damper in under the edge of the turf
  var bump = .9; var gloss = .02; var wet = 0.;
${X.ground}
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - wp);
  let ndl = max(dot(n, L), 0.);
  let sh = shadow(wp + normalize(i.n) * .12);
  let E = g.sunCol.rgb * sh;
${X.groundLight}
}
@fragment fn fsLeaf(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  var alb = i.col * mix(.50, 1.18, i.uv.y) * (.74 + .26 * ss(0., .3, abs(i.uv.x)));
  var trv = i.pr.y;
  if (i.pr.y > 29.) {          // banana leaf, cut from the strip: a long paddle with a wavy edge and a round end, a thick pale midrib, close veins running out to the edge, and notches torn in along the veins - few on a young leaf, many and deep on an old one
    let sd = (i.pr.y - 31.) / 4.; let ax = abs(i.uv.x); let v = i.uv.y; trv = .5;
    var wv = min(pow(ss(0., .12, v), .65), sqrt(max(1. - pow(max(v - .80, 0.) / .20, 2.), 0.))) * (.84 + .16 * sin(3.14159 * v));
    wv *= 1. - .05 * sin(v * 46. + sd * 40.) - .03 * sin(v * 17. + sd * 9.);
    if (ax > wv && (ax > .07 || v > .3)) { discard; }
    let sg = step(0., i.uv.x); let s = v * 24. - ax * 2.4 + sd * 7.; let cell = floor(s);
    let hs = h2(vec2f(cell + sg * 57., sd * 53. + 3.)); let hd = h2(vec2f(cell * 1.7 + sg * 31., sd * 17. + 1.)); let amt = .10 + sd * .62;
    if (hs < amt && v > .1) { let dep = wv * (.10 + .8 * hd * (1. - .45 * sd)); if (ax > dep && fract(s) < (.14 + .4 * hd) * (.55 + sd) * (ax - dep) / max(wv - dep, .02)) { discard; } }
    let vein = .91 + .09 * sin(s * 31.);
    alb = i.col * vein * mix(1.12, .86, ax / max(wv, .05)) * mix(.88, 1.08, v);
    alb = mix(alb, vec3f(.40, .45, .15), ss(.085, .03, ax));
    alb = mix(alb, vec3f(.24, .17, .07), ss(.8, 1., ax / max(wv, .05)) * ss(.45, .9, sd) * .8);
  } else
  if (i.pr.y > 19.) {          // a flower seen from above or the side: eight petals round a dark eye
    trv = .7; let q = vec2f(i.uv.x, i.uv.y * 2. - 1.); let rr = length(q); let an = atan2(q.y, q.x);
    if (rr > .52 + .44 * abs(cos(an * 4.))) { discard; }
    alb = mix(i.col * (.75 + .4 * rr) * (.9 + .1 * cos(an * 8.)), i.col * vec3f(.35, .22, .08), ss(.26, .18, rr));
  } else
  if (i.pr.y > 9.) {           // casuarina: a hanging spray of long thin needles
    trv = 1.;
    if (distance(g.cam.xyz, i.wp) < 75.) {
      let sx = i.uv.x * 3.4 * (1. + i.uv.y * .35) + sin(i.uv.y * 4. + i.uv.x * 2.) * .12; let fr = abs(fract(sx) - .5);
      if (fr > .13 && !(abs(i.uv.x) < .07 && i.uv.y < .5)) { discard; }
      alb = i.col * (.8 + .5 * h2(vec2f(floor(sx), 3.))) * mix(.7, 1.15, i.uv.y);
    } else { alb = i.col * .8; }
  } else
  if (i.pr.y > 1.5) {          // a sprig of a broadleaf tree: four pairs of leaves and one at the tip, on a thin twig
    let sd = (i.pr.y - 3.) * .25; trv = 1.; let ax = abs(i.uv.x); let dcam = distance(g.cam.xyz, i.wp);
    if (dcam > 60.) { let q = vec2f(i.uv.x, i.uv.y * 2. - 1.); if (dot(q, q) > 1.) { discard; } alb = i.col * .95; }
    else {
      let yy = i.uv.y * 4. - ax * 1.3 + .25; let j = floor(yy); let fy = fract(yy);
      let q = vec2f((ax - .54) / .45, (fy - .5) / .40);
      let lf = step(dot(q, q), 1.) * step(0., j) * step(j, 3.);
      let qt = vec2f(i.uv.x / .34, (i.uv.y - .86) / .14); let tip = step(dot(qt, qt), 1.);
      let twig = step(ax, .04) * step(i.uv.y, .8);
      if (max(max(lf, tip), twig) < .5) { discard; }
      let id = h2(vec2f(j + sign(i.uv.x) * 7. + tip * 31., sd * 97.));
      let rib = mix(ss(.0, .16, abs(q.y)), ss(.0, .12, abs(qt.x)), tip);                      // the pale midrib of each leaf
      let vein = .92 + .08 * sin((ax + abs(q.y) * .8) * 46.);
      alb = i.col * (.72 + .5 * id) * mix(1.25, 1., rib) * vein * mix(1., .78, ss(.6, 1., dot(q, q)) * (1. - tip));
      alb = mix(alb, i.col * vec3f(1.5, 1.35, .7), step(.93, id) * .6);                           // the odd yellowing leaf
      if (twig > .5 && max(lf, tip) < .5) { alb = vec3f(.10, .075, .05); trv = 0.; }
      n = normalize(n + (vec3f(id, h2(vec2f(id * 9., 3.)), h2(vec2f(id * 5., 8.))) - .5) * .7);   // every leaf faces its own way
    }
  }
  let ndl = dot(n, L);
  let ao = i.pr.x;
  let E = g.sunCol.rgb * shadow(i.wp + L * .2);
  // light through the leaf from behind: warm and bright, the look of living foliage
  let through = (max(-ndl, 0.) * .8 + .1) * trv;
  var c = alb * E * (max(ndl, 0.) + through * vec3f(1.35, 1.3, .65));
  c += alb * (sky(n) + sky(-n) * .45) * ao;
  c += (E + sky(n) * .6) * pow(max(dot(n, normalize(V + L)), 0.), 28.) * (.10 + .55 * g.amb.w) * max(ndl, .15 * g.amb.w);      // wet leaves glisten
  c += E * alb * pow(max(dot(-V, L), 0.), 5.) * .5 * ao;
  c += alb * head(i.wp, n) * 1.2;
  return vec4f(fogged(c, i.wp), 1.);
}
@fragment fn fsBranch(i: BO) -> @location(0) vec4f {
  let n = normalize(i.n); let L = g.sun.xyz;
  let fur = vn(vec2f(i.uv.x * 26., i.uv.y * .9)) * .6 + vn(vec2f(i.uv.x * 60., i.uv.y * 3.)) * .4;
  var alb = mix(vec3f(.045, .032, .024), vec3f(.20, .15, .105), ss(.3, .7, fur)) * (.8 + .4 * vn(i.wp.xy * 7.));
  var nb = n;
  if (i.m < .5) {
    let fx = vn(vec2f(i.uv.x * 26. + .6, i.uv.y * .9)) * .6 + vn(vec2f(i.uv.x * 60. + 1.2, i.uv.y * 3.)) * .4;
    let tg = normalize(cross(vec3f(0., 1., 0.), n) + vec3f(1e-4, 0., 0.)); nb = normalize(n - tg * (fx - fur) * 2.2);
    alb *= .55 + .9 * ss(.25, .75, fur);                                                             // deep in the furrows it is dark
    alb = mix(alb, vec3f(.30, .33, .25), ss(.62, .8, vn(i.wp.xy * 1.7 + i.wp.z)) * .55);              // pale lichen
    alb *= (.8 + .2 * vn(vec2f(i.uv.x * 7., i.uv.y * 11.))) * (1. - .35 * g.amb.w);                                             // cross cracks
  }
  if (i.m > .5) { alb = vec3f(.40, .39, .37) * (.8 + .3 * vn(i.wp.xy * 9.)); }
  if (i.m > 1.5) { alb = vec3f(.012); }
  if (i.m > 2.5) { alb = mix(vec3f(.16, .22, .07), vec3f(.24, .22, .10), fur); }
  if (i.m > 2.5 && i.m < 3.5) { alb = mix(alb, vec3f(.22, .15, .08), ss(.55, .8, vn(vec2f(i.uv.x * 9., i.uv.y * 2.))) * .6); }   // dry brown sheaths on banana stems
  if (i.m > 3.5) { alb = mix(vec3f(.16, .11, .07), vec3f(.30, .24, .18), fur); }      // fence wood, weathered
  if (i.m > 4.5) { alb = vec3f(.46, .47, .48) * (.85 + .2 * fur); }
  if (i.m > 5.5) { alb = mix(vec3f(.22, .04, .10), vec3f(.32, .08, .14), fur); }                    // banana flower bud
  if (i.m > 6.5) { alb = vec3f(.80, .79, .75) * (.88 + .14 * fur); }                                // whitewash (a chedi)
  if (i.m > 7.5) { alb = vec3f(.82, .62, .12); }                                                    // gilding
  if (i.m > 33.5 && i.m < 34.5) { alb = mix(vec3f(.16, .26, .04), vec3f(.30, .36, .07), ss(.3, .7, vn(i.wp.xz * 9. + i.wp.y * 5.))) * (.85 + .2 * fur); }      // green bananas on the bunch
  if (i.m > 34.5 && i.m < 35.5) { let st = vn(vec2f(i.uv.x * 44., i.uv.y * 1.3)); alb = mix(vec3f(.30, .22, .11), vec3f(.52, .42, .23), st) * (.85 + .3 * fur); alb = mix(alb, vec3f(.15, .10, .06), ss(.62, .88, vn(vec2f(i.uv.x * 7., i.uv.y * 2.2))) * .6); }      // foot of a banana stem: dry brown sheaths, stringy, with dark patches
  if (i.m > 35.5 && i.m < 36.5) { let st = vn(vec2f(i.uv.x * 30., i.uv.y * 1.1)); alb = mix(vec3f(.30, .38, .11), vec3f(.46, .47, .20), st); alb = mix(alb, vec3f(.30, .21, .10), ss(.5, .8, vn(vec2f(i.uv.x * 6., i.uv.y * 1.4))) * .6); }      // top of the stem: yellow-green sheaths, streaked brown
${X.branchLight}
  return vec4f(fogged(c, i.wp), 1.);
}
fn bar(p: vec2f, c: vec2f, h: vec2f) -> f32 { let q = abs(p - c) - h; return step(max(q.x, q.y), 0.); }
// a whole number written in seven-segment figures across the unit square q; places to the left of its first figure are left blank
fn num(q: vec2f, n: i32, cnt: i32) -> f32 {
  if (q.x < 0. || q.x >= 1. || q.y < 0. || q.y > 1.) { return 0.; }
  let fx = q.x * f32(cnt); let di = cnt - 1 - i32(floor(fx)); var v = n; for (var k = 0; k < di; k++) { v = v / 10; }
  if (v == 0 && di > 0) { return 0.; }
  let cell = vec2f(fract(fx) * 1.25 - .125, q.y); return seg7w(cell, v % 10) * step(0., cell.x) * step(cell.x, 1.); }
fn seg7w(p: vec2f, d: i32) -> f32 {
  var tbl = array<i32, 10>(126, 48, 109, 121, 51, 91, 95, 112, 127, 123); let m = tbl[clamp(d, 0, 9)]; var s = 0.;
  s = max(s, bar(p, vec2f(.5, .915), vec2f(.31, .085)) * f32((m >> 6u) & 1)); s = max(s, bar(p, vec2f(.86, .71), vec2f(.1, .29)) * f32((m >> 5u) & 1));
  s = max(s, bar(p, vec2f(.86, .29), vec2f(.1, .29)) * f32((m >> 4u) & 1)); s = max(s, bar(p, vec2f(.5, .085), vec2f(.31, .085)) * f32((m >> 3u) & 1));
  s = max(s, bar(p, vec2f(.14, .29), vec2f(.1, .29)) * f32((m >> 2u) & 1)); s = max(s, bar(p, vec2f(.14, .71), vec2f(.1, .29)) * f32((m >> 1u) & 1));
  s = max(s, bar(p, vec2f(.5, .5), vec2f(.31, .08)) * f32(m & 1));
  return s;
}
fn seg7(p: vec2f, d: i32) -> f32 {
  var tbl = array<i32, 10>(126, 48, 109, 121, 51, 91, 95, 112, 127, 123); let m = tbl[clamp(d, 0, 9)]; var s = 0.;
  s = max(s, bar(p, vec2f(.5, .92), vec2f(.26, .07)) * f32((m >> 6u) & 1)); s = max(s, bar(p, vec2f(.86, .71), vec2f(.08, .2)) * f32((m >> 5u) & 1));
  s = max(s, bar(p, vec2f(.86, .29), vec2f(.08, .2)) * f32((m >> 4u) & 1)); s = max(s, bar(p, vec2f(.5, .08), vec2f(.26, .07)) * f32((m >> 3u) & 1));
  s = max(s, bar(p, vec2f(.14, .29), vec2f(.08, .2)) * f32((m >> 2u) & 1)); s = max(s, bar(p, vec2f(.14, .71), vec2f(.08, .2)) * f32((m >> 1u) & 1));
  s = max(s, bar(p, vec2f(.5, .5), vec2f(.26, .06)) * f32(m & 1));
  return s;
}
// strong sign colours
fn pal2(h: f32) -> vec3f {
  if (h < .22) { return vec3f(.70, .06, .05); } if (h < .40) { return vec3f(.85, .65, .05); } if (h < .56) { return vec3f(.06, .22, .55); }
  if (h < .70) { return vec3f(.05, .40, .18); } if (h < .86) { return vec3f(.85, .84, .80); } return vec3f(.80, .30, .05);
}
// paint colours of town walls
fn pal(h: f32) -> vec3f {
  if (h < .30) { return vec3f(.82, .76, .62); } if (h < .40) { return vec3f(.80, .70, .42); } if (h < .47) { return vec3f(.55, .68, .78); }
  if (h < .53) { return vec3f(.78, .58, .55); } if (h < .92) { return vec3f(.82, .80, .73); } return vec3f(.58, .74, .64);      // mostly cream and off-white, as Thai towns are painted
}
// houses: weathered board walls, corrugated sheet roofs, dark openings, posts
@fragment fn fsBox(i: XO) -> @location(0) vec4f {
  let n = normalize(i.n); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  var uv = i.lp.xy; if (abs(i.ln.y) > .5) { uv = i.lp.xz; } else if (abs(i.ln.x) > .5) { uv = i.lp.zy; }
  let mat = i32(i.m.x + .5); let sd = i.m.y; var alb = vec3f(.5); var gloss = 0.; var emi = vec3f(0.); let night = g.misc.w; let dcb = distance(g.cam.xyz, i.wp); let fN = 1. - ss(12., 30., dcb);      // fN: 1 near, 0 where a wall's fine grain is smaller than a pixel (there it is left out)
  if (mat == 0) {            // upright boards, each its own shade, dark joints, grain
    let b = uv.x / .17; let id = floor(b); let fb = fract(b);
    let tone = mix(vec3f(.30, .19, .11), vec3f(.26, .24, .21), step(.55, sd));       // teak brown or sun-greyed
    alb = tone * (.7 + .5 * h2(vec2f(id, sd * 91.))) * (.85 + .3 * vn(vec2f(uv.x * 40., uv.y * 2.)));
    alb *= ss(0., .07, fb) * ss(1., .93, fb) * .8 + .2;
  } else if (mat == 1) {     // corrugated roof sheets: rust red, zinc grey or faded blue, streaked by rain
    let rib = sin(uv.x * 42.) * .5 + .5;
    alb = mix(vec3f(.36, .11, .07), vec3f(.44, .45, .46), step(.4, sd)); if (sd > .78) { alb = vec3f(.14, .26, .40); }
    alb *= (.62 + .38 * rib) * (.75 + .35 * vn(vec2f(uv.x * 3., uv.y * .7))) ; gloss = .35;
    alb = mix(alb, vec3f(.25, .12, .06), ss(.62, .8, vn(uv * 1.7 + sd * 30.)) * .5);
  } else if (mat == 2) { alb = vec3f(.62, .60, .55) * (.85 + .2 * vn(uv * 6.)); }
  else if (mat == 3) { alb = vec3f(.025, .022, .02); }
  else if (mat == 6) {       // the floors of a shophouse over its shop: a strip of mezzanine glass, painted render; the back and the end walls
    let hh = i.m.z * .5; let y0 = i.lp.y + hh + 3.05; let ux = i.lp.x / 4. + .5;
    var wall = pal(sd) * (.84 + .16 * vn(vec2f(i.lp.x * 1.6 + sd * 9., y0 * .6))) * mix(.98, .93 + .1 * vn(uv * 11.), fN);
    wall = mix(wall, wall * .62, ss(.45, .85, vn(vec2f(uv.x * 2.4 + sd * 5., y0 * .22))) * .55);        // streaks of rain grime
    wall *= 1. - .2 * ss(.27, .04, fract((y0 - 5.) / 3.)) * step(5., y0) * ss(.35, .7, vn(vec2f(uv.x * 3.1 + sd * 7., 1.5)));      // dark runs down the wall under the window sills
    let fy = fract((y0 - 5.) / 3.); let up = step(5., y0);
    wall *= 1. - .22 * step(fy, .03) * up * (1. - ss(40., 80., dcb));
    if (i.ln.z > .5) {
      if (y0 > 3.45 && y0 < 4.8) {
        let band = step(.07, ux) * step(ux, .93); let mul = ss(0., .05, abs(fract(ux * 4.) - .5) - .44);
        wall = mix(wall, mix(vec3f(.05, .065, .08), vec3f(.52, .52, .50), mul), band);
        emi = vec3f(1., .74, .40) * night * step(.6, h2(vec2f(sd * 19., 5.))) * band * (1. - mul) * .9; gloss = band * .5;
      }
    } else if (i.ln.z < -.5) {      // the back: bare render gone grey, a louvred window and a bathroom vent on every floor, a waste pipe down the wall
      wall = mix(wall, vec3f(.50, .49, .46) * (.8 + .25 * vn(uv * 3.)), .55);
      wall = mix(wall, wall * .6, ss(.45, .8, vn(vec2f(uv.x * 3. + sd * 7., y0 * .3))) * .6);
      let wn = step(.5, ux) * step(ux, .82) * step(.36, fy) * step(fy, .74) * up; let lv = .55 + .45 * step(.5, fract(y0 * 9.));
      wall = mix(wall, vec3f(.07, .09, .10) * lv, wn); emi = vec3f(1., .8, .55) * night * wn * step(.6, h2(vec2f(sd * 23., floor((y0 - 5.) / 3.)))) * .7;
      wall = mix(wall, vec3f(.05), step(.16, ux) * step(ux, .28) * step(.62, fy) * step(fy, .76) * up);
      wall = mix(wall, vec3f(.28, .30, .34), step(abs(ux - .93), .014));
    } else if (abs(i.ln.x) > .5) {   // an end wall: the concrete frame shows through the render, rain has drawn long stains down it
      let dz = i.lp.z; let fr_ = max(step(.46, abs(fract(dz / 4.) - .5)), step(fy, .07) * up);
      wall = mix(wall, wall * vec3f(.86, .85, .83), fr_ * .7);
      wall = mix(wall, wall * .55, ss(.4, .9, vn(vec2f(dz * 1.3 + sd * 11., y0 * .12))) * ss(2., 0., hh - i.lp.y) * .7);
      wall = mix(wall, wall * .7, ss(.55, .8, vn(vec2f(dz * .4, y0 * .5) + sd * 3.)) * .45);
    }
    if (i.ln.y > .5) { wall = vec3f(.33, .32, .30) * (.8 + .3 * vn(i.lp.xz * 2.)); }
    if (i.ln.y < -.5) { wall = vec3f(.42, .41, .39); emi = vec3f(1., .82, .55) * night * .5 * step(abs(i.lp.x), .7) * step(4., i.lp.z); }      // the shop's ceiling and its strip lights
    alb = wall;
  }
  else if (mat == 31) {      // shelves of goods from floor to ceiling
    let c2 = vec2f(uv.x / .24, uv.y / .44); let id = floor(c2); let f = fract(c2); let hsh = h2(id + sd * 57.);
    let goods = mix(pal2(hsh), pal(fract(hsh * 7.3)), step(.5, fract(hsh * 3.7))) * (.55 + .45 * h2(id * 1.7 + sd));
    alb = mix(vec3f(.07, .06, .05), goods, step(.14, f.y) * step(f.y, .14 + .5 + .3 * hsh) * step(.1, f.x));
    alb = mix(alb, vec3f(.34, .31, .27), step(f.y, .09)); alb = mix(alb, vec3f(.20, .17, .14), ss(25., 70., dcb)); emi = alb * night * 1.3;
  }
  else if (mat == 32) {      // roller shutter: steel slats, bare or painted, rust creeping up from the foot
    let hh = i.m.z * .5; let slat = mix(.92, .68 + .32 * ss(.0, .5, abs(fract(uv.y * 11.) - .5) * 2.), fN);
    alb = mix(vec3f(.36, .37, .38), pal(fract(sd * 5.3)) * .62, step(.55, sd)) * slat * (.88 + .15 * vn(uv * 5.));
    alb = mix(alb, vec3f(.25, .12, .06) * slat, ss(.9, .0, i.lp.y + hh) * ss(.35, .7, vn(vec2f(uv.x * 4., sd * 9.))) * .7); gloss = .3;
  }
  else if (mat == 37) {      // a speed limit sign: a white disc ringed in red, the figure (kept in m.z) in black; plain grey behind
    let q = i.lp.xy / .375; let r = length(q); if (r > 1.) { discard; }
    let nn = i32(i.m.z + .5); let p = vec2f(q.x * 1.9 + 1., q.y * 1.25 + .5); let cell = vec2f(fract(p.x) * 1.25 - .125, p.y);
    var dv = nn % 10; if (p.x < 1.) { dv = (nn / 10) % 10; }
    let ink = seg7(cell, dv) * step(0., cell.x) * step(cell.x, 1.) * step(0., p.y) * step(p.y, 1.) * step(0., p.x) * step(p.x, 2.);
    alb = mix(mix(vec3f(.88), vec3f(.03), ink), vec3f(.75, .04, .03), step(.76, r)); gloss = .2;
    if (i.ln.z < .5) { alb = vec3f(.42, .43, .44); }
  }
  else if (mat == 41) { alb = vec3f(.86, .85, .81) * (.9 + .1 * vn(uv * 5.)); alb = mix(alb, alb * .78, ss(.5, .85, vn(vec2f(uv.x * 2.5, uv.y * .3))) * .35); }      // whitewash, a little weathered
  else if (mat == 39) {      // a wheel: only the round of it is drawn (seed 0: the box is thin along x; 1: thin along z)
    var q = i.lp.yz; var face = abs(i.ln.x); if (sd > .5) { q = i.lp.xy; face = abs(i.ln.z); }
    let r = length(q) / (i.m.z * .5); if (face < .5 || r > 1.) { discard; }
    alb = mix(vec3f(.025), vec3f(.30, .31, .32), step(r, .5) * step(.12, r)); gloss = .2 * step(r, .5);
  }
  else if (mat == 38) { let t = (i.lp.y / i.m.z + .5) * 6.; alb = mix(vec3f(.62, .04, .08), vec3f(.88), step(1., t) * step(t, 5.)); alb = mix(alb, vec3f(.08, .09, .32), step(2., t) * step(t, 4.)); }      // the Thai flag: red, white, blue (double), white, red
  else if (mat == 33) { alb = pal2(sd) * (.9 + .1 * vn(uv * 14.)); gloss = .35; }      // plastic and paintwork in strong colours: stools, crates, motorcycles
  else if (mat == 34) { alb = vec3f(.50, .51, .52) * (.88 + .14 * vn(vec2f(uv.x * 4., uv.y * 40.))); gloss = .9; }      // stainless steel
  else if (mat == 35) {      // folding wooden shop doors (บานเฟี้ยม): narrow leaves, old paint
    let b = uv.x / .44; let fb = fract(b); let hh = i.m.z * .5;
    let tone = mix(vec3f(.28, .18, .10), mix(vec3f(.15, .29, .28), vec3f(.19, .25, .37), step(.5, fract(sd * 3.))), step(.4, sd));
    alb = tone * (.72 + .4 * h2(vec2f(floor(b), sd * 91.))) * (.82 + .3 * vn(vec2f(uv.x * 30., uv.y * 2.)));
    alb *= ss(0., .06, fb) * ss(1., .94, fb) * .75 + .25; alb *= 1. - .25 * step(abs(abs(fract(b) - .5) - .25), .2) * step(abs(i.lp.y + hh * .1), hh * .7) * step(.86, fract(uv.y / (hh * .72)));
  }
  else if (mat == 36) { var q = uv; if (abs(i.ln.y) > .5) { q = i.lp.xz; } alb = mix(pal2(sd), vec3f(.78, .77, .72), step(.5, fract(q.x / .14))) * (.75 + .2 * vn(q * 3.)); }      // striped canvas awning (narrow stripes)
  else if (mat == 23) {      // a sign board. The name in one row of large letters of even height, with the small marks Thai writes above some letters and below a few;
    // under it a row of small figures (the telephone number). A lightbox at night, unless the height slot is negative (road signs are not lit).
    var q = i.lp.xy; if (abs(i.ln.x) > .5) { q = i.lp.zy; }
    let hgt = abs(i.m.z); let bg = pal2(sd); var fg = vec3f(.95, .93, .86);
    if (dot(bg, vec3f(.3, .6, .1)) > .45) { fg = mix(vec3f(.60, .04, .04), vec3f(.05, .13, .45), step(.5, h2(vec2f(sd * 13., 2.)))); }      // on yellow or white: red or blue letters
    if (i.m.z < 0. && dot(bg, vec3f(.3, .6, .1)) > .45) { fg = vec3f(.04); }
    let cx = q.x / (hgt * .30) + 50.; let id = floor(cx); let fx = fract(cx); let hc = h2(vec2f(id, sd * 31.)); let yy = q.y / hgt; let wch = .62 + .3 * hc;
    var ink = step(abs(fx - .5), wch * .5) * step(abs(yy - .06), .2) * step(.07, hc);
    ink *= 1. - step(abs(fx - .5), wch * .5 - .17) * step(abs(yy - .06 - (step(.5, fract(hc * 7.)) - .5) * .24), .11);          // each letter open at the top or at the foot
    ink = max(ink, step(abs(fx - (.5 - wch * .5 + .1)), .1) * step(abs(yy - .2), .06) * step(.07, hc));                         // the little head a Thai letter starts from
    ink = max(ink, step(abs(fx - .55), .22) * step(abs(yy - .355), .035) * step(fract(hc * 5.3), .36));                       // marks above
    ink = max(ink, step(abs(fx - .5), .2) * step(abs(yy + .2), .028) * step(fract(hc * 11.7), .1));                           // and below
    let dg = q.x / (hgt * .11) + 30.; ink = max(ink, step(.22, fract(dg)) * step(abs(yy + .36), .05) * step(.2, h2(vec2f(floor(dg), sd * 17.))));
    alb = mix(bg, fg, mix(ink, .25, ss(20., 55., dcb))) * (.9 + .1 * vn(q * 6.)); emi = alb * night * 1.4 * step(0., i.m.z); gloss = .25;
    if (abs(i.ln.y) > .5 || (abs(i.ln.z) > .5 && abs(i.ln.x) > .5)) { alb = vec3f(.2); }
  }
  else if (mat == 24) {      // retaining wall of fitted rubble stone, pale mortar between
    let q = uv * vec2f(2.4, 3.4) + vec2f(floor(uv.y * 3.4) * .5, 0.); let id = floor(q); let f = fract(q);
    let jt = vec2f(h2(id), h2(id + 7.)) * .25; let ed = min(min(f.x - jt.x * .5, 1. - f.x), min(f.y - jt.y * .5, 1. - f.y));
    alb = mix(vec3f(.40, .38, .34), mix(vec3f(.27, .26, .25), vec3f(.36, .33, .29), h2(id + 3.)) * (.8 + .4 * vn(uv * 9.)), ss(.02, .09, ed));
  }
  else if (mat == 22) {      // air conditioner: a pale box with the dark round grille of its fan
    let q = i.lp.xy; let r = length((q - vec2f(-.12, 0.)) / vec2f(.21, .21));
    alb = vec3f(.62, .62, .60) * (.9 + .1 * vn(uv * 20.));
    if (i.ln.z > .5) { alb = mix(alb, vec3f(.10, .10, .11) * (.6 + .4 * step(.5, fract(r * 6.))), step(r, 1.)); }
  }
  else if (mat == 7 || mat == 8) {   // taller block (7) or a concrete house (8): rows of windows on every side
    var hx = i.lp.x; if (abs(i.ln.x) > .5) { hx = i.lp.z; }
    let cw = select(3.4, 3.0, mat == 7); let ch = select(3.0, 3.2, mat == 7);
    let y0 = i.lp.y + i.m.z * .5; let fx = fract(hx / cw + .5); let fy = fract(y0 / ch); let fl = floor(y0 / ch);
    let win = step(.22, fx) * step(fx, .78) * step(.34, fy) * step(fy, .80) * (1. - step(.5, abs(i.ln.y)));
    var wall = select(pal(sd), mix(vec3f(.72, .72, .70), pal(sd), .35), mat == 7) * (.8 + .2 * vn(vec2f(hx * 1.5 + sd * 9., y0 * .3)));
    wall *= 1. - .25 * step(fy, .06) * (1. - ss(80., 160., dcb));
    let lit = night * step(.55, h2(vec2f(floor(hx / cw + .5) + sd * 31., fl + sd * 17.)));
    alb = mix(wall, mix(vec3f(.04, .055, .07), vec3f(.10, .15, .20), fy), win); emi = vec3f(1., .74, .40) * lit * win * 1.5; gloss = win * .5;
    if (i.ln.y > .5) { alb = vec3f(.33, .32, .30); }
  }
  else if (mat == 9) {       // roof tiles in rows: terracotta, blue or green glaze
    let r = fract(uv.y / .34);
    alb = mix(vec3f(.50, .19, .11), vec3f(.13, .22, .40), step(.6, sd)); if (sd > .82) { alb = vec3f(.12, .30, .20); }
    alb *= (.6 + .4 * r) * (.8 + .3 * h2(vec2f(floor(uv.x / .25), floor(uv.y / .34)))); gloss = .25;
  }
  else if (mat == 11) {      // kilometre stone: white-painted concrete, black figures. Toward the road: a mark, the route number, the kilometre. On the sides, which meet the traffic: a name and how far it is.
    alb = vec3f(.88, .88, .85) * (.88 + .14 * vn(i.lp.xy * 14.) ) * (.92 + .08 * vn(uv * 3.));
    let n = i32(i.m.z + .5); var ink = 0.; let y = i.lp.y;
    if (i.m.z >= 0. && abs(i.ln.z) > .5) { let x = i.lp.x * sign(i.ln.z);
      ink = max(max(step(abs(y - .262 - abs(x) * .55), .013) * step(abs(x), .085), step(abs(x), .02) * step(abs(y - .25), .04)), step(abs(abs(x) - .018), .008) * step(abs(y - .2), .014));      // a plain mark where the emblem goes: wings raised, body, legs
      ink = max(ink, num(vec2f(x / .20 + .5, (y - .12) / .075 + .5), i32(sd + .5), 4));
      ink = max(ink, num(vec2f(x / .34 + .5, (y + .10) / .21 + .5), n, 3));
    } else if (i.m.z >= 0. && abs(i.ln.x) > .5) { let u = -i.lp.z * sign(i.ln.x); let gx = u / .034 + 40.;
      ink = step(.22, fract(gx)) * step(h2(vec2f(floor(gx), f32(n))), .82) * step(abs(u), .1) * step(abs(y - .15), .012 + .014 * h2(vec2f(floor(gx), 3.)));
      ink = max(ink, num(vec2f(u / .17 + .5, (y + .06) / .14 + .5), select(n % 47 + 3, 50 - n % 47, i.ln.x > 0.), 2)); }
    alb = mix(alb, vec3f(.04), ink);
  }
  else if (mat == 16) {      // weatherboard: overlapping horizontal planks, each a little different, sun-bleached and stained
    let b = uv.y / .17; let id = floor(b); let fb = fract(b);
    let tone = mix(vec3f(.33, .21, .12), vec3f(.30, .27, .23), step(.5, sd)) * mix(1., .8, step(.8, fract(sd * 7.)));
    alb = tone * (.72 + .45 * h2(vec2f(id, sd * 91.))) * (.85 + .3 * vn(vec2f(uv.x * 3., id * 7.))) * (.9 + .15 * vn(vec2f(uv.x * 60., uv.y * 4.)));
    alb *= mix(.45, 1., ss(0., .16, fb)) * mix(1., 1.12, ss(.75, 1., fb));           // shadow under each lap, light on its lower edge
    alb = mix(alb, alb * vec3f(.6, .62, .55), ss(.55, .8, vn(vec2f(uv.x * 1.3 + sd * 20., uv.y * .35))) * .5);   // rain stains
  }
  else if (mat == 17) {      // window glass: dark inside, a reflection of the sky at a slant, lit at night in some
    let fr = .06 + .94 * pow(1. - max(dot(n, V), 0.), 4.); let R = reflect(-V, n);
    alb = vec3f(.03, .04, .05);
    emi = mix(horizon(R), g.zen.rgb, ss(0., .7, max(R.y, 0.))) * fr * .7 + vec3f(1., .74, .40) * night * step(.45, sd) * 1.3;
    gloss = .8;
  }
  else if (mat == 18) {      // painted cement render: soft blotches, red dust splashed up from the ground, streaks below the eaves
    let hh = i.m.z * .5;
    alb = pal(sd) * (.86 + .14 * vn(uv * 1.4 + sd * 9.)) * mix(.98, .93 + .1 * vn(uv * 11.), fN);
    alb = mix(alb, vec3f(.36, .22, .14), ss(.7, 0., i.lp.y + hh) * .5 * step(.5, i.m.z));
    alb = mix(alb, alb * .72, ss(.5, .85, vn(vec2f(uv.x * 2.2 + sd * 5., uv.y * .3))) * ss(.2, 1.2, i.lp.y + hh) * .35);
  }
  else if (mat == 19) { alb = vec3f(.60, .59, .56) * (.82 + .2 * vn(uv * 9.)) * mix(.96, .9 + .12 * vn(uv * 40.), 1. - ss(4., 12., dcb)); gloss = .15; }
  else if (mat == 12) { alb = vec3f(.50, .51, .52) * (.7 + .3 * abs(sin(i.lp.y * 21.))) * (.85 + .2 * vn(i.lp.xy * 5.)); gloss = .5; }   // steel guard rail, ribbed
  else if (mat == 13) { alb = mix(vec3f(.80, .79, .76), vec3f(.75, .04, .03), step(.22, i.lp.y) * step(i.lp.y, .34)); emi = vec3f(.8, .05, .03) * g.misc.x * .15 * step(.22, i.lp.y) * step(i.lp.y, .34); }   // marker post with a red reflector band
  else if (mat == 20) { let bd = vec3f(i.lp.x, i.lp.y, i.lp.z) * 22.; alb = mix(vec3f(.95, .50, .03), vec3f(1., .78, .08), vn(bd.xy + bd.z)) * (.75 + .35 * abs(sin(bd.x + bd.y + bd.z))); emi = alb * g.sunCol.rgb * .04; }   // marigold garland
  else if (mat == 14) { alb = mix(vec3f(.62, .08, .06), vec3f(.80, .60, .12), step(.5, fract(i.lp.y * 9.)) * .6); gloss = .3; }      // spirit house: red and gold
  else if (mat == 15) { alb = vec3f(.82, .62, .12) * (.8 + .3 * vn(uv * 20.)); gloss = .6; }
  else if (mat == 10) { alb = vec3f(.6); emi = vec3f(1., .8, .5) * night * 9.; }
  else if (mat == 25) {      // a wooden boat: oiled planks, a band of bright paint under the gunwale
    let hh = i.m.z * .5; alb = vec3f(.30, .18, .09) * (.7 + .5 * vn(vec2f(uv.x * 3., uv.y * 22.)));
    alb = mix(alb, pal2(sd), step(hh - .16, i.lp.y) * step(abs(i.ln.y), .5)); alb = mix(alb, vec3f(.7), step(hh - .04, i.lp.y) * step(abs(i.ln.y), .5)); gloss = .2;
  }
  else if (mat == 26) { alb = mix(vec3f(.74, .74, .70), vec3f(.60, .06, .05), step(.5, fract(i.wp.z / 1.6))) * (.85 + .2 * vn(i.wp.xz * 9.)); }      // kerb stones painted red and white
  else if (mat == 27) {      // a panel of steel bars (fence or sliding gate): upright bars in a frame, painted; drawn broader with distance (never thinner than a pixel), closing to a plain panel far off
    let hh = i.m.z * .5; let bar = step(abs(fract(uv.x / .115) - .5), max(.085, dcb * .0125)); let rail = max(step(hh - .05, abs(uv.y)), step(abs(uv.y + hh * .45), .02));
    if (abs(i.ln.z) > .5 && max(bar, rail) < .5) { discard; }
    alb = vec3f(.05, .05, .055); if (sd > .4) { alb = vec3f(.22, .07, .05); } if (sd > .7) { alb = vec3f(.05, .14, .09); } if (sd > .9) { alb = vec3f(.5, .5, .52); } gloss = .45;
  }
  else if (mat == 28) {      // ventilation blocks: a concrete screen of square openings
    let f = fract(uv / .19); let hw_ = .3 * ss(60., 25., dcb); let hole = step(abs(f.x - .5), hw_) * step(abs(f.y - .5), hw_);      // the openings close up with distance
    if (abs(i.ln.z) > .5 && hole > .5) { discard; }
    alb = vec3f(.52, .51, .48) * (.8 + .25 * vn(uv * 12.));
  }
  else if (mat == 29) { alb = mix(pal2(sd) * .8, vec3f(.55, .54, .51), step(.5, fract(atan2(i.lp.z, i.lp.x) / 6.2832 * 8.))); }      // beach umbrella: striped canvas
  else if (mat == 5) {       // yellow warning sign: black border and an elephant
    let q = i.lp.zy; let edge = max(abs(q.x), abs(q.y));
    let r = vec2f(q.x + q.y, q.y - q.x) * .7071;                    // the sign hangs as a diamond: turn the drawing upright
    let body = length((r - vec2f(-.02, -.01)) / vec2f(.15, .095)); let hd = length((r - vec2f(.15, .04)) / vec2f(.075, .08));
    let legs = step(abs(abs(r.x + .02) - .09), .03) * step(-.19, r.y) * step(r.y, -.02); let trunk = step(abs(r.x - .21), .018) * step(-.13, r.y) * step(r.y, .05);
    var ink = max(max(step(body, 1.), step(hd, 1.)), max(legs, trunk));
    if (sd > .33) { let cx = .075 * sin(r.y * 15.); ink = max(step(abs(r.x - cx), .03) * step(abs(r.y), .19), step(abs(r.x - .075 * sin(2.85)) * 1.3 + (r.y - .19), .075) * step(.19, r.y)); }     // winding road
    if (sd > .66) { let ramp = -.13 + (r.x + .2) * .5; ink = max(step(r.y, ramp) * step(-.15, r.y) * step(abs(r.x), .2), step(abs(r.x - .02), .07) * step(ramp, r.y) * step(r.y, ramp + .09)); }   // steep hill
    alb = mix(vec3f(.85, .62, .03), vec3f(.02), max(ink, step(.325, edge) * step(edge, .36))); gloss = .1;
  }
${X.boxMats || ''}
  else { alb = vec3f(.16, .11, .07) * (.7 + .5 * vn(vec2f(uv.x * 30., uv.y * 2.))); }
  // walls are darker tucked up under the eaves and where they meet the ground
  var ao = 1.;
  if (i.m.z > .5 && abs(i.ln.y) < .5 && mat != 38) { let hh = i.m.z * .5; ao = mix(.55, 1., ss(0., .45, hh - i.lp.y)) * mix(.72, 1., max(ss(0., .5, i.lp.y + hh), f32(mat == 6))); }      // (a shophouse's upper floors do not start at the ground)
  let ndl = max(dot(n, L), 0.);
  let E = g.sunCol.rgb * shadow(i.wp + n * .1);
  var c = alb * (E * ndl + sky(n) * ao) + E * pow(max(dot(n, normalize(V + L)), 0.), 40.) * ndl * gloss + alb * head(i.wp, n) + emi;
  return vec4f(fogged(c, i.wp), 1.);
}
struct SO { @builtin(position) cp: vec4f, @location(0) q: vec2f };
@vertex fn vsSky(@builtin(vertex_index) i: u32) -> SO { var o: SO; let p = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1)); o.cp = vec4f(p, 1., 1.); o.q = p; return o; }
${X.scene}
`;
const W_SHADOW = W_COMMON + W_VERT;
const W_POST = /* wgsl */`
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var t: texture_2d<f32>;
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO { var o: VO; let p = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1)); o.cp = vec4f(p, 0., 1.); o.uv = vec2f(p.x * .5 + .5, .5 - p.y * .5); return o; }
fn tap(uv: vec2f, o: vec2f) -> vec3f { let d = 1. / vec2f(textureDimensions(t)); return textureSampleLevel(t, s, uv + o * d, 0.).rgb; }
fn box(uv: vec2f) -> vec3f { return (tap(uv, vec2f(-1., -1.)) + tap(uv, vec2f(1., -1.)) + tap(uv, vec2f(-1., 1.)) + tap(uv, vec2f(1., 1.))) * .25; }
@fragment fn fsBright(i: VO) -> @location(0) vec4f { let c = box(i.uv); let l = max(c.r, max(c.g, c.b)); return vec4f(c * max(l - 1., 0.) / max(l, 1e-4), 1.); }
@fragment fn fsDown(i: VO) -> @location(0) vec4f { return vec4f(box(i.uv), 1.); }
@fragment fn fsUp(i: VO) -> @location(0) vec4f { return vec4f(box(i.uv), 1.); }
`;
const W_FINAL = /* wgsl */`
@group(0) @binding(0) var s: sampler;
@group(0) @binding(1) var tS: texture_2d<f32>;
@group(0) @binding(2) var tB: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: vec4f;
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO { var o: VO; let p = vec2f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1)); o.cp = vec4f(p, 0., 1.); o.uv = vec2f(p.x * .5 + .5, .5 - p.y * .5); return o; }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), vec3f(0.), vec3f(1.)); }
@fragment fn fs(i: VO) -> @location(0) vec4f {
  var c = textureSampleLevel(tS, s, i.uv, 0.).rgb + textureSampleLevel(tB, s, i.uv, 0.).rgb * ${(X.bloom === undefined ? 0.22 : X.bloom).toFixed(3)};
  c *= u.x;
  let ry = abs(u.y); let snf = step(u.y, -.01);
  if (ry > .01) {            // rain falling past the eye in slanting streaks, or snow drifting down; three depths; the scene greyed
    let lum = dot(c, vec3f(.3, .6, .1)); c = mix(c, vec3f(lum) * vec3f(.96, 1., 1.05), .22 * ry); var r = 0.;
    for (var k = 0; k < 3; k++) {
      let fk = f32(k); let sc = 16. + fk * 14.;
      var p = vec2f(i.uv.x * sc * 1.78 + i.uv.y * sc * u.w + fk * 7.3, i.uv.y * sc * mix(.16, 1., snf) - u.z * mix(5.5 - fk * 1.2, 1.5 - fk * .35, snf));
      p.x += snf * sin(u.z * .8 + p.y * .7 + fk) * .35;
      p.y += fract(sin(floor(p.x) * 91.7 + fk) * 43758.5453) * 9.;                 // every column falls out of step with its neighbours
      let id = floor(p); let f = fract(p); let h = fract(sin(dot(id, vec2f(127.1, 311.7))) * 43758.5453);
      let on = step(1. - (.1 + .5 * ry), h); let x0 = .2 + .6 * fract(h * 57.3);
      let streak = (1. - ss(0., mix(.05, .03, fk * .5), abs(f.x - x0))) * ss(0., .25, f.y) * ss(1., .55, f.y);
      let flake = 1. - ss(.03, .11 - fk * .02, length(f - vec2f(x0, .5)));
      r += on * mix(streak, flake * 1.6, snf) * (.55 - .13 * fk);
    }
    c += vec3f(.72, .78, .88) * r * (.06 + lum * .5) * (.5 + .5 * ry) * mix(1., 1.8, snf);
  }
  let q = i.uv - .5; c *= 1. - dot(q, q) * .45;
  c = aces(c);
${X.grade || ''}
  let l = dot(c, vec3f(.2126, .7152, .0722)); c = mix(vec3f(l), c, 1.06);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = fract(52.9829189 * fract(dot(i.cp.xy, vec2f(.06711056, .00583715))));
  return vec4f(c + (n - .5) / 255., 1.);
}
`;
return { W_SCENE, W_SHADOW, W_POST, W_FINAL };
}

// --------------------------------------------------------------------------------------------------------- pipelines
// renderer(): compiles the shaders with the page's parts in them and builds what every page draws with.
// X: { wgsl, floats: how many floats the uniform block holds, pcf: 1 = shadows softened over 3 x 3 taps, 0 = one tap,
//      maxDpr: the most device pixels to a CSS pixel, sceneBindings: more entries for the scene's bind group layout }
async function renderer(gpu, X) {
const { device, canvas, ctx, FMT, Q, HDR, DEPTH, SHADOW, AA } = gpu;
const { W_SCENE, W_SHADOW, W_POST, W_FINAL } = wgsl(X.wgsl, SHADOW, X.pcf === undefined ? 1 : X.pcf);
async function mod(code, name) {
  const m = device.createShaderModule({ code });
  const info = await m.getCompilationInfo();
  for (const e of info.messages) if (e.type === 'error') fail(`WGSL ${name} line ${e.lineNum}: ${e.message}\n   ${code.split('\n')[e.lineNum - 1]}`);
  return m;
}
const mScene = await mod(W_SCENE, 'scene'), mShadow = await mod(W_SHADOW, 'shadow'), mPost = await mod(W_POST, 'post'), mFinal = await mod(W_FINAL, 'final');
const UBN = X.floats, UB = new Float32Array(UBN), UBS = new Float32Array(UBN);
const ubo = device.createBuffer({ size: UBN * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const uboS = device.createBuffer({ size: UBN * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const tShadow = device.createTexture({ size: [SHADOW, SHADOW], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
const vShadow = tShadow.createView();
const bglScene = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
  { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }, ...(X.sceneBindings || [])] });
const bglShadow = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }] });
const sShadowCmp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
// the bind group the scene is drawn with. A page that asked for bindings of its own (X.sceneBindings) hands their resources in `more`.
const sceneGroup = (buf, more = []) => device.createBindGroup({ layout: bglScene, entries: [{ binding: 0, resource: { buffer: buf } }, { binding: 1, resource: vShadow }, { binding: 2, resource: sShadowCmp }, ...more] });
const bgShadow = device.createBindGroup({ layout: bglShadow, entries: [{ binding: 0, resource: { buffer: uboS } }] });
const plScene = device.createPipelineLayout({ bindGroupLayouts: [bglScene] }), plShadow = device.createPipelineLayout({ bindGroupLayouts: [bglShadow] });
const LB_TERRAIN = [{ arrayStride: 28, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] }];
const LB_LEAF = [{ arrayStride: 48, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }] }];
const LB_BRANCH = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
  { arrayStride: 40, stepMode: 'instance', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }, { shaderLocation: 2, offset: 16, format: 'float32x4' }, { shaderLocation: 3, offset: 32, format: 'float32x2' }] }];
const LB_BOX = [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
  { arrayStride: 48, stepMode: 'instance', attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' }, { shaderLocation: 4, offset: 32, format: 'float32x4' }] }];
const scenePipe = (vs, fs, buffers, topology = 'triangle-list', ws = 1, depthCompare = 'less') => device.createRenderPipeline({ layout: plScene,
  vertex: Object.assign({ module: mScene, entryPoint: vs, buffers }, vs === 'vsLeaf' ? { constants: { WS: ws } } : {}),
  fragment: { module: mScene, entryPoint: fs, targets: [{ format: HDR }] },
  primitive: { topology, cullMode: 'none' }, multisample: { count: AA },
  depthStencil: { format: DEPTH, depthWriteEnabled: depthCompare === 'less', depthCompare } });
const shadowPipe = (vs, buffers, topology = 'triangle-list', ws = 1) => device.createRenderPipeline({ layout: plShadow,
  vertex: Object.assign({ module: mShadow, entryPoint: vs, buffers }, vs === 'vsLeaf' ? { constants: { WS: ws } } : {}),
  primitive: { topology, cullMode: 'none' },
  depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5 } });
const pTerrain = scenePipe('vsTerrain', 'fsTerrain', LB_TERRAIN), pBranch = scenePipe('vsBranch', 'fsBranch', LB_BRANCH), pBox = scenePipe('vsBox', 'fsBox', LB_BOX);
// leaves come in three densities: every leaf nearby, then a third and a ninth of them made wider to cover the same area
const LODW = [1, 1.75, 3.1], LODN = [1, 3, 9];
const pLeaf = LODW.map((w) => scenePipe('vsLeaf', 'fsLeaf', LB_LEAF, 'triangle-strip', w));
const pSky = scenePipe('vsSky', 'fsSky', [], 'triangle-list', 1, 'less-equal');
const pBoxS = shadowPipe('vsBox', LB_BOX);
const pTerrainS = shadowPipe('vsTerrain', LB_TERRAIN), pBranchS = shadowPipe('vsBranch', LB_BRANCH), pLeafS = shadowPipe('vsLeaf', LB_LEAF, 'triangle-strip', LODW[1]), pLeafS2 = shadowPipe('vsLeaf', LB_LEAF, 'triangle-strip', LODW[2]);
const sLin = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const postPipe = (fs, blend) => device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' },
  fragment: { module: mPost, entryPoint: fs, targets: [{ format: HDR, blend }] } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pBright = postPipe('fsBright'), pDown = postPipe('fsDown'), pUp = postPipe('fsUp', ADD);
const pFinal = device.createRenderPipeline({ layout: 'auto', vertex: { module: mFinal, entryPoint: 'vs' }, fragment: { module: mFinal, entryPoint: 'fs', targets: [{ format: FMT }] } });
const uFinal = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

// tube mesh shared by every trunk and branch piece: 8 sides
const SIDES = 8;
const tubeV = new Float32Array((SIDES + 1) * 6), tubeI = new Uint16Array(SIDES * 6);
for (let k = 0; k <= SIDES; k++) { const a = k / SIDES * TAU; tubeV.set([cos(a), sin(a), 0, cos(a), sin(a), 1], k * 6); }
for (let k = 0; k < SIDES; k++) tubeI.set([2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 2, 2 * k + 1, 2 * k + 3], k * 6);
const vbuf = (data, usage = GPUBufferUsage.VERTEX) => { const b = device.createBuffer({ size: max(16, (data.byteLength + 3) & ~3), usage: usage | GPUBufferUsage.COPY_DST }); Q.writeBuffer(b, 0, data); return b; };
const vbTube = vbuf(tubeV), ibTube = vbuf(tubeI, GPUBufferUsage.INDEX);
// unit cube shared by every box
const cubeV = [], cubeI = [];
for (const [nx, ny, nz, ux, uy, uz, vx, vy, vz] of [[1, 0, 0, 0, 0, 1, 0, 1, 0], [-1, 0, 0, 0, 0, -1, 0, 1, 0], [0, 1, 0, 1, 0, 0, 0, 0, 1], [0, -1, 0, 1, 0, 0, 0, 0, -1], [0, 0, 1, -1, 0, 0, 0, 1, 0], [0, 0, -1, 1, 0, 0, 0, 1, 0]]) {
  const b = cubeV.length / 6;
  for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cubeV.push((nx + ux * a + vx * c) / 2, (ny + uy * a + vy * c) / 2, (nz + uz * a + vz * c) / 2, nx, ny, nz);
  cubeI.push(b, b + 1, b + 2, b, b + 2, b + 3);
}
const vbCube = vbuf(new Float32Array(cubeV)), ibCube = vbuf(new Uint16Array(cubeI), GPUBufferUsage.INDEX);

// The picture is drawn at the size of the canvas times `scale` (a page lowers it when frames come slowly). resize() makes the targets
// anew when that size changes and hands back T: W, H and the views to draw into (vMS: multisampled, vScene: resolved, vDepth).
let W = 0, H = 0, tMS, tDepth, tScene, vMS, vDepth, vScene, bloomT = [], bloomV = [], bgBloom = [], bgFinal;
const NB = 5, T = { W, H, vMS, vDepth, vScene }, maxDpr = X.maxDpr || 1.5;
function resize(scale = 1) {
  const dpr = min(devicePixelRatio || 1, maxDpr) * scale;
  const w = max(64, floor(canvas.clientWidth * dpr)), h = max(64, floor(canvas.clientHeight * dpr));
  if (w === W && h === H) return T;
  W = w; H = h; canvas.width = W; canvas.height = H;
  for (const t of [tMS, tDepth, tScene, ...bloomT]) t && t.destroy();
  tMS = device.createTexture({ size: [W, H], format: HDR, sampleCount: AA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  tDepth = device.createTexture({ size: [W, H], format: DEPTH, sampleCount: AA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  tScene = device.createTexture({ size: [W, H], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  vMS = tMS.createView(); vDepth = tDepth.createView(); vScene = tScene.createView();
  bloomT = []; bloomV = []; bgBloom = [];
  for (let i = 0; i < NB; i++) { const t = device.createTexture({ size: [max(1, W >> (i + 1)), max(1, H >> (i + 1))], format: HDR, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }); bloomT.push(t); bloomV.push(t.createView()); }
  const bg = (p, v) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: sLin }, { binding: 1, resource: v }] });
  bgBloom = { bright: bg(pBright, vScene), down: bloomV.map((v) => bg(pDown, v)), up: bloomV.map((v) => bg(pUp, v)) };
  bgFinal = device.createBindGroup({ layout: pFinal.getBindGroupLayout(0), entries: [{ binding: 0, resource: sLin }, { binding: 1, resource: vScene }, { binding: 2, resource: bloomV[0] }, { binding: 3, resource: { buffer: uFinal } }] });
  T.W = W; T.H = H; T.vMS = vMS; T.vDepth = vDepth; T.vScene = vScene;
  return T;
}
// The end of a frame, after the page has drawn its picture into vMS / vScene:
// bloom (bright parts spread down a chain of smaller images and added back up), then to the screen: exposure, filmic curve, vignette.
// What the last pass needs to know (exposure, ...) the page writes into uFinal.
function post(enc) {
  const pass = (v, pipe, bg, load = 'clear') => { const q = enc.beginRenderPass({ colorAttachments: [{ view: v, clearValue: [0, 0, 0, 1], loadOp: load, storeOp: 'store' }] }); q.setPipeline(pipe); q.setBindGroup(0, bg); q.draw(3); q.end(); };
  pass(bloomV[0], pBright, bgBloom.bright);
  for (let i = 1; i < NB; i++) pass(bloomV[i], pDown, bgBloom.down[i - 1]);
  for (let i = NB - 1; i > 0; i--) pass(bloomV[i - 1], pUp, bgBloom.up[i], 'load');
  const p = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] });
  p.setPipeline(pFinal); p.setBindGroup(0, bgFinal); p.draw(3); p.end();
}
return { UBN, UB, UBS, ubo, uboS, tShadow, vShadow, bglScene, bglShadow, sShadowCmp, sceneGroup, bgShadow, plScene, plShadow, LB_TERRAIN, LB_LEAF, LB_BRANCH, LB_BOX, scenePipe, shadowPipe, pTerrain, pBranch, pBox, LODW, LODN, pLeaf, pSky, pBoxS, pTerrainS, pBranchS, pLeafS, pLeafS2, sLin, postPipe, ADD, pBright, pDown, pUp, pFinal, uFinal, SIDES, tubeV, tubeI, vbuf, vbTube, ibTube, cubeV, cubeI, vbCube, ibCube, mScene, mShadow, mPost, mFinal, resize, post };
}

return { $, fail, clamp, mix, sm, fract, hash, vnoise, fbm, ph, pn, turfAt, rng, mul, view, cross, nrm3, shuffleLeaves, makeTree, makePalm, makeSugarPalm, makeBanana, mkB, addGableRoof, makeBush, LONGTAIL, SALA, boot, renderer };
})();
