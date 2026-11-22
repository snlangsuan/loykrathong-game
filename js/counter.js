// ตัวนับกระทงและโคมที่ลอยไปแล้ว (จาก Wishes.watchCounts): เลขค่อยๆ วิ่งขึ้นไปหาค่าใหม่ ไม่กระโดด
// Counter(el, { lantern })  lantern: false = แสดงแค่กระทง (สถานที่ที่ไม่มีโคมลอย)
window.Counter = (el, { lantern = true } = {}) => {
  const fmt = (n) => Math.round(n).toLocaleString('th-TH');
  el.innerHTML = '<span class="ck">🪷 กระทง <b>0</b></span>' + (lantern ? '<span class="cl">🏮 โคม <b>0</b></span>' : '');
  const bk = el.querySelector('.ck b'), bl = el.querySelector('.cl b');
  const shown = { krathong: 0, lantern: 0 }, from = { krathong: 0, lantern: 0 }, to = { krathong: 0, lantern: 0 };
  let t0 = 0, raf = 0, first = true;
  const draw = (now) => {
    const a = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - a, 3);
    for (const k of ['krathong', 'lantern']) shown[k] = from[k] + (to[k] - from[k]) * e;
    bk.textContent = fmt(shown.krathong); if (bl) bl.textContent = fmt(shown.lantern);
    raf = a < 1 ? requestAnimationFrame(draw) : 0;
  };
  Wishes.watchCounts((c) => {
    for (const k of ['krathong', 'lantern']) { from[k] = first ? Math.max(0, c[k] - 40) : shown[k]; to[k] = c[k]; }      // (the first time, a short roll up to it)
    first = false; t0 = performance.now(); el.hidden = false; if (!raf) raf = requestAnimationFrame(draw);
  });
};
