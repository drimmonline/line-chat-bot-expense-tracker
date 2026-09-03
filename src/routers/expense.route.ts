import express, { Request, Response } from "express";

const router = express.Router();

interface ExpenseItem {
  id: string;
  userId: string;
  topic?: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  createdAt: string;
}

// ฐานข้อมูลจำลองในหน่วยความจำ (Array)
let expenseDatabase: ExpenseItem[] = [];

// 1. ดึงข้อมูลรายรับ-รายจ่ายตาม userId
router.get("/:userId", (req: Request, res: Response): any => {
  try {
    const { userId } = req.params;
    const userExpenses = expenseDatabase.filter(
      (item) => item.userId === userId,
    );
    return res.status(200).json(userExpenses);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// 2. บันทึกรายการใหม่
router.post("/", (req: Request, res: Response): any => {
  try {
    const expenseData = req.body;

    // ตรวจสอบข้อมูลเบื้องต้น
    if (
      !expenseData.userId ||
      !expenseData.amount ||
      !expenseData.description
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newEntry: ExpenseItem = {
      id: Date.now().toString(),
      ...expenseData,
      createdAt: new Date().toISOString(),
    };

    expenseDatabase.unshift(newEntry); // บันทึกข้อมูลใหม่ไว้ด้านบนสุด

    return res.status(201).json({
      message: "Success",
      data: newEntry,
    });
  } catch (error) {
    console.error("Error creating expense:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// 3. ลบรายการตาม id
router.delete("/:id", (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const initialLength = expenseDatabase.length;
    expenseDatabase = expenseDatabase.filter((item) => item.id !== id);

    if (expenseDatabase.length === initialLength) {
      return res.status(404).json({ message: "Expense not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Error deleting expense:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// 4. แก้ไขรายการตาม id
router.put("/:id", (req: Request, res: Response): any => {
  try {
    const { id } = req.params;
    const index = expenseDatabase.findIndex((item) => item.id === id);

    if (index === -1) {
      return res.status(404).json({ message: "Expense not found" });
    }

    expenseDatabase[index] = {
      ...expenseDatabase[index],
      ...req.body,
      id, // ล็อค ID เดิมไว้ไม่ให้เปลี่ยน
    };

    return res.status(200).json({
      message: "Updated successfully",
      data: expenseDatabase[index],
    });
  } catch (error) {
    console.error("Error updating expense:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
