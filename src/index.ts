import express from "express";
import dotenv from "dotenv";
import webhookRouter from "./routers/webhook.route";
import { connectDB } from "./config/db.config";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// เชื่อมต่อ MongoDB
connectDB();

app.use(express.json());
app.use("/webhook", webhookRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
