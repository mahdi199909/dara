import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      store.delete(key);
    }),
  },
}));

import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { drainWidgetQueue } from "./widgetQueue";
import { listActivities } from "./repositories/activities";
import { createHabit, listHabits } from "./repositories/habits";
import { extractSignals } from "../lib/captureSignals";

const USER_ID = "user_test_1";

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  const nowIso = new Date().toISOString();
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "user@example.com",
    "hash",
    "Test User",
    nowIso,
    nowIso,
  ]);
  db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
    "cat_1",
    USER_ID,
    "کار",
    nowIso,
    nowIso,
  ]);
  return db;
}

beforeEach(() => {
  store.clear();
});

describe("drainWidgetQueue", () => {
  it("does nothing when the queue is empty", async () => {
    const db = await freshDb();
    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(0);
    expect(listActivities(db, USER_ID)).toEqual([]);
  });

  it("creates an Activity + TimeEntry per queued capture, preserving the widget's exact start time", async () => {
    const db = await freshDb();
    const startedAt = "2026-08-20T10:00:00.000Z";
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "جلسه تیم", categoryId: "cat_1", durationMinutes: 90, startedAt }])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);

    const activities = listActivities(db, USER_ID);
    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe("جلسه تیم");
    expect(activities[0].categoryId).toBe("cat_1");
    expect(activities[0].totalDurationMin).toBe(90);

    const entry = db.get<{ startAt: string; durationMin: number }>(
      `SELECT "startAt","durationMin" FROM "TimeEntry" WHERE "activityId" = ?`,
      [activities[0].id]
    );
    expect(entry?.startAt).toBe(startedAt);
    expect(entry?.durationMin).toBe(90);
  });

  it("an amount-only capture (no duration named) logs zero time and creates a linked EXPENSE transaction, not a fabricated 60-minute entry", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "شکلات", categoryId: null, durationMinutes: 0, amount: 1_000_000, startedAt: "2026-08-20T10:00:00.000Z" }])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);

    const activities = listActivities(db, USER_ID);
    expect(activities).toHaveLength(1);
    expect(activities[0].title).toBe("شکلات");
    expect(activities[0].totalDurationMin).toBe(0);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "TimeEntry"`)!.n).toBe(0);

    const tx = db.get<{ type: string; amount: number; description: string }>(
      `SELECT "type","amount","description" FROM "Transaction" WHERE "activityId" = ?`,
      [activities[0].id]
    );
    expect(tx).toEqual({ type: "EXPENSE", amount: 1_000_000, description: "شکلات" });
  });

  it("a capture with both a duration and an amount logs the time AND creates the linked expense", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "ابزار پروژه", categoryId: "cat_1", durationMinutes: 90, amount: 250_000, startedAt: "2026-08-20T10:00:00.000Z" }])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);

    const activities = listActivities(db, USER_ID);
    expect(activities[0].totalDurationMin).toBe(90);
    const tx = db.get<{ amount: number }>(`SELECT "amount" FROM "Transaction" WHERE "activityId" = ?`, [activities[0].id]);
    expect(tx?.amount).toBe(250_000);
  });

  it("an explicit null amount (what an older/no-amount widget entry serializes as) behaves exactly like one with no amount field at all", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "بدون مبلغ", categoryId: null, durationMinutes: 45, amount: null, startedAt: "2026-08-20T10:00:00.000Z" }])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "Transaction"`)!.n).toBe(0);
  });

  it("rejects a malformed amount (not a number, not null, not absent) as a whole entry instead of silently coercing it", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "مبلغ خراب", categoryId: null, durationMinutes: 30, amount: "زیاد", startedAt: "2026-08-20T10:00:00.000Z" }])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(0);
    expect(listActivities(db, USER_ID)).toEqual([]);
  });

  it("clears the queue after a successful drain, and tolerates a missing categoryId", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "بدون دسته", categoryId: null, durationMinutes: 30, startedAt: "2026-08-20T09:00:00.000Z" }])
    );

    await drainWidgetQueue(db, USER_ID);
    expect(store.has("widget_pending_captures")).toBe(false);

    const activities = listActivities(db, USER_ID);
    expect(activities[0].categoryId).toBeNull();
  });

  it("drains multiple queued entries in order and ignores malformed ones", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([
        { title: "اول", categoryId: null, durationMinutes: 30, startedAt: "2026-08-20T08:00:00.000Z" },
        { title: "بد", durationMinutes: "not-a-number" },
        { title: "دوم", categoryId: "cat_1", durationMinutes: 60, startedAt: "2026-08-20T09:00:00.000Z" },
      ])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(2);
    const activities = listActivities(db, USER_ID);
    expect(activities.map((a) => a.title).sort()).toEqual(["اول", "دوم"]);
  });

  it("skips a capture with a stale categoryId instead of failing the whole drain, and keeps it queued for retry", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([
        { title: "دسته حذف‌شده", categoryId: "does-not-exist", durationMinutes: 45, startedAt: "2026-08-20T08:00:00.000Z" },
        { title: "معتبر", categoryId: "cat_1", durationMinutes: 30, startedAt: "2026-08-20T09:00:00.000Z" },
      ])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);
    const activities = listActivities(db, USER_ID);
    expect(activities.map((a) => a.title)).toEqual(["معتبر"]);

    // The failed entry must survive the drain instead of being wiped along with the succeeded
    // one — silently discarding it here is the exact bug this test now guards against.
    const remaining = JSON.parse(store.get("widget_pending_captures")!);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("دسته حذف‌شده");
  });

  it("applies a capture whole or not at all: a failure while writing its time leaves no activity behind, so the retry cannot duplicate it", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "نیمه‌کاره", categoryId: "cat_1", durationMinutes: 45, startedAt: "2026-08-20T08:00:00.000Z" }])
    );

    db.execute(`CREATE TRIGGER refuse_time BEFORE INSERT ON "TimeEntry" BEGIN SELECT RAISE(ABORT, 'injected fault'); END`);
    expect(await drainWidgetQueue(db, USER_ID)).toBe(0);
    expect(listActivities(db, USER_ID)).toEqual([]); // the activity was written first, and went with it
    expect(JSON.parse(store.get("widget_pending_captures")!)).toHaveLength(1); // still queued

    db.execute(`DROP TRIGGER refuse_time`);
    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(listActivities(db, USER_ID).map((a) => a.title)).toEqual(["نیمه‌کاره"]); // once, not twice
    expect(store.has("widget_pending_captures")).toBe(false);
  });

  it("accepts entries with an optional source field ('widget' or 'notification'), old entries without it, and rejects an invalid value", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([
        { title: "بدون source", categoryId: "cat_1", durationMinutes: 10, startedAt: "2026-08-20T07:00:00.000Z" },
        { title: "از ویجت", categoryId: "cat_1", durationMinutes: 20, startedAt: "2026-08-20T08:00:00.000Z", source: "widget" },
        { title: "از نوتیفیکیشن", categoryId: "cat_1", durationMinutes: 30, startedAt: "2026-08-20T09:00:00.000Z", source: "notification" },
        { title: "source نامعتبر", categoryId: "cat_1", durationMinutes: 40, startedAt: "2026-08-20T10:00:00.000Z", source: "bogus" },
      ])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(3);
    const activities = listActivities(db, USER_ID);
    expect(activities.map((a) => a.title).sort()).toEqual(["از نوتیفیکیشن", "از ویجت", "بدون source"]);
  });
});

describe("drainWidgetQueue — habit check-in toggles", () => {
  it("drains a single pending toggle into a real check-in", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "مدیتیشن" });
    const todayIso = new Date().toISOString();
    store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: habit.id, date: todayIso }]));

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);
    expect(store.has("widget_pending_habit_checkins")).toBe(false);

    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);
  });

  it("replays multiple queued taps on the same habit in order, netting out to the correct final state", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "ورزش" });
    const todayIso = new Date().toISOString();
    // check, uncheck, check — three widget taps queued while the app was closed should net to
    // "checked", the same as if each tap had been applied live against a real database.
    store.set(
      "widget_pending_habit_checkins",
      JSON.stringify([
        { habitId: habit.id, date: todayIso },
        { habitId: habit.id, date: todayIso },
        { habitId: habit.id, date: todayIso },
      ])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(3);
    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);
  });

  it("skips a toggle for a habit that no longer exists instead of failing the whole drain", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "نوشتن" });
    const todayIso = new Date().toISOString();
    store.set(
      "widget_pending_habit_checkins",
      JSON.stringify([
        { habitId: "does-not-exist", date: todayIso },
        { habitId: habit.id, date: todayIso },
      ])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);
    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);

    const remaining = JSON.parse(store.get("widget_pending_habit_checkins")!);
    expect(remaining).toEqual([{ habitId: "does-not-exist", date: todayIso }]);
  });

  it("ignores malformed entries and clears the queue regardless", async () => {
    const db = await freshDb();
    store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: 123 }, "not-an-object", null]));

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(0);
    expect(store.has("widget_pending_habit_checkins")).toBe(false);
  });

  it("applies a habit toggle whole or not at all: a failure after the check-in was written leaves no check-in behind", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "مطالعه", virtualAssetValuePerCheckIn: 5000 });
    store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: habit.id, date: new Date().toISOString() }]));
    const checkIns = () => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "HabitCheckIn"`)!.n;

    db.execute(`CREATE TRIGGER refuse_asset BEFORE INSERT ON "VirtualAssetEntry" BEGIN SELECT RAISE(ABORT, 'injected fault'); END`);
    expect(await drainWidgetQueue(db, USER_ID)).toBe(0);
    expect(checkIns()).toBe(0); // the check-in was written first, and went with it
    expect(JSON.parse(store.get("widget_pending_habit_checkins")!)).toHaveLength(1);

    db.execute(`DROP TRIGGER refuse_asset`);
    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(checkIns()).toBe(1);
    expect(store.has("widget_pending_habit_checkins")).toBe(false);
  });

  it("accepts an optional source field on a habit check-in entry too, old entries without it", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "آب خوردن" });
    const todayIso = new Date().toISOString();
    store.set(
      "widget_pending_habit_checkins",
      JSON.stringify([{ habitId: habit.id, date: todayIso, source: "widget" }])
    );

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(1);
    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);
  });

  it("drains queued captures and habit check-ins together in one call", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "کتاب خواندن" });
    const todayIso = new Date().toISOString();
    store.set(
      "widget_pending_captures",
      JSON.stringify([{ title: "جلسه", categoryId: null, durationMinutes: 20, startedAt: "2026-08-20T08:00:00.000Z" }])
    );
    store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: habit.id, date: todayIso }]));

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(2);
    expect(listActivities(db, USER_ID)).toHaveLength(1);
    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);
  });
});

// A line typed into the widget: the widget's parser hands over what it understood (the signals) and the
// line itself. Here the signals come from the TypeScript parser the widget's is a port of.
describe("drainWidgetQueue: lines understood by the widget", () => {
  const TYPED_AT = new Date(2026, 4, 10, 9, 0, 30); // Sunday 2026-05-10, when it was typed — the drain happens later
  const queue = (...lines: string[]) =>
    store.set(
      "widget_pending_captures",
      JSON.stringify(lines.map((text) => ({ v: 2, text, signals: extractSignals(text), startedAt: TYPED_AT.toISOString(), source: "widget" })))
    );
  const rows = <T>(db: LocalDb, sql: string, params: unknown[] = []) => db.all<T>(sql, params);

  it("saves an expense as a task with its cost — and the expense itself", async () => {
    const db = await freshDb();
    queue("شکلات یک میلیونی");

    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows(db, `SELECT "title","directCost" FROM "Task"`)).toEqual([{ title: "شکلات", directCost: 1_000_000 }]);
    expect(rows(db, `SELECT "type","amount","description" FROM "Transaction"`)).toEqual([{ type: "EXPENSE", amount: 1_000_000, description: "شکلات" }]);
    expect(store.has("widget_pending_captures")).toBe(false);
  });

  it("puts «فردا» on the day after it was typed, not the day after the app was opened", async () => {
    const db = await freshDb();
    queue("جلسه فردا ساعت ۱۰");

    await drainWidgetQueue(db, USER_ID);
    const [event] = rows<{ title: string; startAt: string }>(db, `SELECT "title","startAt" FROM "Event"`);
    const start = new Date(event.startAt);
    expect(event.title).toBe("جلسه");
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 4, 11, 10]);
  });

  it("makes an installment plan and pays one", async () => {
    const db = await freshDb();
    queue("وام ماشین ۶۰ میلیون ۱۲ ماهه");
    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows(db, `SELECT "title","totalAmount","installmentAmount","numberOfInstallments" FROM "InstallmentPlan"`)).toEqual([
      { title: "وام ماشین", totalAmount: 60_000_000, installmentAmount: 5_000_000, numberOfInstallments: 12 },
    ]);

    queue("قسط ماشین رو دادم");
    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows<{ status: string }>(db, `SELECT "status" FROM "Installment" WHERE "index" = 1`)).toEqual([{ status: "PAID" }]);
    expect(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "Transaction" WHERE "installmentId" IS NOT NULL`)[0].n).toBe(1);
  });

  it("ticks a habit off, and writes a note", async () => {
    const db = await freshDb();
    const habit = createHabit(db, USER_ID, { title: "ورزش صبحگاهی" });
    store.set(
      "widget_pending_captures",
      JSON.stringify(
        ["عادت ورزش انجام شد", "یادداشت: امروز خوب بود"].map((text) => ({ v: 2, text, signals: extractSignals(text), startedAt: new Date().toISOString() }))
      )
    );

    expect(await drainWidgetQueue(db, USER_ID)).toBe(2);
    expect(listHabits(db, USER_ID).habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);
    expect(rows(db, `SELECT "content" FROM "DailyNote"`)).toEqual([{ content: "امروز خوب بود" }]);
  });

  it("keeps a line as a plain task when what it names is gone", async () => {
    const db = await freshDb();
    queue("عادت مدیتیشن انجام شد");

    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows(db, `SELECT "title" FROM "Task"`)).toEqual([{ title: "عادت مدیتیشن" }]);
    expect(store.has("widget_pending_captures")).toBe(false);
  });

  it("keeps a line as a plain task when the app refuses what it asked for, instead of retrying it forever", async () => {
    const db = await freshDb();
    // a goal whose name is longer than a goal's name may be
    queue(`هدف ${"ماشین ".repeat(30)} ۲۰۰ میلیون`);

    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "SavingsGoal"`)[0].n).toBe(0);
    expect(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "Task"`)[0].n).toBe(1);
    expect(store.has("widget_pending_captures")).toBe(false);
  });

  it("does nothing at all for an entry that fails half-way, and leaves it queued", async () => {
    const db = await freshDb();
    queue("خرید رنگ برای پروژه اتاق");
    db.execute(`CREATE TRIGGER refuse_task BEFORE INSERT ON "Task" BEGIN SELECT RAISE(ABORT, 'injected fault'); END`);

    expect(await drainWidgetQueue(db, USER_ID)).toBe(0);
    // the project made for it was rolled back with it
    expect(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "Project"`)[0].n).toBe(0);
    expect(JSON.parse(store.get("widget_pending_captures")!)).toHaveLength(1);

    db.execute(`DROP TRIGGER refuse_task`);
    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "Project"`)[0].n).toBe(1);
    expect(rows<{ n: number }>(db, `SELECT COUNT(*) AS n FROM "Task"`)[0].n).toBe(1);
  });

  it("drops an entry whose signals are the wrong shape, and still applies the good one beside it", async () => {
    const db = await freshDb();
    store.set(
      "widget_pending_captures",
      JSON.stringify([
        { v: 2, text: "x", signals: { kind: "SELF_DESTRUCT", title: "x" }, startedAt: TYPED_AT.toISOString() },
        { v: 2, text: "کار خوب", signals: extractSignals("کار خوب"), startedAt: TYPED_AT.toISOString() },
      ])
    );

    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(rows(db, `SELECT "title" FROM "Task"`)).toEqual([{ title: "کار خوب" }]);
  });

  it("an entry from before the widget sent signals is still an Activity", async () => {
    const db = await freshDb();
    store.set("widget_pending_captures", JSON.stringify([{ title: "قدیمی", categoryId: null, durationMinutes: 30, startedAt: "2026-08-20T10:00:00.000Z" }]));

    expect(await drainWidgetQueue(db, USER_ID)).toBe(1);
    expect(listActivities(db, USER_ID).map((a) => a.title)).toEqual(["قدیمی"]);
  });
});
