// =====================================================================================================================
// คำอธิษฐาน: ดึงจาก API มาแสดงบนกระทงและโคมที่ลอยอยู่ และส่งคำอธิษฐานของผู้เล่นขึ้นไป
//
//   await Wishes.load({ timeout })   ดึงคำอธิษฐานล่าสุด (ไม่สำเร็จหรือยังไม่มีข้อความ ก็ยังใช้ได้: จะสุ่มจากคำอธิษฐานตัวอย่าง)
//   Wishes.pick()                    คำอธิษฐานถัดไปสำหรับกระทงหรือโคมหนึ่งใบ: { text, real } (real: มาจากผู้เล่นจริง)
//   await Wishes.send({ text, place, kind })   ส่งคำอธิษฐาน ส่งไม่ได้ก็เก็บไว้ในเบราว์เซอร์แล้วลองส่งใหม่ครั้งหน้า
//   Wishes.poll(ms, onNew)           ดึงข้อความใหม่เป็นระยะ
//   Wishes.source                    'firebase' | 'offline' (ไม่ได้ตั้งค่า หรือดึงไม่สำเร็จ)
//   Wishes.counts()                  จำนวนกระทงและโคมที่ลอยไปแล้ว { krathong, lantern } (ทันที จากที่รู้ล่าสุด)
//   Wishes.bump(kind)                ผู้เล่นลอยกระทงหรือปล่อยโคมไปหนึ่ง: นับเพิ่ม (และบอกเซิร์ฟเวอร์ถ้ามี)
//   Wishes.watchCounts(cb)           เรียก cb(counts) ทุกครั้งที่ตัวเลขเปลี่ยน
//
// ช่วงแรกใช้ Firebase Realtime Database ผ่าน REST (ไม่ต้องโหลด SDK) ถ้าจะเปลี่ยนไปใช้ API ของตัวเอง แก้แค่ BACKEND ข้างล่าง:
//   list(limit) -> Promise<[{ id, text, place, kind, t }]>   และ   add({ text, place, kind }) -> Promise<void>
// =====================================================================================================================
window.Wishes = (() => {
  const CFG = window.FIREBASE_CONFIG || {};
  const MAX = 120;
  const off = new URLSearchParams(location.search).get('api') === 'off';
  const base = off ? '' : String(CFG.databaseURL || '').trim().replace(/\/+$/, '');
  const node = encodeURIComponent(CFG.path || 'wishes');

  // ---------------------------------------------------------------------------------------------- backend: Firebase RTDB REST
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
  const BACKEND = base ? {
    async list(limit) {
      // push key เรียงตามเวลาอยู่แล้ว จึงขอ limitToLast ตาม $key ได้โดยไม่ต้องตั้ง index
      const r = await fetch(`${base}/${node}.json?orderBy=%22$key%22&limitToLast=${limit}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = (await r.json()) || {};
      return Object.keys(data).map((id) => Object.assign({ id }, data[id]));
    },
    async add(w) {
      const r = await fetch(`${base}/${node}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: w.text, place: w.place, kind: w.kind, t: { '.sv': 'timestamp' } }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    },
  } : null;

  // ---------------------------------------------------------------------------------------------- คำอธิษฐานตัวอย่าง
  const SAMPLE = [
    'ขอให้ครอบครัวมีสุขภาพแข็งแรง', 'ขอให้สอบติดคณะที่ฝันไว้', 'ขอให้ปีหน้าใจดีกับเรามากกว่าปีนี้', 'ขอให้พ่อกับแม่อายุยืน',
    'ขอให้งานใหม่ราบรื่น เจอแต่คนน่ารัก', 'ขอให้ได้เจอคนที่ใช่สักที', 'ขอให้ทุกข์โศกลอยไปกับสายน้ำ', 'ขอขมาพระแม่คงคา ขอบคุณสายน้ำ',
    'ขอให้หายป่วยไวๆ นะ', 'ขอให้ร้านขายดี ลูกค้าเต็มร้าน', 'ขอให้น้องหมาน้องแมวที่บ้านแข็งแรง', 'ขอให้มีเงินเก็บสักก้อน',
    'ขอให้เราสองคนรักกันแบบนี้ตลอดไป', 'ขอให้ได้กลับบ้านไปหาแม่บ่อยๆ', 'ขอให้โลกใจดีกับทุกคน', 'ขอให้หนี้หมดไวๆ',
    'ขอให้เพื่อนๆ สมหวังทุกคน', 'ขอให้ฝันที่ตั้งใจไว้เป็นจริง', 'ขอให้ลูกเรียนเก่งและมีความสุข', 'ขอให้ผ่านโปรฯ',
    'ขอให้มีแรงทำตามความฝันต่อไป', 'ขอให้ปลอดภัยทุกการเดินทาง', 'ขอให้ใจเย็นลงอีกนิด', 'ขอให้ยายกลับมาเดินได้อีกครั้ง',
    'ขอให้ถูกรางวัลสักงวด', 'ขอให้นอนหลับสบายทุกคืน', 'ขอให้ได้ไปเที่ยวต่างประเทศกับครอบครัว', 'ขอให้ความเศร้าค่อยๆ จางลง',
    'ขอให้ทีมเราได้แชมป์', 'ขอให้มีความกล้าที่จะเริ่มต้นใหม่', 'ขอให้คนที่จากไปหลับให้สบาย', 'ขอให้ได้ทำงานที่รัก',
    'ขอให้บ้านเมืองสงบสุข', 'ขอให้ข้าวในนาออกรวงงาม', 'ขอให้น้ำไม่ท่วมบ้านปีหน้า', 'ขอให้เรียนจบตามแผน',
    'ขอให้คุณยายยิ้มได้ทุกวัน', 'ขอให้ได้งานใกล้บ้าน', 'ขอให้หัวใจแข็งแรงขึ้น', 'ขอให้คนที่เรารักปลอดภัย',
    'ขอให้น้องคลอดง่าย ลูกแข็งแรง', 'ขอให้ธุรกิจเล็กๆ ของเราเติบโต', 'ขอให้เลิกเหล้าได้สำเร็จ', 'ขอให้มีเวลาให้ตัวเองมากขึ้น',
    // ยาวปานกลาง และยาวใกล้ขีดจำกัด 120 ตัวอักษร (คนจริงพิมพ์ยาวบ้างสั้นบ้าง)
    'ขอให้ทุกคนในครอบครัวปลอดภัยจากโรคภัย และมีเวลาได้กินข้าวพร้อมหน้ากันบ่อยๆ', 'ขอให้ทีมฟุตบอลโรงเรียนได้แชมป์จังหวัด และขอให้ขาไม่เจ็บอีก', 'ขอให้ปีนี้ได้เริ่มเก็บเงินดาวน์บ้านหลังแรก แม้จะเล็กแต่เป็นของเราเอง', 'ขอให้คนที่กำลังเหนื่อยอยู่ตอนนี้ ได้พักผ่อนและมีใครสักคนคอยกอด',
    'ขอให้พ่อกับแม่สุขภาพแข็งแรง อยู่กับเราไปนานๆ ปีหน้าจะพาไปเที่ยวทะเลให้ได้ และขอให้งานที่ทำอยู่มั่นคงพอจะดูแลทุกคนในบ้าน',
    'ขอให้สอบติดคณะที่ฝันไว้ตั้งแต่ ม.4 ขอให้ความพยายามทั้งหมดไม่สูญเปล่า และขอให้เพื่อนทุกคนในห้องสมหวังไปพร้อมกัน',
    'ขอบคุณพระแม่คงคาที่ให้น้ำกับเรามาทั้งปี ขออภัยที่เคยทิ้งขยะลงน้ำ ปีหน้าจะพกถุงผ้าและแยกขยะให้ดีกว่านี้',
    'ขอให้คุณยายหายป่วยไวๆ ได้กลับมานั่งเล่าเรื่องเก่าๆ ที่ระเบียงบ้านอีกครั้ง หลานคิดถึงเสียงหัวเราะของยายมาก',
    'ขอให้ร้านกาแฟเล็กๆ ของเราผ่านปีแรกไปได้ ลูกค้าประจำกลับมาบ่อยๆ และขอให้มีแรงตื่นตีห้าทุกวันไปอีกนานๆ',
    'ขอให้ความเศร้าลอยไปกับสายน้ำ ปีนี้เสียคนสำคัญไปหลายคน ขอให้ทุกคนหลับให้สบาย และขอให้เราเข้มแข็งพอจะยิ้มได้อีกครั้ง',
    'ขอให้เราสองคนผ่านเรื่องยากๆ ไปด้วยกันได้เหมือนทุกปีที่ผ่านมา ปีหน้าขอได้ลอยกระทงด้วยกันที่บ้านเกิดของเธอบ้าง',
    'ขอให้ลูกโตมาเป็นคนใจดี ไม่ต้องเก่งที่สุดก็ได้ ขอแค่มีความสุข รู้จักแบ่งปัน และกลับมากินข้าวกับแม่บ่อยๆ ก็พอ',
    'ขอให้ได้งานใหม่ที่ไม่ต้องทำโอทีทุกคืน มีเวลาออกกำลังกาย อ่านหนังสือ และโทรหาครอบครัวที่ต่างจังหวัดทุกสัปดาห์',
    'ขอให้ข้าวในนาปีหน้าออกรวงงาม ฝนตกต้องตามฤดูกาล น้ำไม่ท่วมไม่แล้ง และขอให้ราคาข้าวดีพอให้ทุกบ้านในหมู่บ้านอยู่ได้',
    'ขอให้หมาแมวจรแถวบ้านทุกตัวได้เจอบ้านที่อบอุ่น มีข้าวกิน มีที่นอนกันฝน และขอให้คนในซอยใจดีกับพวกมันมากขึ้น',
    'ขอให้ปีหน้าใจเย็นลงกว่าปีนี้ ฟังคนอื่นให้มากขึ้น พูดให้น้อยลง และให้อภัยตัวเองบ้างเวลาที่ทำอะไรไม่ได้ดั่งใจ',
  ];

  // ---------------------------------------------------------------------------------------------- ตัวช่วย
  const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const LS_PENDING = 'lk.pending', LS_MINE = 'lk.mine';
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode: not kept */ } };

  let real = [];          // จากผู้เล่นจริง ใหม่สุดอยู่ท้าย
  const seen = new Set();
  let deck = [], fresh = [];
  const own = new Set();      // ข้อความที่ผู้เล่นคนนี้ส่งเอง (ไม่ต้องขึ้นซ้ำบนกระทงใบอื่นเมื่อดึงกลับมา)
  const W = { source: 'offline', MAX, clean, get count() { return real.length; }, get real() { return real.slice(); } };

  function take(list) {
    let n = 0;
    for (const w of list) {
      const text = clean(w.text); if (!text || seen.has(w.id)) continue;
      seen.add(w.id); real.push({ id: w.id, text, place: clean(w.place).slice(0, 20), kind: w.kind === 'lantern' ? 'lantern' : 'krathong', t: +w.t || 0 }); n++;
    }
    return n;
  }
  // ไพ่หนึ่งสำรับ: คำอธิษฐานจริงทั้งหมด (สลับลำดับ) ถ้ายังมีน้อย แทรกคำอธิษฐานตัวอย่างไว้ด้วย จะได้ไม่เห็นข้อความเดิมซ้ำๆ ติดกัน
  function refill() {
    const r = shuffle(real.map((w) => ({ text: w.text, real: true })));
    const s = r.length >= 40 ? [] : shuffle(SAMPLE.map((text) => ({ text, real: false }))).slice(0, Math.max(12, 40 - r.length));
    deck = [];
    while (r.length || s.length) { if (r.length) deck.push(r.pop()); if (s.length && (!r.length || Math.random() < 0.5)) deck.push(s.pop()); }
  }
  W.pick = () => { if (fresh.length) return fresh.shift(); if (!deck.length) refill(); return deck.pop(); };

  W.load = async ({ timeout = 4000 } = {}) => {
    // ของผู้เล่นเองที่ส่งไม่สำเร็จครั้งก่อน ลองส่งอีกครั้ง (ไม่รอ)
    if (BACKEND) {
      const pend = lsGet(LS_PENDING);
      if (pend.length) { lsSet(LS_PENDING, []); for (const w of pend) BACKEND.add(w).catch(() => { const p = lsGet(LS_PENDING); p.push(w); lsSet(LS_PENDING, p); }); }
    }
    if (!BACKEND) { W.source = 'offline'; refill(); return W; }
    try { take(await withTimeout(BACKEND.list(CFG.limit || 200), timeout)); W.source = 'firebase'; }
    catch (e) { W.source = 'offline'; console.warn('[wishes] ดึงคำอธิษฐานไม่สำเร็จ ใช้ข้อความตัวอย่างแทน:', e.message); }
    refill();
    return W;
  };

  W.send = async (w) => {
    const item = { text: clean(w.text), place: clean(w.place).slice(0, 20), kind: w.kind === 'lantern' ? 'lantern' : 'krathong' };
    if (!item.text) return false;
    own.add(item.text);
    const mine = lsGet(LS_MINE); mine.push(Object.assign({ t: Date.now() }, item)); lsSet(LS_MINE, mine.slice(-50));
    if (!BACKEND) return false;
    try { await withTimeout(BACKEND.add(item), 8000); return true; }
    catch (e) { const p = lsGet(LS_PENDING); p.push(item); lsSet(LS_PENDING, p.slice(-20)); console.warn('[wishes] ส่งไม่สำเร็จ จะลองใหม่ครั้งหน้า:', e.message); return false; }
  };

  // ข้อความใหม่จากคนอื่น: ขึ้นบนกระทงหรือโคมใบถัดไปที่ปรากฏก่อนข้อความอื่น
  W.poll = (ms, onNew) => {
    if (!BACKEND) return () => {};
    const id = setInterval(async () => {
      try {
        const before = real.length, n = take(await withTimeout(BACKEND.list(50), 6000)); W.source = 'firebase';
        if (n) { const added = real.slice(before); for (const w of added) if (!own.has(w.text)) fresh.push({ text: w.text, real: true }); if (onNew) onNew(added); }
      } catch (_) { /* ลองใหม่รอบหน้า */ }
    }, ms);
    return () => clearInterval(id);
  };
  W.sample = () => SAMPLE[Math.floor(Math.random() * SAMPLE.length)];

  // ---------------------------------------------------------------------------------------------- how many have been floated and let go
  // With a backend: its own counters (stats/krathong, stats/lantern), each raised by one on the server every time someone floats a krathong or
  // lets a lantern go. Without one, or when it cannot be reached: a number worked out from the time - as if people all over the country floated
  // about SIM_RATE a minute since SIM_T0 - so that it grows while one watches, has grown by as much as the time away when one comes back, and is
  // much the same on every device; the player's own are added to it. Either way a device never shows a smaller number than it has shown before
  // (kept in the browser for each source), even if its clock is set back.
  // (it starts in the hundreds: SIM_BASE on SIM_T0, then about 1.5 krathongs and half a lantern a minute - a few hundred more in an evening)
  const SIM_T0 = Date.UTC(2026, 10, 22, 12), SIM_BASE = { krathong: 860, lantern: 240 }, SIM_RATE = { krathong: 1.5, lantern: 0.5 };
  const LS_TOP = 'lk.countTop2', LS_FLOATED = 'lk.floated';      // (2: the highest shown under the first, far larger, simulation is let go)
  const lsObj = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { return {}; } };
  const lsPut = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* not kept */ } };
  const KINDS = ['krathong', 'lantern'];
  let cnt = null, cntSrc = 'offline', server = null;
  const watchers = new Set();
  const simAt = (t) => { const m = Math.max(0, (t - SIM_T0) / 60000), mine = lsObj(LS_FLOATED), o = {}; for (const k of KINDS) o[k] = Math.floor(SIM_BASE[k] + SIM_RATE[k] * m) + (mine[k] || 0); return o; };
  // never less than this device has shown from the same source
  function settle(o, src) {
    const top = lsObj(LS_TOP), t = top[src] || {}, out = {};
    for (const k of KINDS) out[k] = Math.max(o[k] || 0, t[k] || 0);
    top[src] = out; lsPut(LS_TOP, top);
    const changed = !cnt || cntSrc !== src || KINDS.some((k) => out[k] !== cnt[k]); cnt = out; cntSrc = src;
    if (changed) for (const cb of watchers) cb(cnt);
    return cnt;
  }
  const STATS = base ? {
    async get() { const r = await fetch(`${base}/stats.json`, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const d = (await r.json()) || {}; return { krathong: +d.krathong || 0, lantern: +d.lantern || 0 }; },
    async add(kind) { const r = await fetch(`${base}/stats.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [kind]: { '.sv': { increment: 1 } } }) }); if (!r.ok) throw new Error('HTTP ' + r.status); },
  } : null;
  async function refresh() {
    if (STATS) { try { server = await withTimeout(STATS.get(), 5000); return settle(server, 'firebase'); } catch (_) { server = null; } }
    return settle(simAt(Date.now()), 'sim');
  }
  W.counts = () => cnt || settle(simAt(Date.now()), 'sim');
  W.bump = (kind) => {
    kind = kind === 'lantern' ? 'lantern' : 'krathong';
    const mine = lsObj(LS_FLOATED); mine[kind] = (mine[kind] || 0) + 1; lsPut(LS_FLOATED, mine);
    if (STATS && server) { server[kind]++; settle(server, 'firebase'); STATS.add(kind).catch(() => {}); }
    else settle(simAt(Date.now()), 'sim');
  };
  W.watchCounts = (cb) => {
    watchers.add(cb); if (cnt) cb(cnt);
    if (!W.watchCounts.on) { W.watchCounts.on = true; refresh(); setInterval(() => { if (!document.hidden) refresh(); }, STATS ? 30000 : 4000); addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); }
    return () => watchers.delete(cb);
  };
  return W;
})();
