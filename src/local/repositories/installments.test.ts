import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createInstallmentPlan, deleteInstallmentPlan, getInstallmentPlan, payInstallment } from "./installments";

const USER_ID = "user_inst_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "i@example.com", "hash", "Inst", now(), now()]);
  return db;
}

describe("local installments", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a plan with the full generated installment schedule and a summary", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام خودرو",
      totalAmount: 12000000,
      installmentAmount: 1000000,
      numberOfInstallments: 12,
      dueDay: 5,
    });

    expect(plan.installments).toHaveLength(12);
    expect(plan.installments[0].index).toBe(1);
    expect(plan.installments.every((i) => i.status === "PENDING")).toBe(true);
    expect(plan.summary.totalCount).toBe(12);
    expect(plan.summary.remainingAmount).toBe(12000000);
  });

  it("creates reminder rows per installment x offset when reminderOffsets are supplied", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 2000000,
      installmentAmount: 1000000,
      numberOfInstallments: 2,
      dueDay: 1,
      reminderOffsets: [60, 1440],
    });

    const reminders = db.all<any>(`SELECT * FROM "Reminder" WHERE "userId" = ? AND "targetType" = 'INSTALLMENT'`, [USER_ID]);
    expect(reminders).toHaveLength(4); // 2 installments x 2 offsets
    expect(reminders.every((r) => r.installmentId && plan.installments.some((i) => i.id === r.installmentId))).toBe(true);
  });

  it("pays an installment, marks it PAID, and creates a linked EXPENSE transaction", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 1000000,
      installmentAmount: 1000000,
      numberOfInstallments: 1,
      dueDay: 1,
    });

    const { installment, transaction } = payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });
    expect(installment.status).toBe("PAID");
    expect(transaction.amount).toBe(1000000);
    expect(transaction.installmentId).toBe(installment.id);

    expect(() => payInstallment(db, USER_ID, installment.id, { accountId: "acc_1" })).toThrow("این قسط قبلاً پرداخت شده است.");
  });

  it("refuses to delete a plan that has at least one paid installment", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 1000000,
      installmentAmount: 1000000,
      numberOfInstallments: 1,
      dueDay: 1,
    });
    payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });

    expect(() => deleteInstallmentPlan(db, USER_ID, plan.id)).toThrow("طرحی که پرداخت انجام‌شده دارد قابل حذف نیست تا صحت گزارش‌ها حفظ شود.");
  });

  it("throws a 404 for another user's plan", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, { title: "وام", totalAmount: 100, installmentAmount: 100, numberOfInstallments: 1, dueDay: 1 });
    expect(() => getInstallmentPlan(db, "someone_else", plan.id)).toThrow("طرح قسط پیدا نشد.");
  });
});
