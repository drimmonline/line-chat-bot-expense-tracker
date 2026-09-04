import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../config/line.config";
import { User } from "../models/user.model";
import { Expense } from "../models/expense.model";
import { ExpenseService } from "../services/expense.service";
import axios from "axios";

const client = new messagingApi.MessagingApiClient(lineConfig);
const expenseService = new ExpenseService();

export async function handleImageMessage(event: any) {
  const userId = event.source.userId;
  if (!userId) return;

  const messageId = event.message.id;

  let dbUser = await User.findOne({ userId });
  if (!dbUser) {
    dbUser = await User.create({ userId, isPremium: false, quotaUsed: 0 });
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
        headers: { Authorization: `Bearer ${lineConfig.channelAccessToken}` },
        responseType: "arraybuffer",
      },
    );

    const imageBase64 = Buffer.from(streamResponse.data).toString("base64");
    const receiptItems =
      typeof (expenseService as any).parseReceiptImageWithAI === "function"
        ? await (expenseService as any).parseReceiptImageWithAI(
            imageBase64,
            "image/jpeg",
          )
        : [await expenseService.parseImageWithAI(imageBase64, "image/jpeg")];

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
    let summaryReply = "📸 อ่านใบเสร็จสำเร็จ!\n------------------------\n";
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
        { type: "text", text: "❌ เกิดข้อผิดพลาดในการประมวลผลรูปภาพบิลครับ" },
      ],
    });
  }
}
