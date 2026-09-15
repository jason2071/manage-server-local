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

หากติดตั้ง GNU Make แล้ว สามารถใช้คำสั่งย่อได้:

```powershell
make help       # ดูคำสั่งทั้งหมด
make dev        # เปิดแอปพร้อม hot reload
make check      # ตรวจ TypeScript และ Rust
make installer  # สร้าง Windows installer
```

รายการ server ถูกเก็บไว้ที่โฟลเดอร์ app data ของ Windows ในไฟล์ `servers.json`.

## หมายเหตุ

คำสั่ง Stop ของ Windows ใช้ `taskkill /T /F` เพื่อหยุดทั้ง process tree เช่น `npm` และ child process ของมัน จึงเหมาะกับ local dev server. เวอร์ชันถัดไปสามารถเพิ่ม graceful shutdown เฉพาะ framework ได้.

## การอัปเดตแอป

แอปตรวจสอบ update จาก GitHub Releases และติดตั้งทับให้อัตโนมัติผ่านปุ่ม `ตรวจ update` โดยไม่ต้อง uninstall. การออก release ใหม่ให้เพิ่ม version ใน `package.json`, `src-tauri/Cargo.toml`, และ `src-tauri/tauri.conf.json` ให้ตรงกัน จากนั้น push tag เช่น `v0.1.2`.

ก่อนใช้ GitHub Actions ครั้งแรก ให้เพิ่มค่าใน repository secret ชื่อ `TAURI_SIGNING_PRIVATE_KEY` จากไฟล์ private key ที่เก็บนอก repository และ (ถ้ามี) `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
