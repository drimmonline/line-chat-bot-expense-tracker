import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
  userId: string; // LINE User ID (ใช้เป็น Key หลัก)
  isPremium: boolean; // สถานะสมาชิกพรีเมียม
  quotaUsed: number; // จำนวนรายการที่ใช้ไปในเดือนนี้
  expiresAt?: Date; // วันหมดอายุแพ็กเกจพรีเมียม
}

const userSchema = new Schema<IUser>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    isPremium: { type: Boolean, default: false },
    quotaUsed: { type: Number, default: 0 },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
