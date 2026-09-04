import { Request, Response } from "express";
import { handleFollowEvent } from "../handlers/follow.handler";
import { handleImageMessage } from "../handlers/image.handler";
import { handleTextMessage } from "../handlers/text.handler";

export const handleLineWebhook = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const events: any[] = req.body.events;

    await Promise.all(
      events.map(async (event) => {
        // 1. อีเวนต์กดเพิ่มเพื่อน
        if (event.type === "follow") {
          await handleFollowEvent(event);
        }
        // 2. อีเวนต์ส่งรูปภาพ (บิล / สลิป)
        else if (event.type === "message" && event.message.type === "image") {
          await handleImageMessage(event);
        }
        // 3. อีเวนต์ส่งข้อความตัวอักษร
        else if (event.type === "message" && event.message.type === "text") {
          await handleTextMessage(event);
        }
      }),
    );

    res.status(200).json({ status: "success" });
  } catch (err: any) {
    console.error("Webhook Error:", err);
    res.status(500).json({ error: err.message });
  }
};
