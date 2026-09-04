import { handleSystemCommands } from "./text/system.handler";
import { handleGeneralCommands } from "./text/command.handler";
import { handleExpenseCreation } from "./text/expense.handler";

export async function handleTextMessage(event: any) {
  const userId = event.source.userId;
  if (!userId) return;

  const userText = event.message.text.trim();

  // 1. ตรวจสอบคำสั่งระบบ (ลบ, บันทึกซ้ำ, ยกเลิก)
  const isHandledBySystem = await handleSystemCommands(event, userText, userId);
  if (isHandledBySystem) return;

  // 2. ตรวจสอบคำสั่งทั่วไป (สรุป, ดูรายรับ/จ่าย, ค้นหา, ช่วยเหลือ)
  const isHandledByCommand = await handleGeneralCommands(
    event,
    userText,
    userId,
  );
  if (isHandledByCommand) return;

  // 3. กระบวนการบันทึกข้อมูล (AI / ข้อความเดี่ยว / หลายรายการ / เช็คซ้ำ)
  await handleExpenseCreation(event, userText, userId);
}
