import { MiddlewareConfig } from "@line/bot-sdk";
import dotenv from "dotenv";

dotenv.config();

// กำหนดค่าคอนฟิกสำหรับ LINE SDK โดยใช้ Type พื้นฐานหรือปล่อยให้ TypeScript infer อัตโนมัติ
export const lineConfig = {
  channelAccessToken:
    process.env.LINE_LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    "",
  channelSecret: process.env.LINE_CHANNEL_SECRET || "",
};

// แยกเก็บ MiddlewareConfig สำหรับใช้งานกับ Express Middleware
export const middlewareConfig: MiddlewareConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET || "",
};
