import express from "express";
import dotenv from "dotenv";
import cors from "cors"; // 1. นำเข้า cors
import webhookRouter from "./routers/webhook.route";
import { connectDB } from "./config/db.config";
import expenseRouter from "./routers/expense.route";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// เชื่อมต่อ MongoDB
connectDB();

// 2. เปิดใช้งาน CORS (ให้หน้าเว็บ Vercel ยิง API เข้ามาหาได้)
app.use(cors());
app.get("/", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "เชื่อมต่อ Backend สำเร็จแล้ว!",
  });
});
app.use(express.json());
app.use("/webhook", webhookRouter);
app.use("/expenses", expenseRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
