import { Request, Response } from "express";
import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../config/line.config";
import { User } from "../models/user.model";
import { Expense } from "../models/expense.model";
import { ExpenseService } from "../services/expense.service";
import axios from "axios";

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
        // ==========================================
        // 0.1. กรณีผู้ใช้กดเพิ่มเพื่อนครั้งแรก (Follow Event)
        // ==========================================
        if (event.type === "follow") {
          const userId = event.source.userId;
          if (userId) {
            let dbUser = await User.findOne({ userId });
            if (!dbUser) {
              await User.create({
                userId,
                isPremium: false,
                quotaUsed: 0,
              });
            }
          }

          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "🤖 สวัสดีครับ! ขอบคุณที่เพิ่มเพื่อนกับ AI Expense Bot ผู้ช่วยบันทึกรายรับ-รายจ่ายอัจฉริยะ 📊\n\nคุณสามารถใช้งานได้ง่ายๆ ดังนี้:\n• พิมพ์บันทึกด่วน เช่น 'ข้าว 60' หรือ 'เงินเดือน 20000'\n• ถ่ายรูปบิลหรือสลิปเพื่อให้ AI ช่วยอ่านยอดเงินให้\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินและรายการย้อนหลัง\n\nทดลองพิมพ์รายการใช้จ่ายของคุณมาได้เลยครับ!",
                quickReply: {
                  items: [
                    {
                      type: "action",
                      action: {
                        type: "message",
                        label: "📊 ดูสรุปยอด",
                        text: "สรุป",
                      },
                    },
                    {
                      type: "action",
                      action: {
                        type: "message",
                        label: "❓ คุณทำอะไรได้บ้าง",
                        text: "คุณทำอะไรได้",
                      },
                    },
                  ],
                },
              },
            ],
          });
        }

        const userId = event.source.userId;
        if (!userId) return;

        // ==========================================
        // 1. กรณีผู้ใช้ส่งรูปภาพมา (ถ่ายบิล / สลิป)
        // ==========================================
        if (event.type === "message" && event.message.type === "image") {
          const messageId = event.message.id;

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

          try {
            const streamResponse = await axios.get(
              `https://api-data.line.me/v2/bot/message/${messageId}/content`,
              {
                headers: {
                  Authorization: `Bearer ${lineConfig.channelAccessToken}`,
                },
                responseType: "arraybuffer",
              },
            );

            const imageBase64 = Buffer.from(streamResponse.data).toString(
              "base64",
            );
            const expenseData = await expenseService.parseImageWithAI(
              imageBase64,
              "image/jpeg",
            );

            await Expense.create({
              userId,
              topic: "บันทึกจากรูปภาพ/บิล",
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
                  text: `📸 อ่านบิล/สลิปสำเร็จ!\n\n📌 ประเภท: ${typeText}\n📝 รายการ: ${expenseData.description}\n💰 จำนวน: ${expenseData.amount} บาท\n📂 หมวดหมู่: ${expenseData.category}\n\n(ใช้งานไปแล้ว ${dbUser.quotaUsed}/${dbUser.isPremium ? "∞" : FREE_LIMIT} รายการ)`,
                },
              ],
            });
          } catch (imgErr) {
            console.error("Image processing error:", imgErr);
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "❌ ไม่สามารถอ่านรูปภาพนี้ได้ ลองใหม่อีกครั้งหรือพิมพ์ข้อความแทนนะครับ",
                },
              ],
            });
          }
        }

        // ==========================================
        // 2. กรณีผู้ใช้ส่งข้อความตัวอักษรมาปกติ
        // ==========================================
        if (event.type === "message" && event.message.type === "text") {
          const userText = event.message.text.trim();

          // ==========================================
          // 0. ตรวจสอบคำถามวิธีใช้งาน หรือคำอธิบายความสามารถ
          // ==========================================
          if (
            /^(สวัสดี|หวัดดี|hi|hello|วิธีใช้|ใช้งานยังไง|help|คุณทำอะไรได้|สอนใช้หน่อย|ทำอะไรได้บ้าง)/i.test(
              userText,
            )
          ) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "🤖 สวัสดีครับ! ผมคือผู้ช่วย AI บันทึกรายรับ-รายจ่ายอัจฉริยะ\n\nสิ่งที่ผมช่วยคุณได้:\n• บันทึกรายรับ-รายจ่ายด่วน เช่น 'ข้าว 60' หรือ 'ขายของ 500'\n• ถ่ายรูปบิลหรือสลิปเพื่อให้ AI ช่วยอ่านยอดเงินและรายการให้ทันที\n• พิมพ์เล่าเรื่องราวการใช้เงินยาวๆ ให้ AI วิเคราะห์แยกหมวดหมู่ได้\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินและรายการย้อนหลัง\n• พิมพ์ 'ลบ' เพื่อยกเลิกรายการล่าสุด\n\nคุณสามารถทดลองพิมพ์ข้อความบันทึกรายการ หรือกดปุ่มเมนูด่วนด้านล่างนี้ได้เลยครับ 👇",
                  quickReply: {
                    items: [
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "📊 ดูสรุปยอด",
                          text: "สรุป",
                        },
                      },
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "🟢 ดูรายรับ",
                          text: "รายรับ",
                        },
                      },
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "🔴 ดูรายจ่าย",
                          text: "รายจ่าย",
                        },
                      },
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "🗑️ ลบรายการล่าสุด",
                          text: "ลบ",
                        },
                      },
                      {
                        type: "action",
                        action: {
                          type: "message",
                          label: "❓ คุณทำอะไรได้บ้าง",
                          text: "คุณทำอะไรได้",
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }

          // ==========================================
          // A. คำสั่งลบรายการล่าสุด
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
          // B. คำสั่งดูเฉพาะรายรับ
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
          // C. คำสั่งดูเฉพาะรายจ่าย
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
          // 1. ตรวจสอบคำสั่งขอดูรายการสรุป
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
          // 2. ตรวจสอบคำสั่งค้นหารายการเฉพาะเจาะจง
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
          // 3. ตรวจสอบว่ามีตัวเลขในข้อความหรือไม่ (ถ้าไม่มีหรือคุยเล่นนอกเรื่อง ให้ปฏิเสธ)
          // ==========================================
          const hasNumber = /\d+/.test(userText);
          if (!hasNumber) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "ขออภัยผมไม่สามารถช่วยเหลือเรื่องนั้นได้",
                },
              ],
            });
          }

          // ==========================================
          // 4. กระบวนการปกติ: ตรวจสอบโควตาและบันทึกข้อมูลจากข้อความ
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

          let expenseData = expenseService.parseQuickText(userText);
          if (!expenseData) {
            expenseData = await expenseService.parseWithAI(userText);
          }

          // ป้องกันกรณี AI ตีความข้อความไม่มีตัวเลขหลุดรอดมาได้
          if (!expenseData || !expenseData.amount || expenseData.amount === 0) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "ขออภัยผมไม่สามารถช่วยเหลือเรื่องนั้นได้",
                },
              ],
            });
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
