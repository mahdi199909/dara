import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createTask } from "./tasks";
import { createEvent } from "./events";
import { createNote } from "./notes";
import { createInstallmentPlan } from "./installments";
import { search } from "./search";
import type { NoteSearchResult, PlanSearchResult, StatsSearchResult, TimedSearchResult } from "@/lib/searchEngine";

const USER_ID = "user_search_1";
const now = () => new Date().toISOString();
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  for (const [id, email] of [
    [USER_ID, "s@example.com"],
    ["someone_else", "o@example.com"],
  ]) {
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [id, email, "hash", id, now(), now()]);
  }
  return db;
}

describe("local search", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("finds matching tasks/projects across entities and ignores other users' data", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t1", USER_ID, "خرید نان", now(), now()]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t2", "someone_else", "خرید نان", now(), now()]);
    db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["p1", USER_ID, "پروژه نان‌پزی", now(), now()]);

    const results = search(db, USER_ID, "نان");
    expect(results.map((r) => r.type).sort()).toEqual(["PROJECT", "TASK"]);
    expect(results.find((r) => r.type === "TASK")?.id).toBe("t1");
  });

  it("returns an empty array for an empty/whitespace query", async () => {
    const db = await freshDb();
    expect(search(db, USER_ID, "")).toEqual([]);
    expect(search(db, USER_ID, "   ")).toEqual([]);
    expect(search(db, USER_ID, undefined)).toEqual([]);
  });

  it("finds a title however it is spelled: Arabic letters, no half-space, Persian digits", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "می‌خوانم کتاب ۱۲" });
    expect(search(db, USER_ID, "میخوانم")).toHaveLength(1);
    expect(search(db, USER_ID, "كتاب")).toHaveLength(1);
    expect(search(db, USER_ID, "12")).toHaveLength(1);
  });

  it("gives a task its day, hours, length, hidden cost and money, and links to that day", async () => {
    const db = await freshDb();
    db.run(`UPDATE "Settings" SET "hourlyValueOverride" = 120000 WHERE "userId" = ?`, [USER_ID]);
    db.run(`INSERT INTO "Settings" ("id","userId","hourlyValueOverride","updatedAt") SELECT 's1', ?, 120000, ? WHERE NOT EXISTS (SELECT 1 FROM "Settings" WHERE "userId" = ?)`, [USER_ID, now(), USER_ID]);
    const task = createTask(db, USER_ID, { title: "مطالعه کتاب", startAt: at(21, 9), endAt: at(21, 10, 30), directCost: 50_000, status: "DONE" });

    const [result] = search(db, USER_ID, "مطالعه") as TimedSearchResult[];
    expect(result.type).toBe("TASK");
    expect(result.id).toBe(task.id);
    expect(result.day).toBe("2026-09-21");
    expect(result.durationMin).toBe(90);
    expect(result.done).toBe(true);
    expect(result.directCost).toBe(50_000);
    expect(result.timeCost).toBe(180_000);
    expect(result.hiddenCost).toBe(230_000);
    expect(result.href).toBe(`/calendar?day=2026-09-21&item=${task.id}`);
  });

  it("finds events and marks the ones that were completed", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, { title: "جلسه تیم", startAt: at(21, 14), endAt: at(21, 15) }) as { id: string };
    db.run(`INSERT INTO "EventCompletion" ("id","eventId","occurrenceDate","createdAt") VALUES (?,?,?,?)`, ["c1", event.id, at(21, 14), now()]);

    const [result] = search(db, USER_ID, "جلسه") as TimedSearchResult[];
    expect(result).toMatchObject({ type: "EVENT", day: "2026-09-21", durationMin: 60, done: true });
  });

  it("finds a note by what is inside it and links to its day", async () => {
    const db = await freshDb();
    const note = createNote(db, USER_ID, { day: "2026-09-21", content: "امروز درباره‌ی هزینه پنهان حرف زدیم" });
    createNote(db, "someone_else", { day: "2026-09-21", content: "هزینه پنهان دیگران" });

    const results = search(db, USER_ID, "هزینه پنهان") as NoteSearchResult[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "NOTE", id: note.id, day: "2026-09-21", href: `/calendar?day=2026-09-21&item=${note.id}` });
    expect(results[0].snippet).toContain("هزینه پنهان");
  });

  it("counts the days done and time spent for a habit and for its category", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","icon","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, ["cat1", USER_ID, "یادگیری", "📚", now(), now()]);
    db.run(`INSERT INTO "Habit" ("id","userId","title","categoryId","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, ["h1", USER_ID, "مطالعه یادگیری", "cat1", now(), now()]);
    for (const [id, day, minutes] of [
      ["ci1", 10, 30],
      ["ci2", 11, 45],
    ] as const) {
      db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","durationMin","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [id, "h1", at(day, 0), minutes, now(), now()]);
    }
    createTask(db, USER_ID, { title: "دوره آنلاین", categoryId: "cat1", startAt: at(12, 9), endAt: at(12, 10) });

    const results = search(db, USER_ID, "یادگیری") as StatsSearchResult[];
    const habit = results.find((r) => r.type === "HABIT")!;
    const category = results.find((r) => r.type === "CATEGORY")!;
    expect(habit).toMatchObject({ doneDays: 2, totalMinutes: 75, lastDay: "2026-09-11" });
    expect(habit.href).toBe("/reports?tab=categoryCalendar&category=cat1&day=2026-09-11");
    // the category holds the habit's 75 minutes on 2 days plus the task's hour on a third
    expect(category).toMatchObject({ doneDays: 3, totalMinutes: 135, lastDay: "2026-09-12" });
    expect(category.href).toBe("/reports?tab=categoryCalendar&category=cat1&day=2026-09-12");
  });

  it("summarises an installment plan: total, paid, unpaid, and the nearest due date", async () => {
    const db = await freshDb();
    const plan = createInstallmentPlan(db, USER_ID, { title: "وام خودرو", totalAmount: 3_000_000, installmentAmount: 1_000_000, numberOfInstallments: 3, firstDueDate: "2026-10-05" });
    db.run(`UPDATE "Installment" SET "status" = 'PAID' WHERE "planId" = ? AND "index" = 1`, [plan.id]);

    const [result] = search(db, USER_ID, "وام") as PlanSearchResult[];
    expect(result).toMatchObject({ type: "INSTALLMENT", id: plan.id, totalAmount: 3_000_000, paidAmount: 1_000_000, unpaidAmount: 2_000_000, paidCount: 1, totalCount: 3 });
    expect(new Date(result.nextDueDate!).getTime()).toBe(new Date(plan.installments[1].dueDate).getTime());
  });
});
