import { messagingApi } from "@line/bot-sdk";
import { lineConfig } from "../../config/line.config";
import { User } from "../../models/user.model";
import { Expense } from "../../models/expense.model";
import { ExpenseService } from "../../services/expense.service";

const client = new messagingApi.MessagingApiClient(lineConfig);
const expenseService = new ExpenseService();

export async function handleExpenseCreation(
  event: any,
  userText: string,
  userId: string,
) {
  const hasNumber = /\d+/.test(userText);
  if (!hasNumber) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        { type: "text", text: "ขออภัยผมไม่สามารถช่วยเหลือเรื่องนั้นได้" },
      ],
    });
  }

  let dbUser = await User.findOne({ userId });
  if (!dbUser)
    dbUser = await User.create({ userId, isPremium: false, quotaUsed: 0 });

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
    if (typeof (expenseService as any).parseMultipleWithAI === "function") {
      multipleItems = await (expenseService as any).parseMultipleWithAI(
        userText,
      );
    }
  } catch (e) {
    console.error("Multiple parse error:", e);
  }

  if (multipleItems && multipleItems.length > 0) {
    let successCount = 0;
    let summaryReply = "✅ บันทึกหลายรายการสำเร็จ:\n------------------------\n";
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
        { type: "text", text: "ขออภัยผมไม่สามารถช่วยเหลือเรื่องนั้นได้" },
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
