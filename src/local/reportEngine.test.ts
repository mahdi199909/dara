import { describe, expect, it, beforeEach, vi } from "vitest";

const preferencesStore = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: preferencesStore.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      preferencesStore.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      preferencesStore.delete(key);
    }),
  },
}));

import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import {
  computeTimeAndMoneyReport,
  computeHiddenCostReport,
  computeNetWorth,
  computeHabitsReport,
  computeCategoryCalendar,
  computeFounderCapital,
  computeUpgradeEffect,
  comparePeriods,
  recordDailyCapitalSnapshot,
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
    preferencesStore.clear();
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

  describe("computeFounderCapital", () => {
    it("returns all zeros and a null firstRecordAt for a user with no records", async () => {
      const db = await freshDb();
      const capital = computeFounderCapital(db, USER_ID);
      expect(capital).toEqual({
        investedMinutes: 0,
        virtualAssetValue: 0,
        skillCount: 0,
        projectCount: 0,
        assetCount: 0,
        firstRecordAt: null,
        todayDeltaMinutes: 0,
        monthDeltaMinutes: 0,
      });
    });

    it("counts habit check-in minutes regardless of the habit's category (habit-only user)", async () => {
      const db = await freshDb();
      insertCategory(db, "cat_waste", "WASTE"); // deliberately not PRODUCTIVE — habit minutes should still count
      db.run(`INSERT INTO "Habit" ("id","userId","categoryId","title","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "habit_1",
        USER_ID,
        "cat_waste",
        "مطالعه",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","durationMin","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "ci_1",
        "habit_1",
        now(),
        30,
        now(),
        now(),
      ]);

      const capital = computeFounderCapital(db, USER_ID);
      expect(capital.investedMinutes).toBe(30);
      expect(capital.firstRecordAt).not.toBeNull();
    });

    it("counts TimeEntry minutes only under a PRODUCTIVE category (activity-only user)", async () => {
      const db = await freshDb();
      insertCategory(db, "cat_prod", "PRODUCTIVE");
      insertCategory(db, "cat_waste", "WASTE");
      db.run(`INSERT INTO "Activity" ("id","userId","categoryId","title","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "a_prod",
        USER_ID,
        "cat_prod",
        "کدنویسی",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","durationMin","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
        "te_prod",
        "a_prod",
        now(),
        60,
        0,
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "Activity" ("id","userId","categoryId","title","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "a_waste",
        USER_ID,
        "cat_waste",
        "شبکه اجتماعی",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","durationMin","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
        "te_waste",
        "a_waste",
        now(),
        45,
        0,
        now(),
        now(),
      ]);

      const capital = computeFounderCapital(db, USER_ID);
      expect(capital.investedMinutes).toBe(60); // only the PRODUCTIVE-category activity counts
    });

    it("combines activity, habit, and project-task minutes, and counts skills/projects/assets from real rows", async () => {
      const db = await freshDb();
      insertCategory(db, "cat_prod", "PRODUCTIVE");
      db.run(`INSERT INTO "Activity" ("id","userId","categoryId","title","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "a1",
        USER_ID,
        "cat_prod",
        "کدنویسی",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","durationMin","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
        "te1",
        "a1",
        now(),
        60,
        0,
        now(),
        now(),
      ]);

      db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["habit_1", USER_ID, "مطالعه", now(), now()]);
      db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","durationMin","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "ci_1",
        "habit_1",
        now(),
        20,
        now(),
        now(),
      ]);

      db.run(`INSERT INTO "Project" ("id","userId","name","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "proj_done",
        USER_ID,
        "پروژه تمام‌شده",
        "COMPLETED",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "Project" ("id","userId","name","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "proj_active",
        USER_ID,
        "پروژه فعال",
        "ACTIVE",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "Task" ("id","userId","projectId","title","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
        "task_1",
        USER_ID,
        "proj_active",
        "کار پروژه",
        "2026-01-01T09:00:00.000Z",
        "2026-01-01T09:40:00.000Z",
        now(),
        now(),
      ]);

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

      db.run(
        `INSERT INTO "VirtualAssetEntry" ("id","userId","categoryId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
        ["va_1", USER_ID, "cat_prod", 60, 100000, 100000, now(), now(), now()]
      );

      const capital = computeFounderCapital(db, USER_ID);
      expect(capital.investedMinutes).toBe(60 + 20 + 40); // activity + habit + project-task
      expect(capital.virtualAssetValue).toBe(100000);
      expect(capital.skillCount).toBe(1); // one distinct category with a virtual asset entry
      expect(capital.projectCount).toBe(1); // only the COMPLETED project counts
      expect(capital.assetCount).toBe(1);
      expect(capital.firstRecordAt).not.toBeNull();
    });

    it("investedMinutes and virtualAssetValue only increase as more records are added (monotonic accumulation)", async () => {
      const db = await freshDb();
      insertCategory(db, "cat_prod", "PRODUCTIVE");
      db.run(`INSERT INTO "Activity" ("id","userId","categoryId","title","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "a1",
        USER_ID,
        "cat_prod",
        "کدنویسی",
        now(),
        now(),
      ]);

      let previous = computeFounderCapital(db, USER_ID);
      expect(previous.investedMinutes).toBe(0);

      for (let i = 0; i < 5; i++) {
        db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","durationMin","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
          `te_${i}`,
          "a1",
          now(),
          10,
          0,
          now(),
          now(),
        ]);
        db.run(
          `INSERT INTO "VirtualAssetEntry" ("id","userId","categoryId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
          [`va_${i}`, USER_ID, "cat_prod", 10, 50000, 5000, now(), now(), now()]
        );

        const current = computeFounderCapital(db, USER_ID);
        expect(current.investedMinutes).toBeGreaterThan(previous.investedMinutes);
        expect(current.virtualAssetValue).toBeGreaterThan(previous.virtualAssetValue);
        previous = current;
      }
    });
  });

  describe("computeUpgradeEffect", () => {
    function insertSettings(db: LocalDb, hourlyValueOverride: number | null = 50000) {
      db.run(`INSERT INTO "Settings" ("id","userId","hourlyValueOverride","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
        "settings_1",
        USER_ID,
        hourlyValueOverride,
        now(),
        now(),
      ]);
    }

    function insertEntry(db: LocalDb, id: string, opts: { categoryId?: string; projectId?: string; durationMin: number; totalValue: number }) {
      db.run(
        `INSERT INTO "VirtualAssetEntry" ("id","userId","categoryId","projectId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, USER_ID, opts.categoryId ?? null, opts.projectId ?? null, opts.durationMin, 50000, opts.totalValue, now(), now(), now()]
      );
    }

    it("attributes the entry to its category, summing durationMin/totalValue across every entry in that category (not just this one)", async () => {
      const db = await freshDb();
      insertSettings(db);
      insertCategory(db, "cat_skill", "PRODUCTIVE");
      insertEntry(db, "va_old", { categoryId: "cat_skill", durationMin: 300, totalValue: 250000 });
      insertEntry(db, "va_new", { categoryId: "cat_skill", durationMin: 120, totalValue: 100000 });

      const effect = computeUpgradeEffect(db, USER_ID, "va_new");

      expect(effect).not.toBeNull();
      expect(effect!.label).toBe("cat_skill");
      expect(effect!.addedMinutes).toBe(120);
      expect(effect!.addedValue).toBe(100000);
      expect(effect!.categoryTotalMinutes).toBe(420);
      expect(effect!.categoryTotalValue).toBe(350000);
      expect(effect!.previousHourlyValue).toBe(effect!.newHourlyValue);
    });

    it("attributes the entry to its project when categoryId is unset", async () => {
      const db = await freshDb();
      insertSettings(db);
      db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["proj_1", USER_ID, "پروژه‌ی الف", now(), now()]);
      insertEntry(db, "va_proj", { projectId: "proj_1", durationMin: 600, totalValue: 500000 });

      const effect = computeUpgradeEffect(db, USER_ID, "va_proj");

      expect(effect).not.toBeNull();
      expect(effect!.label).toBe("پروژه‌ی الف");
      expect(effect!.categoryTotalMinutes).toBe(600);
      expect(effect!.categoryTotalValue).toBe(500000);
    });

    it("returns null rather than inventing a label when the entry has neither a category nor a project", async () => {
      const db = await freshDb();
      insertSettings(db);
      insertEntry(db, "va_orphan", { durationMin: 60, totalValue: 50000 });

      expect(computeUpgradeEffect(db, USER_ID, "va_orphan")).toBeNull();
    });

    it("throws rather than reporting another user's entry", async () => {
      const db = await freshDb();
      insertSettings(db);
      insertCategory(db, "cat_skill", "PRODUCTIVE");
      insertEntry(db, "va_1", { categoryId: "cat_skill", durationMin: 60, totalValue: 50000 });

      expect(() => computeUpgradeEffect(db, "someone_else", "va_1")).toThrow();
    });

    describe("milestone boundaries", () => {
      it("reports the next unreached threshold when the total sits just under it", async () => {
        const db = await freshDb();
        insertSettings(db);
        insertCategory(db, "cat_skill", "PRODUCTIVE");
        insertEntry(db, "va_1", { categoryId: "cat_skill", durationMin: 599, totalValue: 1 });

        expect(computeUpgradeEffect(db, USER_ID, "va_1")!.nextMilestoneMinutes).toBe(600);
      });

      it("advances to the following threshold once the current one is exactly reached", async () => {
        const db = await freshDb();
        insertSettings(db);
        insertCategory(db, "cat_skill", "PRODUCTIVE");
        insertEntry(db, "va_1", { categoryId: "cat_skill", durationMin: 600, totalValue: 1 });

        expect(computeUpgradeEffect(db, USER_ID, "va_1")!.nextMilestoneMinutes).toBe(1500);
      });

      it("returns null once past the highest (500h) threshold, rather than inventing a further milestone", async () => {
        const db = await freshDb();
        insertSettings(db);
        insertCategory(db, "cat_skill", "PRODUCTIVE");
        insertEntry(db, "va_1", { categoryId: "cat_skill", durationMin: 30000, totalValue: 1 });

        expect(computeUpgradeEffect(db, USER_ID, "va_1")!.nextMilestoneMinutes).toBeNull();
      });
    });
  });

  describe("comparePeriods", () => {
    it("computes delta as current-minus-previous for each metric", async () => {
      const db = await freshDb();
      insertCategory(db, "cat_work", "PRODUCTIVE");
      db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);

      // Previous period lands in (2026-01-03T23:59:59.999Z, 2026-01-07T23:59:59.999Z].
      db.run(`INSERT INTO "Task" ("id","userId","title","categoryId","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
        "task_prev",
        USER_ID,
        "کار قبلی",
        "cat_work",
        "2026-01-05T08:00:00.000Z",
        "2026-01-05T08:40:00.000Z",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
        "tx_prev",
        USER_ID,
        "EXPENSE",
        30000,
        "2026-01-05T09:00:00.000Z",
        "acc_1",
        now(),
        now(),
      ]);

      // Current period: [2026-01-08T00:00:00.000Z, 2026-01-12T00:00:00.000Z).
      db.run(`INSERT INTO "Task" ("id","userId","title","categoryId","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
        "task_cur",
        USER_ID,
        "کار جدید",
        "cat_work",
        "2026-01-09T08:00:00.000Z",
        "2026-01-09T09:00:00.000Z",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
        "tx_cur",
        USER_ID,
        "EXPENSE",
        50000,
        "2026-01-09T09:00:00.000Z",
        "acc_1",
        now(),
        now(),
      ]);

      const from = new Date("2026-01-08T00:00:00.000Z");
      const to = new Date("2026-01-12T00:00:00.000Z");
      const result = comparePeriods(db, USER_ID, from, to);

      expect(result.current.totalDurationMin).toBe(60);
      expect(result.previous.totalDurationMin).toBe(40);
      expect(result.delta.totalMinutes).toBe(20);
      expect(result.current.expense).toBe(50000);
      expect(result.previous.expense).toBe(30000);
      expect(result.delta.expense).toBe(20000);
    });

    describe("hasEnoughHistory", () => {
      const from = new Date("2026-01-08T00:00:00.000Z");
      const to = new Date("2026-01-12T00:00:00.000Z"); // 4-day period -> previous is also 4 days

      async function dbWithHabit(): Promise<LocalDb> {
        const db = await freshDb();
        db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["habit_1", USER_ID, "عادت", now(), now()]);
        return db;
      }
      function checkIn(db: LocalDb, id: string, dateIso: string) {
        db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [id, "habit_1", dateIso, now(), now()]);
      }

      it("is false with no previous-period activity at all", async () => {
        const db = await dbWithHabit();
        expect(comparePeriods(db, USER_ID, from, to).hasEnoughHistory).toBe(false);
      });

      it("is false when activity covers fewer than half the previous period's days", async () => {
        const db = await dbWithHabit();
        checkIn(db, "ci_1", "2026-01-04T12:00:00.000Z"); // 1 of 4 days
        expect(comparePeriods(db, USER_ID, from, to).hasEnoughHistory).toBe(false);
      });

      it("is true at exactly the 50% boundary", async () => {
        const db = await dbWithHabit();
        checkIn(db, "ci_1", "2026-01-04T12:00:00.000Z");
        checkIn(db, "ci_2", "2026-01-05T12:00:00.000Z"); // 2 of 4 days
        expect(comparePeriods(db, USER_ID, from, to).hasEnoughHistory).toBe(true);
      });

      it("is true when the previous period is well-covered", async () => {
        const db = await dbWithHabit();
        checkIn(db, "ci_1", "2026-01-04T12:00:00.000Z");
        checkIn(db, "ci_2", "2026-01-05T12:00:00.000Z");
        checkIn(db, "ci_3", "2026-01-06T12:00:00.000Z");
        checkIn(db, "ci_4", "2026-01-07T12:00:00.000Z"); // 4 of 4 days
        expect(comparePeriods(db, USER_ID, from, to).hasEnoughHistory).toBe(true);
      });
    });
  });

  describe("recordDailyCapitalSnapshot — widget_capital_summary", () => {
    it("writes today's and lifetime invested hours for CapitalWidgetProvider to read, rounded to whole hours", async () => {
      const db = await freshDb();
      insertCategory(db, "cat_prod", "PRODUCTIVE");
      db.run(`INSERT INTO "Activity" ("id","userId","categoryId","title","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
        "a1",
        USER_ID,
        "cat_prod",
        "کدنویسی",
        now(),
        now(),
      ]);
      db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","durationMin","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
        "te_1",
        "a1",
        now(),
        150, // 2.5h, today — rounds to 3h
        0,
        now(),
        now(),
      ]);

      recordDailyCapitalSnapshot(db, USER_ID);

      const raw = preferencesStore.get("widget_capital_summary");
      expect(raw).toBeDefined();
      const summary = JSON.parse(raw!);
      expect(summary.investedHoursToday).toBe(3);
      expect(summary.investedHoursTotal).toBe(3);
      expect(typeof summary.updatedAt).toBe("string");
    });

    it("never blocks or fails the snapshot itself when writing the widget summary", async () => {
      const db = await freshDb();
      expect(() => recordDailyCapitalSnapshot(db, USER_ID)).not.toThrow();
      const capital = recordDailyCapitalSnapshot(db, USER_ID);
      expect(capital.investedMinutes).toBe(0);
      expect(JSON.parse(preferencesStore.get("widget_capital_summary")!).investedHoursTotal).toBe(0);
    });
  });
});
