import { Request, Response } from "express";
import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../config/line.config";
import { User } from "../models/user.model";
import { Expense } from "../models/expense.model";
import { ExpenseService } from "../services/expense.service";
import axios from "axios"; // สำหรับโหลดไฟล์รูปภาพจาก LINE API

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

              // เรียกใช้ฟังก์ชันอ่านบิลหลายรายการ
              const receiptItems = await expenseService.parseReceiptImageWithAI(
                imageBase64,
                "image/jpeg",
              );

              if (!receiptItems || receiptItems.length === 0) {
                return client.replyMessage({
                  replyToken: event.replyToken,
                  messages: [
                    {
                      type: "text",
                      text: "❌ ไม่สามารถอ่านรายการสินค้าจากใบเสร็จนี้ได้ ลองใหม่อีกครั้งนะครับ",
                    },
                  ],
                });
              }

              let successCount = 0;
              let summaryReply =
                "📸 อ่านใบเสร็จสำเร็จ!\n------------------------\n";
              let grandTotal = 0;

              for (const item of receiptItems) {
                if (item.amount && item.amount > 0) {
                  await Expense.create({
                    userId,
                    topic: "บันทึกจากสลิป/ใบเสร็จ",
                    description: item.description,
                    amount: item.amount,
                    category: item.category || "ทั่วไป",
                    type: item.type || "expense",
                  });
                  successCount++;
                  grandTotal += item.amount;
                  summaryReply += `🔴 ${item.description}: ${item.amount} บาท\n`;
                }
              }

              if (successCount > 0) {
                dbUser.quotaUsed += successCount;
                await dbUser.save();
                summaryReply += `------------------------\n💰 ยอดรวมสุทธิ: ${grandTotal.toFixed(2)} บาท\n(ใช้งานโควตาไป ${successCount} รายการ)`;
              }

              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: summaryReply,
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
                    text: "❌ เกิดข้อผิดพลาดในการประมวลผลรูปภาพบิลครับ",
                  },
                ],
              });
            }
          }
          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "🤖 สวัสดีครับ! ขอบคุณที่เพิ่มเพื่อนกับ AI Expense Bot ผู้ช่วยบันทึกรายรับ-รายจ่ายอัจฉริยะ 📊\n\nคุณสามารถใช้งานได้ง่ายๆ ดังนี้:\n• พิมพ์บันทึกด่วนหรือหลายรายการ เช่น 'กระเพรา 50 น้ำ 20'\n• ถ่ายรูปบิลหรือสลิปเพื่อให้ AI ช่วยอ่านยอดเงินให้\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินและรายการย้อนหลัง\n• พิมพ์ 'ลบ' เพื่อเลือกรายการที่ต้องการลบ\n\nทดลองพิมพ์รายการใช้จ่ายของคุณมาได้เลยครับ!",
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
                        label: "🗑️ ลบรายการ",
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

        const userId = event.source.userId;
        if (!userId) return;

        // ==========================================
        // 1. กรณีผู้ใช้ส่งรูปภาพมา (ถ่ายบิล / สลิป)
        // ==========================================
        if (event.type === "message" && event.message.type === "image") {
          const messageId = event.message.id;

          // ตรวจสอบโควตาก่อนทำรายการรูปภาพ
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
            // ดึง Stream รูปภาพจาก LINE API โดยใช้ Channel Access Token
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

            // บันทึกลงฐานข้อมูล
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
          // 0. ตรวจสอบคำทักทาย, คำถามตัวตน, และคำอธิบายความสามารถ
          // ==========================================
          if (
            /^(สวัสดี|หวัดดี|hi|hello|วิธีใช้|ใช้งานยังไง|help|คุณคือใคร|เธอคือใคร|เป็นใคร|คุณทำอะไรได้|เธอทำอะไรได้|สอนใช้หน่อย|ทำอะไรได้บ้าง)/i.test(
              userText,
            )
          ) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "🤖 สวัสดีครับ! ผมคือ AI Expense Bot ผู้ช่วยบันทึกรายรับ-รายจ่ายอัจฉริยะส่วนตัวของคุณ\n\nสิ่งที่ผมช่วยคุณได้:\n• บันทึกรายรับ-รายจ่ายด่วน หรือหลายรายการ เช่น 'กระเพรา 50 น้ำ 20'\n• ถ่ายรูปบิลหรือสลิปเพื่อให้ AI ช่วยอ่านยอดเงินให้ทันที\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินและรายการย้อนหลัง\n• พิมพ์ 'ลบ' เพื่อเลือกรายการที่ต้องการลบ\n\nคุณสามารถทดลองพิมพ์ข้อความบันทึกรายการ หรือกดปุ่มเมนูด่วนด้านล่างนี้ได้เลยครับ 👇",
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
                          label: "🗑️ ลบรายการ",
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
          // A. คำสั่ง "ลบ" -> แสดงรายการล่าสุดเป็น Quick Reply ให้กดเลือก
          // ==========================================
          if (/^(ลบ|ลบรายการ|ลบรายการล่าสุด)$/i.test(userText)) {
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
                    text: "📭 ไม่พบรายการให้ลบครับ คุณยังไม่มีประวัติการบันทึก",
                  },
                ],
              });
            }

            const quickItems = recentExpenses.map((item) => {
              const shortDesc =
                item.description.length > 15
                  ? item.description.substring(0, 15) + "..."
                  : item.description;
              const typeSymbol = item.type === "income" ? "🟢" : "🔴";
              return {
                type: "action" as const,
                action: {
                  type: "message" as const, // กำหนด type ให้ชัดเจนว่าเป็น message action
                  label: `${typeSymbol} ${shortDesc} (${item.amount}฿)`,
                  text: `CONFIRM_DELETE_${item._id}`,
                },
              };
            });

            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "🗑️ กรุณาเลือกรายการที่ต้องการลบจากปุ่มด้านล่างครับ 👇",
                  quickReply: { items: quickItems },
                },
              ],
            });
          }

          // ==========================================
          // A.2 ยืนยันการลบตาม ID ที่กดมาจาก Quick Reply
          // ==========================================
          if (userText.startsWith("CONFIRM_DELETE_")) {
            const expenseId = userText.replace("CONFIRM_DELETE_", "");
            const deleted = await Expense.findByIdAndDelete(expenseId);

            if (!deleted) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: "⚠️ ไม่พบรายการนี้ หรืออาจถูกลบไปแล้วครับ",
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
                  text: `🗑️ ลบรายการเรียบร้อยแล้ว!\n\n📌 ประเภท: ${typeText}\n📝 รายการ: ${deleted.description}\n💰 จำนวน: ${deleted.amount} บาท`,
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
          // 2. ตรวจสอบคำสั่งค้นหารายการเฉพาะเจาะจง (เช่น "หา กระเพรา")
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
          // 3. ตรวจสอบว่ามีตัวเลขในข้อความหรือไม่ (ถ้าไม่มี ให้ปฏิเสธ)
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
          // 4. กระบวนการปกติ: ตรวจสอบโควตาและบันทึกข้อมูล (รองรับหลายรายการ)
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

          // ลองตรวจสอบแบบหลายรายการก่อน (เช่น "กระเพรา 50 น้ำ 20")
          let multipleItems: any[] = [];
          try {
            if (
              typeof (expenseService as any).parseMultipleWithAI === "function"
            ) {
              multipleItems = await (expenseService as any).parseMultipleWithAI(
                userText,
              );
            }
          } catch (e) {
            console.error("Multiple parse error:", e);
          }

          if (multipleItems && multipleItems.length > 0) {
            let successCount = 0;
            let summaryReply =
              "✅ บันทึกหลายรายการสำเร็จ:\n------------------------\n";

            for (const item of multipleItems) {
              if (item.amount && item.amount > 0) {
                await Expense.create({
                  userId,
                  topic: "บันทึกหลายรายการ",
                  description: item.description,
                  amount: item.amount,
                  category: item.category,
                  type: item.type,
                });
                successCount++;
                const typeSymbol = item.type === "income" ? "🟢" : "🔴";
                summaryReply += `${typeSymbol} ${item.description}: ${item.amount} บาท\n`;
              }
            }

            if (successCount > 0) {
              dbUser.quotaUsed += successCount;
              await dbUser.save();
              summaryReply += `------------------------\n(ใช้งานไปแล้ว ${dbUser.quotaUsed}/${dbUser.isPremium ? "∞" : FREE_LIMIT} รายการ)`;
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: "text", text: summaryReply }],
              });
            }
          }

          // Fallback ถ้าไม่ใช่หลายรายการ ให้ประมวลผลแบบรายการเดียวปกติ
          let expenseData = expenseService.parseQuickText(userText);
          if (!expenseData) {
            expenseData = await expenseService.parseWithAI(userText);
          }

          // ป้องกันกรณี AI ตีความแล้วไม่มีจำนวนเงิน
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
