import express from "express";

const router = express.Router();

// ตัวอย่าง Endpoint สำหรับดึงรายการ
router.get("/:userId", (req, res) => {
  const { userId } = req.params;
  // ดึงข้อมูลจาก Database ตาม userId แล้วส่งกลับไป
  res.json([]);
});

// ตัวอย่าง Endpoint สำหรับบันทึกรายการ
router.post("/", (req, res) => {
  const expenseData = req.body;
  // บันทึกข้อมูลลง Database
  res.status(201).json({ message: "Success", data: expenseData });
});

export default router;
