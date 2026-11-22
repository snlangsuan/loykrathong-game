// หน้า loading: แถบความคืบหน้า ข้อความว่ากำลังทำอะไร และเกร็ดความรู้ระหว่างรอ
// const LD = Loader('loading');  await LD.step('สร้างพื้นดิน', 40);  LD.done();  LD.error('ข้อความ')
// step() รอให้เบราว์เซอร์วาดหน้าจอก่อนทำงานถัดไป แถบจึงขยับจริงแม้งานถัดไปจะหนักและทำรวดเดียว
window.Loader = (id) => {
  const root = document.getElementById(id);
  const bar = root.querySelector('.ld-bar i'), txt = root.querySelector('.ld-step'), pc = root.querySelector('.ld-pct'), tip = root.querySelector('.ld-tip'), err = root.querySelector('.ld-err');
  const TIPS = [
    'ลอยกระทงตรงกับคืน <b>วันเพ็ญเดือนสิบสอง</b> น้ำขึ้นเต็มตลิ่ง พระจันทร์เต็มดวง',
    'คนไทยลอยกระทงเพื่อ <b>ขอขมาพระแม่คงคา</b> และขอบคุณสายน้ำที่ใช้ตลอดปี',
    'กระทงขนมปังลอยแล้วปลากินได้ ส่วนกระทงใบตองย่อยสลายได้เอง ช่วยให้แม่น้ำสะอาด',
    'โคมลอยต้องปล่อยในที่โล่ง ห่างสนามบิน และปล่อยตามเวลาที่กำหนดเท่านั้น',
    'ก่อนลอยให้ <b>จุดธูปเทียน</b> ตั้งจิตอธิษฐาน แล้วค่อยวางกระทงลงบนน้ำ',
    'คำอธิษฐานของคุณจะลอยไปพร้อมกระทงหรือโคม ให้ผู้เล่นคนอื่นเห็นด้วย',
  ];
  let ti = Math.floor(Math.random() * TIPS.length);
  const showTip = () => { if (tip) { tip.innerHTML = TIPS[ti % TIPS.length]; ti++; } };
  showTip(); const tipT = setInterval(showTip, 5200);
  const paint = () => new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
  let cur = 0;
  return {
    root,
    setTip(html) { TIPS.unshift(html); ti = 0; showTip(); },
    async step(text, pct) {
      cur = Math.max(cur, pct); if (txt) txt.textContent = text; if (bar) bar.style.width = cur + '%'; if (pc) pc.textContent = Math.round(cur) + '%';
      await paint();
    },
    done() { if (bar) bar.style.width = '100%'; if (pc) pc.textContent = '100%'; clearInterval(tipT); setTimeout(() => root.classList.add('off'), 250); },
    error(html) { clearInterval(tipT); if (err) { err.innerHTML = html; err.classList.add('on'); } if (txt) txt.textContent = 'เกิดปัญหา'; },
  };
};
