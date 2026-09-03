import { Schema, model, Document } from "mongoose";

export interface IExpense extends Document {
  userId: string;
  topic: string; // หัวข้อที่ผู้ใช้กำหนด เช่น "บันทึกรายรับรายจ่าย", "ฟิตเนส"
  description: string; // รายรายการ เช่น "ข้าวมันไก่"
  amount: number; // จำนวนเงิน
  category: string; // หมวดหมู่ เช่น "อาหาร"
  type: "income" | "expense";
  date: Date;
}

const expenseSchema = new Schema<IExpense>(
  {
    userId: { type: String, required: true, index: true },
    topic: { type: String, required: true, default: "บันทึกรายรับรายจ่าย" },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, default: "ทั่วไป" },
    type: { type: String, enum: ["income", "expense"], required: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const Expense = model<IExpense>("Expense", expenseSchema);
