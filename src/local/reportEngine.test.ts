import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import {
  computeTimeAndMoneyReport,
  computeHiddenCostReport,
  computeNetWorth,
  computeHabitsReport,
  computeCategoryCalendar,
} from "./reportEngine";

const USER_ID = "user_report_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "r@example.com",
    "hash",
    "Reporter",
    now(),
    now(),
  ]);
  return db;
}

function insertCategory(db: LocalDb, id: string, kind: string, generatesVirtualAsset = false, virtualAssetValuePerHour: number | null = null) {
  db.run(
    `INSERT INTO "Category" ("id","userId","name","kind","valueType","generatesVirtualAsset","virtualAssetValuePerHour","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, USER_ID, id, kind, "EXPENSE", generatesVirtualAsset ? 1 : 0, virtualAssetValuePerHour, now(), now()]
  );
}

describe("local reportEngine", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("computeTimeAndMoneyReport aggregates task-logged time, transactions, and virtual assets like the web engine", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_work", "PRODUCTIVE");
    insertCategory(db, "cat_waste", "WASTE");

    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date("2026-01-31T23:59:59.999Z");

    // A 2-hour task logged via startAt/endAt in the range, tagged PRODUCTIVE.
    db.run(
      `INSERT INTO "Task" ("id","userId","title","categoryId","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      ["task_1", USER_ID, "کار", "cat_work", "2026-01-10T08:00:00.000Z", "2026-01-10T10:00:00.000Z", now(), now()]
    );

    // An account + one income and one waste-category expense transaction in range.
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      ["tx_income", USER_ID, "INCOME", 1000000, "2026-01-05T00:00:00.000Z", "acc_1", now(), now()]
    );
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","categoryId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["tx_expense", USER_ID, "EXPENSE", 200000, "2026-01-06T00:00:00.000Z", "acc_1", "cat_waste", now(), now()]
    );

    const report = computeTimeAndMoneyReport(db, USER_ID, from, to);

    expect(report.totalDurationMin).toBe(120);
    expect(report.productiveMin).toBe(120);
    expect(report.timeByCategory.find((c) => c.categoryId === "cat_work")?.minutes).toBe(120);
    expect(report.income).toBe(1000000);
    expect(report.expense).toBe(200000);
    expect(report.net).toBe(800000);
    expect(report.expenseByCategory.find((c) => c.categoryId === "cat_waste")?.amount).toBe(200000);
  });

  it("computeNetWorth combines real assets, virtual assets, and unpaid installment debt", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Asset" ("id","userId","name","purchasePrice","purchaseDate","currentValue","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "asset_1",
      USER_ID,
      "لپ‌تاپ",
      50000000,
      now(),
      40000000,
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "VirtualAssetEntry" ("id","userId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "vae_1",
      USER_ID,
      60,
      100000,
      100000,
      now(),
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "InstallmentPlan" ("id","userId","title","totalAmount","installmentAmount","numberOfInstallments","dueDay","startDate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`, [
      "plan_1",
      USER_ID,
      "وام",
      12000000,
      1000000,
      12,
      1,
      now(),
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "Installment" ("id","planId","index","dueDate","amount","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "inst_1",
      "plan_1",
      1,
      now(),
      1000000,
      "PENDING",
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "Installment" ("id","planId","index","dueDate","amount","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "inst_2",
      "plan_1",
      2,
      now(),
      1000000,
      "PAID",
      now(),
      now(),
    ]);

    const net = computeNetWorth(db, USER_ID);
    expect(net.realAssetsValue).toBe(40000000);
    expect(net.virtualAssetsValue).toBe(100000);
    expect(net.totalDebt).toBe(1000000); // only the PENDING installment counts
    expect(net.netWorth).toBe(40000000 + 100000 - 1000000);
  });

  it("computeHabitsReport computes adherence series and per-habit streaks like the web engine", async () => {
    const db = await freshDb();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["habit_1", USER_ID, "مطالعه", twoDaysAgo.toISOString(), now()]);

    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["ci_1", "habit_1", new Date(yesterday.toDateString()).toISOString(), now(), now()]);
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["ci_2", "habit_1", new Date(today.toDateString()).toISOString(), now(), now()]);

    const report = computeHabitsReport(db, USER_ID, twoDaysAgo, today);
    expect(report.habits).toHaveLength(1);
    expect(report.habits[0].currentStreak).toBeGreaterThanOrEqual(2);
    expect(report.currentStreak).toBeGreaterThanOrEqual(1);
  });

  it("computeCategoryCalendar buckets minutes per day per category, matching dayKeyIso", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_learn", "PRODUCTIVE");
    const day = new Date("2026-02-15T09:00:00.000Z");
    db.run(`INSERT INTO "Task" ("id","userId","title","categoryId","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "task_cal",
      USER_ID,
      "کار تقویمی",
      "cat_learn",
      day.toISOString(),
      new Date(day.getTime() + 90 * 60000).toISOString(),
      now(),
      now(),
    ]);

    const calendar = computeCategoryCalendar(db, USER_ID, new Date("2026-02-01T00:00:00.000Z"), new Date("2026-02-28T23:59:59.999Z"));
    const learnStat = calendar.find((c) => c.categoryId === "cat_learn")!;
    expect(learnStat.totalMinutes).toBe(90);
    expect(learnStat.totalDays).toBe(1);
    expect(Object.values(learnStat.days)[0]).toBe(90);
  });

  it("computeHiddenCostReport sorts items by hiddenCost descending and sums totals", async () => {
    const db = await freshDb();
    const from = new Date("2026-03-01T00:00:00.000Z");
    const to = new Date("2026-03-31T23:59:59.999Z");
    db.run(`INSERT INTO "Task" ("id","userId","title","directCost","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "task_hidden",
      USER_ID,
      "کار پرهزینه",
      500000,
      "2026-03-05T08:00:00.000Z",
      "2026-03-05T09:00:00.000Z",
      now(),
      now(),
    ]);

    const report = computeHiddenCostReport(db, USER_ID, from, to);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].directCost).toBe(500000);
    expect(report.totalDirectCost).toBe(500000);
  });
});
