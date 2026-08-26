# Server Nest

Desktop app สำหรับจัดการ local server ของ Node.js และ Python บน Windows

## ความสามารถในเวอร์ชันแรก

- เพิ่มโปรไฟล์คำสั่งพร้อม working directory, environment variables และ URL ตรวจสอบ
- Start, Stop, Restart, Delete และดู stdout/stderr ล่าสุด
- Process ถูกเปิดแบบไม่มีหน้าต่าง terminal (`CREATE_NO_WINDOW` บน Windows)
- กดปิดหน้าต่างเพื่อซ่อนแอปใน system tray โดย process ยังทำงาน
- เมนู `ออกและหยุด server` ใน tray จะหยุด process tree ทั้งหมดที่แอปเปิดเอง

## เริ่มพัฒนา

```powershell
npm install
npm run tauri dev
```

รายการ server ถูกเก็บไว้ที่โฟลเดอร์ app data ของ Windows ในไฟล์ `servers.json`.

## หมายเหตุ

คำสั่ง Stop ของ Windows ใช้ `taskkill /T /F` เพื่อหยุดทั้ง process tree เช่น `npm` และ child process ของมัน จึงเหมาะกับ local dev server. เวอร์ชันถัดไปสามารถเพิ่ม graceful shutdown เฉพาะ framework ได้.
