import { Router } from "express";
import { handleLineWebhook } from "../controller/webhook.controller";

const router = Router();

// ถอด middleware(lineConfig) ออก เพื่อรับ Webhook เข้า Controller ได้ทันที
router.post("/", handleLineWebhook);

export default router;
