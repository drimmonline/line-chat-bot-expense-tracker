import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Expense } from "../models/expense.model";

export interface ExpenseData {
  description: string;
  amount: number;
  category: string;
  type: "income" | "expense";
}

export class ExpenseService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }

  /**
   * 1. ตรวจสอบข้อความแบบง่ายด้วย RegEx (ขยายคีย์เวิร์ดทั้งรายรับและรายจ่ายให้กว้างขึ้น)
   */
  public parseQuickText(text: string): ExpenseData | null {
    const hasNumber = /\d+/.test(text);
    if (!hasNumber) {
      return null;
    }

    const regex = /^(.+?)\s+(?:(\d+)(?:\.\d+)?)\s*(?:บาท)?$/i;
    const match = text.trim().match(regex);

    if (match) {
      const description = match[1].trim();
      const amount = parseFloat(match[2]);

      // 🟢 ขยายคีย์เวิร์ดฝั่งรายรับให้ครอบคลุมงานจ้าง ฟรีแลนซ์ บริการ และกำไร
      const isIncome =
        /^(รับ|เงินเดือน|ขาย|กำไร|รายรับ|เงินเข้า|โอนเข้า|ค่าจ้าง|เงินปันผล|OT|ค่าคอม|ปั๊ม|ค่าปั่น|ค่าบริการ|ได้มา|ฟรีแลนซ์|ค่าสอน|ค่าตอบแทน)/i.test(
          description,
        );

      return {
        description,
        amount,
        category: isIncome ? "รายรับทั่วไป" : "ทั่วไป",
        type: isIncome ? "income" : "expense",
      };
    }

    return null;
  }

  /**
   * 2. ใช้ Google Gemini AI วิเคราะห์กรณีข้อความยาวหรือซับซ้อน (รองรับบริบทกว้าง)
   */
  public async parseWithAI(text: string): Promise<ExpenseData> {
    try {
      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description:
              "รายละเอียดรายการ เช่น ค่าข้าว, รับปั๊มแร๊งค์, เติมเกม, ค่าจ้างเขียนโค้ด",
          },
          amount: {
            type: Type.NUMBER,
            description: "จำนวนเงินเป็นตัวเลข",
          },
          category: {
            type: Type.STRING,
            description:
              "หมวดหมู่ที่เหมาะสม เช่น อาหาร, เกม/บริการออนไลน์, เดินทาง, ธุรกิจ/ฟรีแลนซ์, ช้อปปิ้ง, บันเทิง, เงินเดือน",
          },
          type: {
            type: Type.STRING,
            description:
              "ประเภทรายการ ระหว่าง income (รายรับ) หรือ expense (รายจ่าย)",
          },
        },
        required: ["description", "amount", "category", "type"],
      };

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `วิเคราะห์ข้อความบันทึกบัญชีนี้ แล้วสกัดข้อมูลออกมาตามโครงสร้าง: "${text}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction:
            "คุณคือผู้ช่วยอัจฉริยะด้านการบัญชีและการเงินส่วนบุคคล หน้าที่ของคุณคือสกัดข้อมูลจากข้อความภาษาไทยทุกรูปแบบได้อย่างแม่นยำ:\n" +
            "1. วิเคราะห์ type ให้ถูกต้อง:\n" +
            "   - income (รายรับ): เช่น เงินเดือน, ค่าจ้าง, รับทำของ, รับปั๊มแรงค์, ค่าคอมมิชชั่น, ขายของ, กำไร, เงินปันผล, มีคนโอนให้, ได้รับเงิน, ค่าบริการ\n" +
            "   - expense (รายจ่าย): เช่น ค่าอาหาร, ซื้อของ, เติมเกม, จ่ายค่าเน็ต, ทำบุญ, ค่าเดินทาง, เปย์, ทำสวย, ช้อปปิ้ง, ค่าใช้จ่ายจิปาถะ\n" +
            "2. สกัด description ให้เข้าใจง่าย\n" +
            "3. สกัด amount เป็นตัวเลขเสมอ\n" +
            "4. กำหนด category ให้สอดคล้องกับยุคปัจจุบันและบริบทของผู้ใช้",
        },
      });

      if (response.text) {
        const parsedData = JSON.parse(response.text) as ExpenseData;
        return parsedData;
      }

      throw new Error("AI could not parse the expense text.");
    } catch (error) {
      console.error("Gemini AI Parse Error:", error);
      return {
        description: text,
        amount: 0,
        category: "อื่นๆ",
        type: "expense",
      };
    }
  }

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

  public async parseImageWithAI(
    imageBase64: string,
    mimeType: string,
  ): Promise<ExpenseData> {
    try {
      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          description: {
            type: Type.STRING,
            description: "ชื่อร้านค้า หรือรายละเอียดรายการจากบิล/สลิป",
          },
          amount: {
            type: Type.NUMBER,
            description: "จำนวนเงินรวมสุทธิเป็นตัวเลข",
          },
          category: {
            type: Type.STRING,
            description: "หมวดหมู่ เช่น อาหาร, เดินทาง, ช้อปปิ้ง, บิลโอนเงิน",
          },
          type: {
            type: Type.STRING,
            description:
              "ประเภทรายการ ระหว่าง income (รายรับ) หรือ expense (รายจ่าย)",
          },
        },
        required: ["description", "amount", "category", "type"],
      };

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              data: imageBase64,
              mimeType: mimeType,
            },
          },
          {
            text: "ช่วยอ่านบิลหรือสลิปนี้ ตรวจสอบว่าเป็นสลิปโอนเงินเข้า (income) หรือสลิปจ่ายเงิน (expense) แล้วสกัดข้อมูลยอดเงิน รายการ และหมวดหมู่ ออกมา",
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction:
            "คุณคือผู้ช่วยอัจฉริยะด้านการอ่านบิลและสลิปการโอนเงิน หน้าที่คือแยกแยะสลิปเงินเข้า (income) และสลิปจ่ายออก (expense) พร้อมดึงยอดเงินและรายละเอียดให้ถูกต้อง",
        },
      });

      if (response.text) {
        return JSON.parse(response.text) as ExpenseData;
      }

      throw new Error("AI could not parse the receipt image.");
    } catch (error) {
      console.error("Gemini Vision Parse Error:", error);
      return {
        description: "รายการจากรูปภาพ",
        amount: 0,
        category: "อื่นๆ",
        type: "expense",
      };
    }
  }

  public async parseMultipleWithAI(text: string): Promise<ExpenseData[]> {
    try {
      const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: "ชื่อรายการ" },
            amount: { type: Type.NUMBER, description: "จำนวนเงินเป็นตัวเลข" },
            category: { type: Type.STRING, description: "หมวดหมู่" },
            type: { type: Type.STRING, description: "income หรือ expense" },
          },
          required: ["description", "amount", "category", "type"],
        },
      };

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `วิเคราะห์ข้อความบันทึกบัญชีหลายรายการนี้ (อาจมีทั้งรายรับและรายจ่ายปะปนกัน) แล้วสกัดออกมาเป็นอาเรย์แยกรายการ: "${text}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction:
            "คุณคือผู้ช่วยอัจฉริยะด้านการบัญชี หน้าที่คือแยกแยะประโยคที่มีหลายรายการ (เช่น รับสอนพิเศษ 500 กินชาบู 350) ให้ถูกต้องว่าอันไหนเป็น income หรือ expense แล้วแตกออกเป็นอาเรย์ของข้อมูลแต่ละรายการ",
        },
      });

      if (response.text) {
        return JSON.parse(response.text) as ExpenseData[];
      }
      return [];
    } catch (error) {
      console.error("Parse Multiple AI Error:", error);
      return [];
    }
  }

  public async checkDuplicateExpense(
    userId: string,
    description: string,
    amount: number,
  ) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await Expense.findOne({
      userId,
      description: { $regex: new RegExp(`^${description}$`, "i") },
      amount,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    return existing;
  }

  public async parseReceiptImageWithAI(
    imageBase64: string,
    mimeType: string,
  ): Promise<ExpenseData[]> {
    try {
      const responseSchema: Schema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            description: {
              type: Type.STRING,
              description: "ชื่อสินค้าหรือรายการจากใบเสร็จ",
            },
            amount: {
              type: Type.NUMBER,
              description: "จำนวนเงินเป็นตัวเลข",
            },
            category: {
              type: Type.STRING,
              description: "หมวดหมู่ เช่น อาหาร, เครื่องดื่ม, ของใช้",
            },
            type: {
              type: Type.STRING,
              description: "income หรือ expense",
            },
          },
          required: ["description", "amount", "category", "type"],
        },
      };

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              data: imageBase64,
              mimeType: mimeType,
            },
          },
          {
            text: "ช่วยอ่านใบเสร็จนี้ แล้วสกัดรายการสินค้าที่มีราคามากกว่า 0 บาท ออกมาทั้งหมดเป็นอาเรย์ (ส่วนใหญ่เป็นรายจ่าย expense)",
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction:
            "คุณคือผู้ช่วยอัจฉริยะด้านการอ่านใบเสร็จ หน้าที่คือดึงรายการสินค้าและราคาจากรูปภาพ กรองรายการที่เป็น 0 บาททิ้ง และระบุ type เป็น expense เป็นหลัก",
        },
      });

      if (response.text) {
        return JSON.parse(response.text) as ExpenseData[];
      }

      return [];
    } catch (error) {
      console.error("Gemini Vision Receipt Parse Error:", error);
      return [];
    }
  }
}
