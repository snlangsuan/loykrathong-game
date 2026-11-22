// เซิร์ฟเวอร์สำหรับเล่นบนเครื่อง: bun run serve แล้วเปิด http://localhost:8080 (หน้าแผนที่)
// bun run dev: hot reload แก้ CSS แล้วสลับให้ทันทีไม่ต้องโหลดหน้าใหม่ · แก้ JS/HTML แล้วหน้าโหลดใหม่เอง โดยหน้าเก็บสถานะไว้ก่อนด้วย liveKeep() (ถ้ามี)
// เสิร์ฟทุกไฟล์ในโฟลเดอร์โปรเจกต์แบบไฟล์นิ่ง (เกมไม่มีขั้นตอน build) ต้องเปิดผ่านเซิร์ฟเวอร์ เปิดไฟล์ตรงๆ แบบ file:// ไม่ได้
import { normalize } from 'node:path';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', mp3: 'audio/mpeg', svg: 'image/svg+xml', png: 'image/png' };
const port = Number(process.env.PORT) || 8080;
const live = process.argv.includes('--dev'), enc = new TextEncoder(), open = new Set();
const LISTEN = `<script>(() => { let id = null;
  const go = () => { try { if (typeof window.liveKeep === 'function') window.liveKeep(); } catch (e) {} location.reload(); };
  new EventSource('/__live').onmessage = (e) => { const [k, v] = e.data.split(' ');
    if (k === 'hello') { if (id && id !== v) go(); id = v; }
    else if (k === 'css') { for (const l of document.querySelectorAll('link[rel=stylesheet]')) { const u = new URL(l.href); if (u.origin === location.origin) { u.searchParams.set('t', Date.now()); l.href = u; } } }
    else go(); };
})();</script>`;
const id = Date.now().toString(36);      // (a server started again says so: pages still open from the one before load themselves again)
if (live) {
  let wait = 0, all = false;      // (an editor saves in several steps, and several files may be saved together: one message for the lot)
  const tell = (m) => { for (const c of open) { try { c.enqueue(enc.encode(`data: ${m}\n\n`)); } catch (_) { open.delete(c); } } };
  watch(fileURLToPath(root), { recursive: true }, (ev, f) => {
    if (!f || !/\.(html|js|css)$/.test(f) || /(^|[/\\])(\.|node_modules)/.test(f) || f.startsWith('scripts')) return;
    if (!f.endsWith('.css')) all = true;
    clearTimeout(wait); wait = setTimeout(() => { tell(all ? 'reload' : 'css'); console.log(`${new Date().toLocaleTimeString()}  ${f}  ->  ${all ? 'reload' : 'css (ไม่โหลดหน้าใหม่)'}  (${open.size})`); all = false; }, 200);
  });
  setInterval(() => tell('hello ' + id), 20000);      // (also keeps the connection from being dropped as idle)
}
Bun.serve({ port, idleTimeout: 0, fetch: async (req) => {
  let path = decodeURIComponent(new URL(req.url).pathname);
  if (live && path === '/__live') { let c; return new Response(new ReadableStream({ start(k) { c = k; open.add(c); c.enqueue(enc.encode(`retry: 700\ndata: hello ${id}\n\n`)); }, cancel() { open.delete(c); } }), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } }); }
  if (path.endsWith('/')) path += 'index.html';
  const name = normalize(path).replace(/^[/\\]+/, '');
  if (name.startsWith('..') || !/^[\w./-]+$/.test(name) || /(^|\/)\./.test(name) || name.startsWith('scripts/')) return new Response('not found', { status: 404 });
  const file = Bun.file(new URL(name, root));
  if (!(await file.exists())) return new Response('not found', { status: 404 });
  const headers = { 'content-type': types[name.split('.').pop()] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (live && name.endsWith('.html')) { const t = await file.text(), i = t.lastIndexOf('</body>'); return new Response(i < 0 ? t + LISTEN : t.slice(0, i) + LISTEN + t.slice(i), { headers }); }
  return new Response(file, { headers });
} });
console.log(`${live ? 'live reload on\n' : ''}ลอยกระทงทั่วไทย: http://localhost:${port}`);
