# LINE Bot Expense Tracker Backend

ระบบ Backend สำหรับ LINE Chatbot บันทึกรายรับ-รายจ่าย พัฒนาด้วย Node.js, Express, TypeScript, MongoDB และผสานการทำงานกับ Google Gemini AI สำหรับช่วยวิเคราะห์ข้อความและสกัดข้อมูลทางการเงินอัตโนมัติ

---

## 🚀 ฟีเจอร์หลัก (Features)

- **🤖 AI-Powered Parsing**: รองรับการวิเคราะห์ข้อความธรรมชาติ (Natural Language) และรูปภาพ/บิลด้วย Google Gemini API (`gemini-2.5-flash`) เพื่อสกัดหมวดหมู่ จำนวนเงิน และประเภทรายการ
- **⚡ Quick Text Parsing**: ระบบตรวจจับข้อความรูปแบบง่ายด้วย RegEx (เช่น "ข้าว 60", "ขายของ 300") เพื่อความรวดเร็วและประหยัด Token
- **📊 Data Summary & Filtering**: คำนวณยอดรวมรายรับ รายจ่าย และยอดสุทธิ พร้อมคำสั่งดูประวัติย้อนหลัง ค้นหาตามคำค้น (`หา ...`) และกรองเฉพาะรายรับ/รายจ่าย
- **🗑️ Entry Management**: คำสั่งลบรายการล่าสุดพร้อมระบบคืนสิทธิ์โควตาการใช้งานอัตโนมัติ
- **👋 Welcome Message**: ระบบต้อนรับอัตโนมัติพร้อมคู่มือการใช้งานเมื่อมีผู้ใช้กดเพิ่มเพื่อน (Follow Event)
- **🔒 User Quota System**: ระบบจำกัดโควตาการใช้งานฟรี (Free Tier) และรองรับสถานะสมาชิกพรีเมียม

---

## 🛠 Tech Stack

- **Language**: TypeScript, Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Mongoose)
- **APIs**: LINE Messaging API (`@line/bot-sdk`), Google Gen AI SDK (`@google/genai`)

---

## 📁 Project Structure

```text
src/
├── config/         # ไฟล์ตั้งค่า (เช่น การเชื่อมต่อ LINE Config)
├── controller/     # ควบคุมตรรกะ Webhook และการรับ-ส่งข้อความ LINE
├── models/         # Mongoose Schemas (User, Expense)
├── services/       # Business Logic, Gemini AI, และ Database Queries
└── index.ts        # จุดเริ่มต้นของแอปพลิเคชัน (Express Server)
```
