import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../../config/line.config";
import { User } from "../../models/user.model";
import { Expense } from "../../models/expense.model";

const client = new messagingApi.MessagingApiClient(lineConfig);

export async function handleSystemCommands(
  event: any,
  userText: string,
  userId: string,
): Promise<boolean> {
  // เพิ่มการดักจับกรณีผู้ใช้พิมพ์ "ลบ [ชื่อรายการ]" เช่น "ลบข้าวมันไก่"
  const deleteTextMatch = userText.match(/^ลบ\s+(.+)$/i);
  if (deleteTextMatch && !userText.startsWith("CONFIRM_DELETE_")) {
    const keyword = deleteTextMatch[1].trim();

    // ค้นหารายการที่ชื่อตรงกับที่พิมพ์มา
    const foundExpenses = await Expense.find({
      userId,
      description: new RegExp(keyword, "i"),
    })
      .sort({ createdAt: -1 })
      .limit(5);

    if (foundExpenses.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: "text",
            text: `🔍 ไม่พบรายการที่ชื่อว่า "${keyword}" สำหรับลบครับ`,
          },
        ],
      });
      return true;
    }

    // สร้างปุ่ม Quick Reply ให้กดเลือกรายการที่ค้นเจอเพื่อลบ
    const quickItems = foundExpenses.map((item) => {
      const typeSymbol = item.type === "income" ? "🟢" : "🔴";
      return {
        type: "action" as const,
        action: {
          type: "message" as const,
          label: `${typeSymbol} ${item.description} (${item.amount}฿)`,
          text: `CONFIRM_DELETE_${item._id}`,
        },
      };
    });

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: `🗑️ พบรายการที่ใกล้เคียงกับ "${keyword}" เลือกรายการที่ต้องการลบได้เลยครับ 👇`,
          quickReply: { items: quickItems },
        },
      ],
    });
    return true;
  }
  // 1. ดำเนินการลบทันทีเมื่อผู้ใช้กดเลือกรายการจาก Quick Reply
  if (userText.startsWith("CONFIRM_DELETE_")) {
    const expenseId = userText.replace("CONFIRM_DELETE_", "");
    const deleted = await Expense.findByIdAndDelete(expenseId);

    if (!deleted) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: "text", text: "⚠️ ไม่พบรายการนี้ หรืออาจถูกลบไปแล้วครับ" },
        ],
      });
      return true;
    }

    let dbUser = await User.findOne({ userId });
    if (dbUser && dbUser.quotaUsed > 0) {
      dbUser.quotaUsed -= 1;
      await dbUser.save();
    }

    const typeText = deleted.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: `🗑️ ลบรายการเรียบร้อยแล้ว!\n\n📌 ประเภท: ${typeText}\n📝 รายการ: ${deleted.description}\n💰 จำนวน: ${deleted.amount} บาท`,
        },
      ],
    });
    return true;
  }

  // 2. ยืนยันบันทึกซ้ำ
  if (userText.startsWith("FORCE_SAVE_")) {
    try {
      const payload = JSON.parse(userText.replace("FORCE_SAVE_", ""));
      let dbUser = await User.findOne({ userId });
      if (!dbUser) {
        dbUser = await User.create({ userId, isPremium: false, quotaUsed: 0 });
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

      const typeText = payload.type === "income" ? "🟢 รายรับ" : "🔴 รายจ่าย";
      await client.replyMessage({
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
    return true;
  }

  // 3. ยกเลิก
  if (/^ยกเลิก$/i.test(userText)) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "❌ ยกเลิกรายการเรียบร้อยครับ" }],
    });
    return true;
  }

  return false; // ถ้าไม่ใช่คำสั่งระบบ ให้ผ่านไปทำส่วนอื่นต่อ
}
