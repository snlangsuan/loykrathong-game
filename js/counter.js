// ตัวนับกระทงและโคมที่ลอยไปแล้ว (จาก Wishes.watchCounts): เลขค่อยๆ วิ่งขึ้นไปหาค่าใหม่ ไม่กระโดด
// Counter(el, { lantern })  lantern: false = แสดงแค่กระทง (สถานที่ที่ไม่มีโคมลอย)
window.Counter = (el, { lantern = true } = {}) => {
  const fmt = (n) => Math.round(n).toLocaleString('th-TH');
  const IK = '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path class="fl" d="M12 2.4c1.1 1.3 1.1 2.3 0 3-1.1-.7-1.1-1.7 0-3z"/><path d="M6 14.5 8 9.5l2.2 5M9.8 14.5 12 8l2.2 6.5M13.8 14.5 16 9.5l2 5"/><path class="bd" d="M3 14.5h18c-.9 2.7-3.3 4.2-9 4.2s-8.1-1.5-9-4.2z"/></svg>', IL = '<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path class="bd" d="M7 4.5h10l-1.6 12.5H8.6z"/><path d="M8.6 17h6.8M8 9h8"/><path class="fl" d="M12 18.2c.9 1 .9 1.9 0 2.6-.9-.7-.9-1.6 0-2.6z"/></svg>';      // (icons drawn as SVG: a krathong, a sky lantern)
  el.innerHTML = '<span class="ck">' + IK + 'กระทง <b>0</b></span>' + (lantern ? '<span class="cl">' + IL + 'โคม <b>0</b></span>' : '');
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
