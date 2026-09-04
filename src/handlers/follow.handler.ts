import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../config/line.config";
import { User } from "../models/user.model";

const client = new messagingApi.MessagingApiClient(lineConfig);

export async function handleFollowEvent(event: any) {
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
