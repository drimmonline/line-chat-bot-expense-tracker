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
              await User.create({ userId, isPremium: false, quotaUsed: 0 });
            }
          }

          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "🤖 สวัสดีครับ! ขอบคุณที่เพิ่มเพื่อนกับ AI Expense Bot ผู้ช่วยบันทึกรายรับ-รายจ่ายอัจฉริยะ 📊\n\nคุณสามารถใช้งานได้ง่ายๆ ดังนี้:\n• พิมพ์บันทึกด่วนหรือหลายรายการ เช่น 'กระเพรา 50 น้ำ 20'\n• ถ่ายรูปบิลหรือสลิปเพื่อให้ AI ช่วยอ่านยอดเงินให้\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินและรายการย้อนหลัง\n• พิมพ์ 'ลบ' เพื่อเลือกรายการที่ต้องการลบพร้อมระบบยืนยัน\n\nทดลองพิมพ์รายการใช้จ่ายของคุณมาได้เลยครับ!",
                quickReply: {
                  items: [
                    {
                      type: "action" as const,
                      action: {
                        type: "message" as const,
                        label: "📊 ดูสรุปยอด",
                        text: "สรุป",
                      },
                    },
                    {
                      type: "action" as const,
                      action: {
                        type: "message" as const,
                        label: "🗑️ ลบรายการ",
                        text: "ลบ",
                      },
                    },
                    {
                      type: "action" as const,
                      action: {
                        type: "message" as const,
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
                  text: "⚠️ คุณใช้โควตาฟรีครบกำหนดแล้ว กรุณาอัปเกรดเป็นพรีเมียมครับ",
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
            const receiptItems =
              typeof (expenseService as any).parseReceiptImageWithAI ===
              "function"
                ? await (expenseService as any).parseReceiptImageWithAI(
                    imageBase64,
                    "image/jpeg",
                  )
                : [
                    await expenseService.parseImageWithAI(
                      imageBase64,
                      "image/jpeg",
                    ),
                  ];

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
              messages: [{ type: "text", text: summaryReply }],
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

        // ==========================================
        // 2. กรณีผู้ใช้ส่งข้อความตัวอักษรมาปกติ
        // ==========================================
        if (event.type === "message" && event.message.type === "text") {
          const userText = event.message.text.trim();

          // ==========================================
          // ⭐ ย้ายคำสั่งควบคุมพิเศษ (ลบ, ยืนยัน, บันทึกซ้ำ) มาไว้บนสุดตรงนี้เลย
          // ==========================================

          // A.1 ขั้นตอนถามย้ำก่อนลบจริง
          if (userText.startsWith("ASK_DELETE_")) {
            const expenseId = userText.replace("ASK_DELETE_", "");
            const targetExpense = await Expense.findById(expenseId);

            if (!targetExpense) {
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: "⚠️ ไม่พบรายการนี้ในระบบ หรืออาจถูกลบไปแล้วครับ",
                  },
                ],
              });
            }

            const typeSymbol =
              targetExpense.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: `⚠️ คุณต้องการลบรายการนี้ใช่ไหม?\n\n📌 ประเภท: ${typeSymbol}\n📝 รายการ: ${targetExpense.description}\n💰 จำนวน: ${targetExpense.amount} บาท`,
                  quickReply: {
                    items: [
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "✅ ใช่, ยืนยันลบ",
                          text: `CONFIRM_DELETE_${targetExpense._id}`,
                        },
                      },
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "❌ ยกเลิก",
                          text: "ยกเลิก",
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }

          // A.2 ดำเนินการลบจริงหลังจากกดยืนยัน
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

          // B.1 ยืนยันบันทึกซ้ำ
          if (userText.startsWith("FORCE_SAVE_")) {
            try {
              const payload = JSON.parse(userText.replace("FORCE_SAVE_", ""));
              let dbUser = await User.findOne({ userId });
              if (!dbUser) {
                dbUser = await User.create({
                  userId,
                  isPremium: false,
                  quotaUsed: 0,
                });
              }

              await Expense.create({
                userId,
                topic: "บันทึกรายรับรายจ่าย",
                description: payload.description,
                amount: payload.amount,
                category: payload.category,
                type: payload.type,
              });

              dbUser.quotaUsed += 1;
              await dbUser.save();

              const typeText =
                payload.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: `✅ บันทึกรายการซ้ำสำเร็จตามคำขอ!\n\n📌 ประเภท: ${typeText}\n📝 รายการ: ${payload.description}\n💰 จำนวน: ${payload.amount} บาท`,
                  },
                ],
              });
            } catch (err) {
              console.error("Force save error:", err);
            }
          }

          // ถ้ายกเลิกการทำงาน
          if (/^ยกเลิก$/i.test(userText)) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                { type: "text", text: "❌ ยกเลิกรายการเรียบร้อยครับ" },
              ],
            });
          }

          // ==========================================
          // 0. ตรวจสอบคำทักทาย, คำถามตัวตน
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
                  text: "🤖 สวัสดีครับ! ผมคือ AI Expense Bot ผู้ช่วยบันทึกรายรับ-รายจ่ายอัจฉริยะส่วนตัวของคุณ\n\nสิ่งที่ผมช่วยคุณได้:\n• บันทึกรายรับ-รายจ่ายด่วน หรือหลายรายการ เช่น 'กระเพรา 50 น้ำ 20'\n• ถ่ายรูปบิลหรือสลิปเพื่อให้ AI ช่วยอ่านยอดเงินให้ทันที\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินและรายการย้อนหลัง\n• พิมพ์ 'ลบ' เพื่อเลือกรายการที่ต้องการลบพร้อมระบบยืนยัน\n\nคุณสามารถทดลองพิมพ์ข้อความบันทึกรายการ หรือกดปุ่มเมนูด่วนด้านล่างนี้ได้เลยครับ 👇",
                  quickReply: {
                    items: [
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "📊 ดูสรุปยอด",
                          text: "สรุป",
                        },
                      },
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "🟢 ดูรายรับ",
                          text: "รายรับ",
                        },
                      },
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "🔴 ดูรายจ่าย",
                          text: "รายจ่าย",
                        },
                      },
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "🗑️ ลบรายการ",
                          text: "ลบ",
                        },
                      },
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
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
          // A. คำสั่ง "ลบ" -> แสดงรายการล่าสุดเป็น Quick Reply ให้เลือก
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
                  type: "message" as const,
                  label: `${typeSymbol} ${shortDesc} (${item.amount}฿)`,
                  text: `ASK_DELETE_${item._id}`,
                },
              };
            });

            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "🗑️ กรุณาเลือกรายการที่ต้องการตรวจสอบเพื่อลบครับ 👇",
                  quickReply: { items: quickItems },
                },
              ],
            });
          }

          // คำสั่งดูรายรับ / รายจ่าย / สรุป / ค้นหา (ปกติ)
          if (/^ดูรายรับ|รายรับ$/i.test(userText)) {
            const incomes = await expenseService.getFilteredExpenses(
              userId,
              { type: "income" },
              5,
            );
            if (incomes.length === 0)
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  { type: "text", text: "📭 ยังไม่มีประวัติรายการรายรับครับ" },
                ],
              });
            let text = "🟢 5 รายรับล่าสุดของคุณ:\n------------------------\n";
            incomes.forEach((item, i) => {
              text += `${i + 1}. 🟢 ${item.description}: +${item.amount} บาท\n`;
            });
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text }],
            });
          }

          if (/^ดูรายจ่าย|รายจ่าย$/i.test(userText)) {
            const expenses = await expenseService.getFilteredExpenses(
              userId,
              { type: "expense" },
              5,
            );
            if (expenses.length === 0)
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  { type: "text", text: "📭 ยังไม่มีประวัติรายการรายจ่ายครับ" },
                ],
              });
            let text = "🔴 5 รายจ่ายล่าสุดของคุณ:\n------------------------\n";
            expenses.forEach((item, i) => {
              text += `${i + 1}. 🔴 ${item.description}: -${item.amount} บาท\n`;
            });
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text }],
            });
          }

          if (/^(สรุป|รายการ|ดูรายการ|ประวัติ)/i.test(userText)) {
            const recentExpenses = await expenseService.getRecentExpenses(
              userId,
              5,
            );
            if (recentExpenses.length === 0)
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  { type: "text", text: "📭 ยังไม่มีประวัติการบันทึกรายการ" },
                ],
              });
            let totalIncome = 0,
              totalExpense = 0;
            recentExpenses.forEach((item) => {
              item.type === "income"
                ? (totalIncome += item.amount)
                : (totalExpense += item.amount);
            });
            let text = `📊 รายการล่าสุด (${recentExpenses.length} รายการ):\n------------------------\n`;
            recentExpenses.forEach((item, index) => {
              text += `${index + 1}. ${item.type === "income" ? "🟢" : "🔴"} ${item.description}: ${item.amount} บาท\n`;
            });
            text += `------------------------\n🟢 รับ: ${totalIncome} | 🔴 จ่าย: ${totalExpense}`;
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [{ type: "text", text }],
            });
          }

          const searchMatch = userText.match(/^(หา|ค้นหา)\s+(.+)$/i);
          if (searchMatch) {
            const keyword = searchMatch[2].trim();
            const foundExpenses = await expenseService.searchExpenses(
              userId,
              keyword,
              5,
            );
            if (foundExpenses.length === 0)
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [
                  {
                    type: "text",
                    text: `🔍 ไม่พบรายการที่ตรงกับ "${keyword}" ครับ`,
                  },
                ],
              });
            let searchReply = `🔍 ผลการค้นหา "${keyword}":\n------------------------\n`;
            foundExpenses.forEach((item, index) => {
              searchReply += `${index + 1}. ${item.type === "income" ? "🟢" : "🔴"} ${item.description}: ${item.amount} บาท\n`;
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
          // 4. บันทึกข้อมูล (รองรับหลายรายการ + เช็คซ้ำ)
          // ==========================================
          let dbUser = await User.findOne({ userId });
          if (!dbUser)
            dbUser = await User.create({
              userId,
              isPremium: false,
              quotaUsed: 0,
            });

          const FREE_LIMIT = 30;
          if (!dbUser.isPremium && dbUser.quotaUsed >= FREE_LIMIT) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: "⚠️ คุณใช้โควตาฟรีครบกำหนดแล้ว กรุณาอัปเกรดพรีเมียมครับ",
                },
              ],
            });
          }

          // หลายรายการ
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
                summaryReply += `${item.type === "income" ? "🟢" : "🔴"} ${item.description}: ${item.amount} บาท\n`;
              }
            }
            if (successCount > 0) {
              dbUser.quotaUsed += successCount;
              await dbUser.save();
              return client.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: "text", text: summaryReply }],
              });
            }
          }

          // รายการเดี่ยว
          let expenseData = expenseService.parseQuickText(userText);
          if (!expenseData) {
            expenseData = await expenseService.parseWithAI(userText);
          }

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

          // เช็คซ้ำ
          const duplicate =
            typeof (expenseService as any).checkDuplicateExpense === "function"
              ? await (expenseService as any).checkDuplicateExpense(
                  userId,
                  expenseData.description,
                  expenseData.amount,
                )
              : null;

          if (duplicate) {
            return client.replyMessage({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: `⚠️ พบรายการ "${expenseData.description}" จำนวน ${expenseData.amount} บาท ถูกบันทึกไปแล้วในวันนี้ ต้องการบันทึกซ้ำหรือไม่?`,
                  quickReply: {
                    items: [
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "✅ ยืนยันบันทึกซ้ำ",
                          text: `FORCE_SAVE_${JSON.stringify({
                            description: expenseData.description,
                            amount: expenseData.amount,
                            category: expenseData.category,
                            type: expenseData.type,
                          })}`,
                        },
                      },
                      {
                        type: "action" as const,
                        action: {
                          type: "message" as const,
                          label: "❌ ยกเลิก",
                          text: "ยกเลิก",
                        },
                      },
                    ],
                  },
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

          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: `✅ บันทึกสำเร็จ!\n\n📌 ประเภท: ${expenseData.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย"}\n📝 รายการ: ${expenseData.description}\n💰 จำนวน: ${expenseData.amount} บาท`,
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
