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
  });

  it("ignores malformed entries and clears the queue regardless", async () => {
    const db = await freshDb();
    store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: 123 }, "not-an-object", null]));

    const count = await drainWidgetQueue(db, USER_ID);
    expect(count).toBe(0);
    expect(store.has("widget_pending_habit_checkins")).toBe(false);
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
