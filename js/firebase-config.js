// ตั้งค่า Firebase Realtime Database สำหรับเก็บคำอธิษฐาน (ดูวิธีตั้งค่าใน README.md หัวข้อ "คำอธิษฐานและ Firebase")
//
// databaseURL: ที่อยู่ของฐานข้อมูล เช่น 'https://my-loykrathong-default-rtdb.asia-southeast1.firebasedatabase.app'
//              เว้นว่างไว้ = ไม่ต่อ Firebase เกมจะสุ่มคำอธิษฐานตัวอย่างมาแสดงแทน และคำอธิษฐานของผู้เล่นจะเก็บไว้ในเบราว์เซอร์เท่านั้น
// path:        ชื่อโหนดที่เก็บคำอธิษฐาน
// limit:       ดึงคำอธิษฐานล่าสุดกี่ข้อความ
window.FIREBASE_CONFIG = {
  databaseURL: '',
  path: 'wishes',
  limit: 200,
};
