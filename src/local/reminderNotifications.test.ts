import { beforeEach, describe, expect, it, vi } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";

const scheduled: Array<Array<{ id: string; title: string; body: string; remindAt: string }>> = [];
vi.mock("./nativeNotifications", () => ({
  syncScheduledReminderNotifications: (wanted: Array<{ id: string; title: string; body: string; remindAt: string }>) => scheduled.push(wanted),
}));

import { reconcileReminderNotifications, upcomingReminderNotifications } from "./reminderNotifications";

const USER = "u1";
const NOW = new Date("2026-09-19T10:00:00.000Z");
const T = "2026-09-01T00:00:00.000Z";

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER, "t@example.com", "h", "T", T, T]);
  return db;
}

function addEvent(db: LocalDb, id: string, title: string, deletedAt: string | null = null) {
  db.run(`INSERT INTO "Event" ("id","userId","title","startAt","endAt","createdAt","updatedAt","deletedAt") VALUES (?,?,?,?,?,?,?,?)`, [id, USER, title, "2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00.000Z", T, T, deletedAt]);
}

function addReminder(db: LocalDb, id: string, eventId: string | null, installmentId: string | null, remindAt: string, extra: { notified?: number; dismissed?: number; offsetMinutes?: number } = {}) {
  db.run(
    `INSERT INTO "Reminder" ("id","userId","targetType","eventId","installmentId","title","offsetMinutes","remindAt","notified","dismissed","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, USER, eventId ? "EVENT" : "INSTALLMENT", eventId, installmentId, `یادآوری ${id}`, extra.offsetMinutes ?? 30, remindAt, extra.notified ?? 0, extra.dismissed ?? 0, T, T]
  );
}

describe("upcomingReminderNotifications", () => {
  beforeEach(() => {
    scheduled.length = 0;
  });

  it("lists only future reminders that haven't fired or been dismissed, soonest first", async () => {
    const db = await freshDb();
    addEvent(db, "e1", "جلسه");
    addReminder(db, "later", "e1", null, "2026-09-25T09:00:00.000Z");
    addReminder(db, "sooner", "e1", null, "2026-09-20T09:00:00.000Z");
    addReminder(db, "past", "e1", null, "2026-09-18T09:00:00.000Z");
    addReminder(db, "fired", "e1", null, "2026-09-22T09:00:00.000Z", { notified: 1 });
    addReminder(db, "dismissed", "e1", null, "2026-09-23T09:00:00.000Z", { dismissed: 1 });

    expect(upcomingReminderNotifications(db, NOW).map((r) => r.id)).toEqual(["sooner", "later"]);
  });

  it("words an event reminder like the in-app bell does", async () => {
    const db = await freshDb();
    addEvent(db, "e1", "جلسه");
    addReminder(db, "r1", "e1", null, "2026-09-25T09:30:00.000Z", { offsetMinutes: 30 });
    addReminder(db, "r2", "e1", null, "2026-09-25T08:00:00.000Z", { offsetMinutes: 120 });

    const byId = Object.fromEntries(upcomingReminderNotifications(db, NOW).map((r) => [r.id, r.body]));
    expect(byId.r1).toBe("جلسه - 30 دقیقه دیگر");
    expect(byId.r2).toBe("جلسه - 2 ساعت دیگر");
  });

  it("skips reminders of a deleted event, and words an installment reminder with its amount and plan", async () => {
    const db = await freshDb();
    addEvent(db, "gone", "حذف‌شده", "2026-09-10T00:00:00.000Z");
    addReminder(db, "orphan", "gone", null, "2026-09-25T09:00:00.000Z");

    db.run(`INSERT INTO "InstallmentPlan" ("id","userId","title","totalAmount","installmentAmount","numberOfInstallments","dueDay","startDate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`, ["p1", USER, "وام خودرو", 12_000_000_000, 1_000_000_000, 12, 5, T, T, T]);
    db.run(`INSERT INTO "Installment" ("id","planId","index","dueDate","amount","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, ["i1", "p1", 1, "2026-09-26T00:00:00.000Z", 1_000_000_000, "PENDING", T, T]);
    addReminder(db, "inst", null, "i1", "2026-09-25T00:00:00.000Z");

    const list = upcomingReminderNotifications(db, NOW);
    expect(list.map((r) => r.id)).toEqual(["inst"]);
    expect(list[0].body).toBe("قسط 1,000,000,000 تومانی «وام خودرو» به زودی سررسید می‌شود.");
  });

  it("caps how many it hands to the OS", async () => {
    const db = await freshDb();
    addEvent(db, "e1", "جلسه");
    for (let i = 0; i < 5; i++) addReminder(db, `r${i}`, "e1", null, `2026-09-2${i + 1}T09:00:00.000Z`);
    expect(upcomingReminderNotifications(db, NOW, 3).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
  });
});

describe("reconcileReminderNotifications", () => {
  it("hands the current list to the native scheduler", async () => {
    scheduled.length = 0;
    const db = await freshDb();
    addEvent(db, "e1", "جلسه");
    addReminder(db, "r1", "e1", null, "2026-09-25T09:00:00.000Z");

    reconcileReminderNotifications(db, NOW);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].map((r) => r.id)).toEqual(["r1"]);
  });
});
