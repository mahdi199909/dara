import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createHabit, updateHabit, deleteHabit, toggleHabitCheckIn, logHabitCheckInDuration, listHabits } from "./habits";

const USER_ID = "user_habit_1";
const now = () => new Date().toISOString();

function freshDb(): LocalDb {
  resetLocalDbForTests();
  const db = openLocalDb(createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "habit@example.com",
    "hash",
    "Habit Tester",
    now(),
    now(),
  ]);
  return db;
}

function insertUser(db: LocalDb, id: string) {
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    id,
    `${id}@example.com`,
    "hash",
    id,
    now(),
    now(),
  ]);
}

describe("local habits repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a habit with the same defaults as the web route", () => {
    const db = freshDb();
    const habit = createHabit(db, USER_ID, { title: "مدیتیشن" });

    expect(habit.title).toBe("مدیتیشن");
    expect(habit.color).toBe("#3a8d80");
    expect(habit.isActive).toBe(true);
    expect(habit.isTrial).toBe(false);
    expect(habit.virtualAssetValuePerCheckIn).toBe(0);
    expect(habit.category).toBeNull();
    expect(habit.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("updates fields and resets createdAt when a trial habit is promoted", () => {
    const db = freshDb();
    const habit = createHabit(db, USER_ID, { title: "عادت آزمایشی", isTrial: true });
    expect(habit.isTrial).toBe(true);
    expect(habit.trialStartDate).not.toBeNull();

    const renamed = updateHabit(db, USER_ID, habit.id, { title: "عادت آزمایشی ۲" });
    expect(renamed.title).toBe("عادت آزمایشی ۲");
    expect(renamed.createdAt).toBe(habit.createdAt); // plain update must not touch createdAt

    const promoted = updateHabit(db, USER_ID, habit.id, { isTrial: false });
    expect(promoted.isTrial).toBe(false);
    expect(promoted.createdAt).not.toBe(habit.createdAt); // promotion resets createdAt
  });

  it("soft-deletes a habit so it no longer appears in listHabits", () => {
    const db = freshDb();
    const habit = createHabit(db, USER_ID, { title: "عادت موقت" });
    deleteHabit(db, USER_ID, habit.id);

    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)).toBeUndefined();
  });

  it("toggles a check-in on then off for today, cleaning up its virtual asset entry on uncheck", () => {
    const db = freshDb();
    const habit = createHabit(db, USER_ID, { title: "ورزش", virtualAssetValuePerCheckIn: 200 });

    expect(toggleHabitCheckIn(db, USER_ID, habit.id)).toEqual({ checkedIn: true });
    const { habits } = listHabits(db, USER_ID);
    expect(habits.find((h) => h.id === habit.id)?.checkedInToday).toBe(true);
    const vaAfterCheckIn = db.get(`SELECT * FROM "VirtualAssetEntry" WHERE "userId" = ?`, [USER_ID]);
    expect(vaAfterCheckIn).toBeTruthy();

    expect(toggleHabitCheckIn(db, USER_ID, habit.id)).toEqual({ checkedIn: false });
    const { habits: habitsAfter } = listHabits(db, USER_ID);
    expect(habitsAfter.find((h) => h.id === habit.id)?.checkedInToday).toBe(false);
    const vaAfterUncheck = db.get(`SELECT * FROM "VirtualAssetEntry" WHERE "userId" = ?`, [USER_ID]);
    expect(vaAfterUncheck).toBeUndefined();
  });

  it("logging a duration feeds a VirtualAssetEntry combining the flat and time-based value when the category has an hourly rate", () => {
    const db = freshDb();
    db.run(
      `INSERT INTO "Category" ("id","userId","name","generatesVirtualAsset","virtualAssetValuePerHour","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      ["cat_va", USER_ID, "یادگیری", 1, 6000, now(), now()]
    );
    const habit = createHabit(db, USER_ID, { title: "مطالعه", categoryId: "cat_va", virtualAssetValuePerCheckIn: 500 });

    const { checkIn } = logHabitCheckInDuration(db, USER_ID, habit.id, { durationMin: 30 });
    expect(checkIn.durationMin).toBe(30);

    const entry = db.get<{ totalValue: number; durationMin: number; valuePerHour: number }>(
      `SELECT * FROM "VirtualAssetEntry" WHERE "habitCheckInId" = ?`,
      [checkIn.id]
    );
    // 30 min at 6000/hour = 3000, plus the flat 500-per-check-in value = 3500.
    expect(entry?.totalValue).toBe(3500);
    expect(entry?.valuePerHour).toBe(6000);
    expect(entry?.durationMin).toBe(30);
  });

  it("computes the current streak and per-habit adherence across a few days of check-ins", () => {
    const db = freshDb();
    const habit = createHabit(db, USER_ID, { title: "آب خوردن" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Backdate createdAt so all 3 days are "eligible" for the streak — a habit is only
    // counted on days on/after its own creation (see computeAdherenceSeries).
    const threeDaysAgo = new Date(today.getTime() - 2 * 86_400_000);
    db.run(`UPDATE "Habit" SET "createdAt" = ? WHERE "id" = ?`, [threeDaysAgo.toISOString(), habit.id]);

    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getTime() - i * 86_400_000);
      toggleHabitCheckIn(db, USER_ID, habit.id, { date: d.toISOString() });
    }

    const { currentStreak, habits } = listHabits(db, USER_ID);
    expect(currentStreak).toBe(3);
    const state = habits.find((h) => h.id === habit.id)!;
    expect(state.checkedInToday).toBe(true);
    expect(state.daysSinceLastCheckIn).toBe(0);
  });

  it("throws a 404 ApiError for a habit belonging to another user", () => {
    const db = freshDb();
    insertUser(db, "someone_else");
    const habit = createHabit(db, USER_ID, { title: "عادت" });

    expect(() => updateHabit(db, "someone_else", habit.id, { title: "دستکاری" })).toThrow("عادت پیدا نشد.");
    expect(() => deleteHabit(db, "someone_else", habit.id)).toThrow("عادت پیدا نشد.");
    expect(() => toggleHabitCheckIn(db, "someone_else", habit.id)).toThrow("عادت پیدا نشد.");
    expect(() => logHabitCheckInDuration(db, "someone_else", habit.id, { durationMin: 10 })).toThrow("عادت پیدا نشد.");

    const { habits } = listHabits(db, "someone_else");
    expect(habits).toHaveLength(0);
  });
});
