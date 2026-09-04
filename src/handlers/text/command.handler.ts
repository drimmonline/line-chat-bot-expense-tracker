import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../../config/line.config";
import { ExpenseService } from "../../services/expense.service";

const client = new messagingApi.MessagingApiClient(lineConfig);
const expenseService = new ExpenseService();

export async function handleGeneralCommands(
  event: any,
  userText: string,
  userId: string,
): Promise<boolean> {
  // คำทักทาย / ช่วยเหลือ
  if (
    /^(สวัสดี|หวัดดี|hi|hello|วิธีใช้|ใช้งานยังไง|help|คุณคือใคร|เธอคือใคร|เป็นใคร|คุณทำอะไรได้|เธอทำอะไรได้|สอนใช้หน่อย|ทำอะไรได้บ้าง)/i.test(
      userText,
    )
  ) {
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "🤖 สวัสดีครับ! ผมคือ AI Expense Bot ผู้ช่วยบันทึกรายรับ-รายจ่ายส่วนตัว\n\n• พิมพ์บันทึกด่วนหรือหลายรายการ เช่น 'ข้าว 50 น้ำ 20'\n• พิมพ์ 'สรุป' เพื่อดูยอดเงินย้อนหลัง\n• พิมพ์ 'ลบ' เพื่อเลือกรายการและกดลบได้ทันที",
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
            ],
          },
        },
      ],
    });
    return true;
  }

  // คำสั่ง "ลบ" -> แสดงรายการล่าสุดให้เลือก
  if (/^(ลบ|ลบรายการ|ลบรายการล่าสุด)$/i.test(userText)) {
    const recentExpenses = await expenseService.getRecentExpenses(userId, 5);

    if (recentExpenses.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: "text",
            text: "📭 ไม่พบรายการให้ลบครับ คุณยังไม่มีประวัติการบันทึก",
          },
        ],
      });
      return true;
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
          text: `CONFIRM_DELETE_${item._id}`,
        },
      };
    });

    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: "text",
          text: "🗑️ เลือกรายการที่ต้องการลบจากด้านล่างได้เลยครับ 👇",
          quickReply: { items: quickItems },
        },
      ],
    });
    return true;
  }

  // ดูรายรับ
  if (/^ดูรายรับ|รายรับ$/i.test(userText)) {
    const incomes = await expenseService.getFilteredExpenses(
      userId,
      { type: "income" },
      5,
    );
    if (incomes.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: "text", text: "📭 ยังไม่มีประวัติรายการรายรับครับ" },
        ],
      });
      return true;
    }
    let text = "🟢 5 รายรับล่าสุดของคุณ:\n------------------------\n";
    incomes.forEach((item, i) => {
      text += `${i + 1}. 🟢 ${item.description}: +${item.amount} บาท\n`;
    });
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text }],
    });
    return true;
  }

  // ดูรายจ่าย
  if (/^ดูรายจ่าย|รายจ่าย$/i.test(userText)) {
    const expenses = await expenseService.getFilteredExpenses(
      userId,
      { type: "expense" },
      5,
    );
    if (expenses.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: "text", text: "📭 ยังไม่มีประวัติรายการรายจ่ายครับ" },
        ],
      });
      return true;
    }
    let text = "🔴 5 รายจ่ายล่าสุดของคุณ:\n------------------------\n";
    expenses.forEach((item, i) => {
      text += `${i + 1}. 🔴 ${item.description}: -${item.amount} บาท\n`;
    });
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text }],
    });
    return true;
  }

  // สรุปยอด
  if (/^(สรุป|รายการ|ดูรายการ|ประวัติ)/i.test(userText)) {
    const recentExpenses = await expenseService.getRecentExpenses(userId, 5);
    if (recentExpenses.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: "📭 ยังไม่มีประวัติการบันทึกรายการ" }],
      });
      return true;
    }
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
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text }],
    });
    return true;
  }

  // ค้นหา
  const searchMatch = userText.match(/^(หา|ค้นหา)\s+(.+)$/i);
  if (searchMatch) {
    const keyword = searchMatch[2].trim();
    const foundExpenses = await expenseService.searchExpenses(
      userId,
      keyword,
      5,
    );
    if (foundExpenses.length === 0) {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: "text", text: `🔍 ไม่พบรายการที่ตรงกับ "${keyword}" ครับ` },
        ],
      });
      return true;
    }
    let searchReply = `🔍 ผลการค้นหา "${keyword}":\n------------------------\n`;
    foundExpenses.forEach((item, index) => {
      searchReply += `${index + 1}. ${item.type === "income" ? "🟢" : "🔴"} ${item.description}: ${item.amount} บาท\n`;
    });
    await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: searchReply }],
    });
    return true;
  }

  return false;
}
