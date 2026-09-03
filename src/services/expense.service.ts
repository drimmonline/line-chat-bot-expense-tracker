import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Expense } from "../models/expense.model"; // นำเข้า Model สำหรับดึงข้อมูลประวัติ

export interface ExpenseData {
  description: string;
  amount: number;
  category: string;
  type: "income" | "expense";
}

export class ExpenseService {
  private ai: GoogleGenAI;

  constructor() {
    // กำหนดค่าเริ่มต้น Google Gen AI โดยดึง API Key จาก .env
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  /**
   * 1. ตรวจสอบข้อความแบบง่ายด้วย RegEx (เช่น "ข้าว 60", "ขายของ 300")
   * ช่วยประหยัดเวลาและไม่ต้องเสีย Token โดยไม่จำเป็น
   */
  public parseQuickText(text: string): ExpenseData | null {
    const regex = /^(.+?)\s+(?:(\d+)(?:\.\d+)?)\s*(?:บาท)?$/i;
    const match = text.trim().match(regex);

    if (match) {
      const description = match[1].trim();
      const amount = parseFloat(match[2]);

      // ตรวจสอบคำหลักว่าเป็นรายรับหรือไม่
      const isIncome = /^(รับ|เงินเดือน|ขาย|กำไร|รายรับ)/i.test(description);

      return {
        description,
        amount,
        category: isIncome ? "รายรับ" : "ทั่วไป",
        type: isIncome ? "income" : "expense", // ปรับให้เลือก type ตามเงื่อนไขจริง
      };
    }

    return null; // ถ้าไม่ตรงรูปแบบ ให้ส่งต่อไปให้ AI ประมวลผล
  }

  /**
   * 2. ใช้ Google Gemini AI วิเคราะห์กรณีข้อความยาวหรือซับซ้อน
   * (เช่น "เมื่อวานไปกินชาบูกับเพื่อน หารกัน 450 บาท" หรือ "เงินเดือนออก 25000")
   */
  public async parseWithAI(text: string): Promise<ExpenseData> {
    try {
      // กำหนดโครงสร้าง Response ที่ต้องการบังคับให้ AI ตอบกลับมาเป็น JSON ชัดเจน (Structured Outputs)
      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description:
              "รายละเอียดรายการใช้จ่ายหรือรายรับ เช่น ข้าวเที่ยง, ค่าเดินทาง, เงินเดือน, เติมเกม",
          },
          amount: {
            type: Type.NUMBER,
            description: "จำนวนเงินเป็นตัวเลข",
          },
          category: {
            type: Type.STRING,
            description:
              "หมวดหมู่ค่าใช้จ่ายหรือรายรับ เช่น อาหาร, เดินทาง, บันเทิง, ช้อปปิ้ง, เกม, รายรับ",
          },
          type: {
            type: Type.STRING,
            description:
              "ประเภทรายการ ระหว่าง income (รายรับ) หรือ expense (รายจ่าย)",
          },
        },
        required: ["description", "amount", "category", "type"],
      };

      // เรียกใช้งานโมเดล gemini-2.5-flash ที่รองรับในปัจจุบัน
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `วิเคราะห์ข้อความบันทึกบัญชีนี้ แล้วสกัดข้อมูลออกมาตามโครงสร้าง: "${text}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction:
            "คุณคือผู้ช่วยอัจฉริยะด้านการบันทึกบัญชี หน้าที่ของคุณคือสกัดจำนวนเงิน รายการ หมวดหมู่ และระบุประเภทให้ถูกต้องว่าเป็ย income (รายรับ) หรือ expense (รายจ่าย)",
        },
      });

      if (response.text) {
        const parsedData = JSON.parse(response.text) as ExpenseData;
        return parsedData;
      }

      throw new Error("AI could not parse the expense text.");
    } catch (error) {
      console.error("Gemini AI Parse Error:", error);
      // ค่าสำรองกรณี AI ขัดข้อง
      return {
        description: text,
        amount: 0,
        category: "อื่นๆ",
        type: "expense",
      };
    }
  }

  /**
   * 3. ดึงรายการประวัติการใช้จ่ายล่าสุดของผู้ใช้จาก MongoDB
   */
  public async getRecentExpenses(
    userId: string,
    limit: number = 5,
  ): Promise<any[]> {
    try {
      const expenses = await Expense.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit);
      return expenses;
    } catch (error) {
      console.error("Get Expenses Error:", error);
      return [];
    }
  }

  /**
   * 4. ค้นหารายการตามคำค้น (เช่น ค้นหาคำว่า "กระเพรา" หรือ "ค่าเดินทาง")
   */
  public async searchExpenses(
    userId: string,
    keyword: string,
    limit: number = 5,
  ): Promise<any[]> {
    try {
      const expenses = await Expense.find({
        userId,
        $or: [
          { description: new RegExp(keyword, "i") },
          { category: new RegExp(keyword, "i") },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(limit);
      return expenses;
    } catch (error) {
      console.error("Search Expenses Error:", error);
      return [];
    }
  }

  /**
   * 5. ดึงรายการตามประเภท (รายรับ/รายจ่าย) สำหรับกรองดูเฉพาะกลุ่ม
   */
  public async getFilteredExpenses(
    userId: string,
    filter: { type: "income" | "expense" },
    limit: number = 5,
  ): Promise<any[]> {
    try {
      const expenses = await Expense.find({ userId, type: filter.type })
        .sort({ createdAt: -1 })
        .limit(limit);
      return expenses;
    } catch (error) {
      console.error("Filter Expenses Error:", error);
      return [];
    }
  }

  /**
   * 6. ลบรายการล่าสุดของผู้ใช้
   */
  public async deleteLatestExpense(userId: string): Promise<any | null> {
    try {
      const latest = await Expense.findOne({ userId }).sort({ createdAt: -1 });
      if (latest) {
        await Expense.findByIdAndDelete(latest._id);
        return latest;
      }
      return null;
    } catch (error) {
      console.error("Delete Expense Error:", error);
      return null;
    }
  }
}
