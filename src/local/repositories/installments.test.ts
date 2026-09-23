import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createInstallmentPlan, deleteInstallmentPlan, getInstallmentPlan, payInstallment, unpayInstallment, updateInstallmentPlan } from "./installments";
import { fromJalali, toJalali } from "@/lib/jalali";

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

  it("unpays an installment: reverts it to PENDING and soft-deletes its linked transaction", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 1000000,
      installmentAmount: 1000000,
      numberOfInstallments: 1,
      dueDay: 1,
    });
    const { transaction } = payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });

    const { installment } = unpayInstallment(db, USER_ID, plan.installments[0].id);
    expect(installment.status).toBe("PENDING");
    expect(installment.paidAt).toBeNull();

    const txRow = db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Transaction" WHERE "id" = ?`, [transaction.id]);
    expect(txRow?.deletedAt).not.toBeNull();

    const reloaded = getInstallmentPlan(db, USER_ID, plan.id);
    expect(reloaded.summary.paidCount).toBe(0);
    expect(reloaded.summary.remainingCount).toBe(1);

    // And it can be paid again after being unpaid — not left in some half-reverted state.
    const { installment: paidAgain } = payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });
    expect(paidAgain.status).toBe("PAID");
  });

  it("refuses to unpay an installment that was never paid, or one that doesn't exist", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, { title: "وام", totalAmount: 1000000, installmentAmount: 1000000, numberOfInstallments: 1, dueDay: 1 });

    expect(() => unpayInstallment(db, USER_ID, plan.installments[0].id)).toThrow("این قسط پرداخت نشده است.");
    expect(() => unpayInstallment(db, USER_ID, "does-not-exist")).toThrow("قسط پیدا نشد.");
  });

  it("deleting a plan with a paid installment leaves its transaction untouched by default", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 1000000,
      installmentAmount: 1000000,
      numberOfInstallments: 1,
      dueDay: 1,
    });
    const { transaction } = payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });

    deleteInstallmentPlan(db, USER_ID, plan.id);

    expect(() => getInstallmentPlan(db, USER_ID, plan.id)).toThrow("طرح قسط پیدا نشد.");
    const txRow = db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Transaction" WHERE "id" = ?`, [transaction.id]);
    expect(txRow?.deletedAt).toBeNull();
  });

  it("deleting a plan with deleteTransactions=true also soft-deletes its paid installments' transactions", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 1000000,
      installmentAmount: 1000000,
      numberOfInstallments: 1,
      dueDay: 1,
    });
    const { transaction } = payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });

    deleteInstallmentPlan(db, USER_ID, plan.id, true);

    const txRow = db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Transaction" WHERE "id" = ?`, [transaction.id]);
    expect(txRow?.deletedAt).not.toBeNull();
  });

  it("updates title/notes without touching the schedule", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, { title: "وام", totalAmount: 1000000, installmentAmount: 1000000, numberOfInstallments: 1, dueDay: 5 });

    const updated = updateInstallmentPlan(db, USER_ID, plan.id, { title: "وام خودرو", notes: "یادداشت" });
    expect(updated.title).toBe("وام خودرو");
    expect(updated.notes).toBe("یادداشت");
    expect(updated.installments[0].dueDate).toBe(plan.installments[0].dueDate);
  });

  const jal = (iso: string) => {
    const { jy, jm, jd } = toJalali(new Date(iso));
    return [jy, jm, jd];
  };

  it("puts every installment on the chosen Jalali day of successive Jalali months", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 3000000,
      installmentAmount: 1000000,
      numberOfInstallments: 3,
      dueDay: 2,
      startDate: fromJalali(1405, 7, 10).toISOString(),
    });
    expect(plan.dueDay).toBe(2);
    expect(plan.installments.map((i) => jal(i.dueDate))).toEqual([
      [1405, 8, 2],
      [1405, 9, 2],
      [1405, 10, 2],
    ]);
  });

  it("starts on a picked first installment date and stores its Jalali day", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 3000000,
      installmentAmount: 1000000,
      numberOfInstallments: 3,
      firstDueDate: "2026-10-05", // Mehr 13, 1405
    });
    expect(plan.dueDay).toBe(13);
    expect(jal(plan.startDate)).toEqual([1405, 7, 13]);
    expect(plan.installments.map((i) => jal(i.dueDate))).toEqual([
      [1405, 7, 13],
      [1405, 8, 13],
      [1405, 9, 13],
    ]);
  });

  it("changing dueDay re-dates only PENDING installments, leaving PAID ones' history untouched", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 2000000,
      installmentAmount: 1000000,
      numberOfInstallments: 2,
      dueDay: 5,
      startDate: fromJalali(1404, 10, 11).toISOString(),
    });
    payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });

    const updated = updateInstallmentPlan(db, USER_ID, plan.id, { dueDay: 20 });
    expect(updated.dueDay).toBe(20);
    // Installment #1 was already PAID — its due date must stay exactly as originally scheduled.
    expect(updated.installments[0].dueDate).toBe(plan.installments[0].dueDate);
    expect(jal(updated.installments[0].dueDate)).toEqual([1404, 11, 5]);
    // Installment #2 was still PENDING — it gets re-dated onto the new day of its own Jalali month.
    expect(jal(updated.installments[1].dueDate)).toEqual([1404, 12, 20]);
  });

  it("moves the reminders of a re-dated installment with it", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 1000000,
      installmentAmount: 1000000,
      numberOfInstallments: 1,
      firstDueDate: "2026-10-05",
      reminderOffsets: [1440],
    });
    db.run(`UPDATE "Reminder" SET "notified" = 1 WHERE "installmentId" = ?`, [plan.installments[0].id]);

    const updated = updateInstallmentPlan(db, USER_ID, plan.id, { firstDueDate: "2026-11-01" });
    const reminder = db.get<{ remindAt: string; notified: number }>(`SELECT "remindAt","notified" FROM "Reminder" WHERE "installmentId" = ?`, [plan.installments[0].id])!;
    expect(new Date(reminder.remindAt).getTime()).toBe(new Date(updated.installments[0].dueDate).getTime() - 1440 * 60000);
    // A reminder that had already fired for the old date is armed again for the new one.
    expect(reminder.notified).toBe(0);
  });

  it("moves the whole schedule with a new first date while nothing is paid", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, {
      title: "وام",
      totalAmount: 2000000,
      installmentAmount: 1000000,
      numberOfInstallments: 2,
      firstDueDate: "2026-10-05",
    });
    const updated = updateInstallmentPlan(db, USER_ID, plan.id, { firstDueDate: "2026-11-21" }); // Aban 30, 1405
    expect(updated.dueDay).toBe(30);
    expect(jal(updated.startDate)).toEqual([1405, 8, 30]);
    expect(updated.installments.map((i) => jal(i.dueDate))).toEqual([
      [1405, 8, 30],
      [1405, 9, 30],
    ]);
  });

  it("refuses a new first date once an installment is paid", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    const plan = createInstallmentPlan(db, USER_ID, { title: "وام", totalAmount: 2000000, installmentAmount: 1000000, numberOfInstallments: 2, dueDay: 5 });
    payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_1" });

    expect(() => updateInstallmentPlan(db, USER_ID, plan.id, { firstDueDate: "2027-01-01" })).toThrow("تاریخ اولین قسط قابل تغییر نیست");
    const after = getInstallmentPlan(db, USER_ID, plan.id);
    expect(after.installments.map((i) => i.dueDate)).toEqual(plan.installments.map((i) => i.dueDate));
  });

  it("throws a 404 for another user's plan", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, { title: "وام", totalAmount: 100, installmentAmount: 100, numberOfInstallments: 1, dueDay: 1 });
    expect(() => getInstallmentPlan(db, "someone_else", plan.id)).toThrow("طرح قسط پیدا نشد.");
  });
});
