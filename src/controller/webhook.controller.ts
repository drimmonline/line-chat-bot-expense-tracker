import { Request, Response } from "express";
import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../config/line.config";
import { User } from "../models/user.model";
import { Expense } from "../models/expense.model";
import { ExpenseService } from "../services/expense.service";

// เปลี่ยนมาใช้ MessagingApiClient จาก messagingApi
const client = new messagingApi.MessagingApiClient(lineConfig);
const expenseService = new ExpenseService();

export const handleLineWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const events: any[] = req.body.events;

    await Promise.all(
      events.map(async (event) => {
        if (event.type === "message" && event.message.type === "text") {
          const userId = event.source.userId;
          const userText = event.message.text.trim(); // ใช้ trim ตัดช่องว่างหัวท้าย

          if (!userId) return;

          // ==========================================
          // A. คำสั่งลบรายการล่าสุด (เช่น พิมพ์ "ลบ" หรือ "ลบรายการ")
          // ==========================================
          if (/^(ลบ|ลบรายการ|ลบรายการล่าสุด)/i.test(userText)) {
            const deleted = await expenseService.deleteLatestExpense(userId);

            if (!deleted) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: "📭 ไม่พบรายการให้ลบครับ คุณยังไม่มีประวัติการบันทึก",
                  },
                ],
              });
            }

            // คืนโควตาให้ User 1 สิทธิ์ (ถ้าไม่ใช่พรีเมียม)
            let dbUser = await User.findOne({ userId });
            if (dbUser && dbUser.quotaUsed > 0) {
              dbUser.quotaUsed -= 1;
              await dbUser.save();
            }

            const typeText =
              deleted.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: `🗑️ ลบรายการล่าสุดเรียบร้อยแล้ว!\n\n📌 ประเภท: ${typeText}\n📝 รายการ: ${deleted.description}\n💰 จำนวน: ${deleted.amount} บาท`,
                },
              ],
            });
          }

          // ==========================================
          // B. คำสั่งดูเฉพาะรายรับ (เช่น พิมพ์ "ดูรายรับ" หรือ "รายรับ")
          // ==========================================
          if (/^ดูรายรับ|รายรับ$/i.test(userText)) {
            const incomes = await expenseService.getFilteredExpenses(
              userId,
              { type: "income" },
              5,
            );
            if (incomes.length === 0) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  { type: "text", text: "📭 ยังไม่มีประวัติรายการรายรับครับ" },
                ],
              });
            }

            let text = "🟢 5 รายรับล่าสุดของคุณ:\n------------------------\n";
            incomes.forEach((item, i) => {
              const itemDate = new Date(item.createdAt || Date.now());
              const dateStr = itemDate.toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
              });
              text += `${i + 1}. 🟢 (${dateStr}) ${item.description}: +${item.amount} บาท\n`;
            });
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text }],
            });
          }

          // ==========================================
          // C. คำสั่งดูเฉพาะรายจ่าย (เช่น พิมพ์ "ดูรายจ่าย" หรือ "รายจ่าย")
          // ==========================================
          if (/^ดูรายจ่าย|รายจ่าย$/i.test(userText)) {
            const expenses = await expenseService.getFilteredExpenses(
              userId,
              { type: "expense" },
              5,
            );
            if (expenses.length === 0) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  { type: "text", text: "📭 ยังไม่มีประวัติรายการรายจ่ายครับ" },
                ],
              });
            }

            let text = "🔴 5 รายจ่ายล่าสุดของคุณ:\n------------------------\n";
            expenses.forEach((item, i) => {
              const itemDate = new Date(item.createdAt || Date.now());
              const dateStr = itemDate.toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
              });
              text += `${i + 1}. 🔴 (${dateStr}) ${item.description}: -${item.amount} บาท\n`;
            });
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text }],
            });
          }

          // ==========================================
          // 1. ตรวจสอบคำสั่งขอดูรายการสรุป (เช่น "สรุป", "รายการ", "ดูรายการ")
          // ==========================================
          if (/^(สรุป|รายการ|ดูรายการ|ประวัติ)/i.test(userText)) {
            const recentExpenses = await expenseService.getRecentExpenses(
              userId,
              5,
            );

            if (recentExpenses.length === 0) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: '📭 ยังไม่มีประวัติการบันทึกรายการเลยครับ ลองพิมพ์บันทึกดูก่อนได้เลย เช่น "ข้าว 60" หรือ "ขายของ 300"',
                  },
                ],
              });
            }

            // คำนวณยอดรวมรายรับ และรายจ่าย จากรายการที่ดึงมาแสดง
            let totalIncome = 0;
            let totalExpense = 0;

            recentExpenses.forEach((item) => {
              if (item.type === "income") {
                totalIncome += item.amount;
              } else {
                totalExpense += item.amount;
              }
            });

            const netBalance = totalIncome - totalExpense;

            // 📅 ดึงช่วงวันที่จากรายการ (เนื่องจาก sort จากใหม่ไปเก่า)
            const newestDate = new Date(
              recentExpenses[0].createdAt || Date.now(),
            );
            const oldestDate = new Date(
              recentExpenses[recentExpenses.length - 1].createdAt || Date.now(),
            );

            const formatDate = (date: Date) => {
              return date.toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });
            };

            const dateRangeText =
              recentExpenses.length === 1
                ? `📅 วันที่: ${formatDate(newestDate)}`
                : `📅 ช่วงวันที่: ${formatDate(oldestDate)} ถึง ${formatDate(newestDate)}`;

            // จัดรูปแบบข้อความแสดงรายการย้อนหลัง
            let replyText = `📊 รายการล่าสุดของคุณ (${recentExpenses.length} รายการ)\n${dateRangeText}\n------------------------\n`;

            recentExpenses.forEach((item, index) => {
              const typeSymbol =
                item.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
              const itemDate = new Date(item.createdAt || Date.now());
              const timeStr = itemDate.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              });

              replyText += `${index + 1}. ${typeSymbol} (${timeStr})\n`;
              replyText += `   📌 ${item.description}: ${item.amount} บาท\n`;
              replyText += `   📂 หมวดหมู่: ${item.category}\n`;
              replyText += `------------------------\n`;
            });

            // เพิ่มส่วนสรุปยอดรวมและยอดสุทธิ
            replyText += `📈 สรุปยอดรวม:\n`;
            replyText += `🟢 รวมรายรับ: ${totalIncome.toLocaleString()} บาท\n`;
            replyText += `🔴 รวมรายจ่าย: ${totalExpense.toLocaleString()} บาท\n`;
            replyText += `💰 สุทธิ: ${netBalance >= 0 ? "+" : ""}${netBalance.toLocaleString()} บาท`;

            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text: replyText }],
            });
          }

          // ==========================================
          // 2. ตรวจสอบคำสั่งค้นหารายการเฉพาะเจาะจง (เช่น "หา กระเพรา", "ค้นหา กาแฟ")
          // ==========================================
          const searchMatch = userText.match(/^(หา|ค้นหา)\s+(.+)$/i);
          if (searchMatch) {
            const keyword = searchMatch[2].trim();
            const foundExpenses = await expenseService.searchExpenses(
              userId,
              keyword,
              5,
            );

            if (foundExpenses.length === 0) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: `🔍 ไม่พบรายการที่ตรงกับ "${keyword}" ครับ`,
                  },
                ],
              });
            }

            let searchReply = `🔍 ผลการค้นหา "${keyword}" (${foundExpenses.length} รายการ):\n------------------------\n`;
            foundExpenses.forEach((item, index) => {
              const typeSymbol =
                item.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
              const itemDate = new Date(item.createdAt || Date.now());
              const dateStr = itemDate.toLocaleDateString("th-TH", {
                day: "numeric",
                month: "short",
              });
              const timeStr = itemDate.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              });

              searchReply += `${index + 1}. ${typeSymbol} (${dateStr} ${timeStr})\n`;
              searchReply += `   📌 ${item.description}: ${item.amount} บาท\n`;
              searchReply += `   📂 หมวดหมู่: ${item.category}\n`;
              searchReply += `------------------------\n`;
            });

            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text: searchReply }],
            });
          }

          // ==========================================
          // 3. กระบวนการปกติ: ตรวจสอบโควตาและบันทึกข้อมูล
          // ==========================================
          let dbUser = await User.findOne({ userId });
          if (!dbUser) {
            dbUser = await User.create({
              userId,
              isPremium: false,
              quotaUsed: 0,
            });
          }

          const FREE_LIMIT = 30;
          if (!dbUser.isPremium && dbUser.quotaUsed >= FREE_LIMIT) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "⚠️ คุณใช้โควตาฟรีครบกำหนดแล้ว กรุณาอัปเกรดเป็นแพ็กเกจพรีเมียมเพื่อใช้งานต่อครับ",
                },
              ],
            });
          }

          // แยกวิเคราะห์ข้อความด้วย RegEx หรือ AI
          let expenseData = expenseService.parseQuickText(userText);
          if (!expenseData) {
            expenseData = await expenseService.parseWithAI(userText);
          }

          await Expense.create({
            userId,
            topic: "บันทึกรายรับรายจ่าย",
            description: expenseData.description,
            amount: expenseData.amount,
            category: expenseData.category,
            type: expenseData.type,
          });

          dbUser.quotaUsed += 1;
          await dbUser.save();

          const typeText =
            expenseData.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";

          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: `✅ บันทึกสำเร็จ!\n\n📌 ประเภท: ${typeText}\n📝 รายการ: ${expenseData.description}\n💰 จำนวน: ${expenseData.amount} บาท\n📂 หมวดหมู่: ${expenseData.category}\n\n(ใช้งานไปแล้ว ${dbUser.quotaUsed}/${dbUser.isPremium ? "∞" : FREE_LIMIT} รายการ)`,
              },
            ],
          });
        }
      }),
    );

    res.status(200).json({ status: "success" });
  } catch (err: any) {
    console.error("Webhook Error:", err);
    res.status(500).json({ error: err.message });
  }
};
