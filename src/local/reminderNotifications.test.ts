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

    addReminder(db, "r3", "e1", null, "2026-09-25T10:00:00.000Z", { offsetMinutes: 0 });

    const byId = Object.fromEntries(upcomingReminderNotifications(db, NOW).map((r) => [r.id, r.body]));
    expect(byId.r1).toBe("جلسه - 30 دقیقه دیگر");
    expect(byId.r2).toBe("جلسه - 2 ساعت دیگر");
    expect(byId.r3).toBe("جلسه - همین الان");
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

  describe("installment reminders", () => {
    async function withInstallment(status: "PENDING" | "PAID") {
      const db = await freshDb();
      db.run(`INSERT INTO "InstallmentPlan" ("id","userId","title","totalAmount","installmentAmount","numberOfInstallments","dueDay","startDate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`, ["p1", USER, "وام", 3_000_000, 1_000_000, 3, 5, T, T, T]);
      // Due dates are the local midnight of their day; «1 روز قبل» is therefore the midnight before it.
      db.run(`INSERT INTO "Installment" ("id","planId","index","dueDate","amount","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, ["i1", "p1", 1, new Date(2026, 8, 26).toISOString(), 1_000_000, status, T, T]);
      addReminder(db, "inst", null, "i1", new Date(2026, 8, 25).toISOString(), { offsetMinutes: 1440 });
      return db;
    }

    it("rings at 09:00 of the day the reminder falls on, not at its midnight", async () => {
      const db = await withInstallment("PENDING");
      const [reminder] = upcomingReminderNotifications(db, new Date(2026, 8, 24, 12, 0));
      expect(new Date(reminder.remindAt).getTime()).toBe(new Date(2026, 8, 25, 9, 0).getTime());
    });

    it("still rings that morning even though the stored midnight is already behind", async () => {
      const db = await withInstallment("PENDING");
      expect(upcomingReminderNotifications(db, new Date(2026, 8, 25, 8, 0)).map((r) => r.id)).toEqual(["inst"]);
      expect(upcomingReminderNotifications(db, new Date(2026, 8, 25, 10, 0))).toEqual([]);
    });

    it("does not ring for an installment that has been paid", async () => {
      const db = await withInstallment("PAID");
      expect(upcomingReminderNotifications(db, new Date(2026, 8, 24, 12, 0))).toEqual([]);
    });
  });

  it("caps how many it hands to the OS", async () => {
    const db = await freshDb();
    addEvent(db, "e1", "جلسه");
    for (let i = 0; i < 5; i++) addReminder(db, `r${i}`, "e1", null, `2026-09-2${i + 1}T09:00:00.000Z`);
    expect(upcomingReminderNotifications(db, NOW, 3).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
  });
});

describe("recurring events", () => {
  // A weekly event whose first occurrence has already happened: its Reminder row is a past moment, so
  // before, nothing was ever armed again.
  function addWeeklyEvent(db: LocalDb, extra: { until?: string | null; count?: number | null; deletedAt?: string | null; freq?: string } = {}) {
    db.run(
      `INSERT INTO "Event" ("id","userId","title","startAt","endAt","recurrenceFreq","recurrenceInterval","recurrenceUntil","recurrenceCount","createdAt","updatedAt","deletedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ["w1", USER, "کلاس", "2026-09-05T10:00:00.000Z", "2026-09-05T11:00:00.000Z", extra.freq ?? "WEEKLY", 1, extra.until ?? null, extra.count ?? null, T, T, extra.deletedAt ?? null]
    );
    addReminder(db, "wr", "w1", null, "2026-09-05T09:30:00.000Z", { offsetMinutes: 30, notified: 1 });
  }
  const NOW_REC = new Date("2026-09-19T12:00:00.000Z"); // between the 3rd (09-19 10:00) and 4th (09-26) occurrences

  it("arms the coming repeats of a series, one notification each, timed by the lead time", async () => {
    const db = await freshDb();
    addWeeklyEvent(db);
    const list = upcomingReminderNotifications(db, NOW_REC);
    expect(list.slice(0, 3).map((r) => [r.id, r.remindAt])).toEqual([
      ["wr::3", "2026-09-26T09:30:00.000Z"],
      ["wr::4", "2026-10-03T09:30:00.000Z"],
      ["wr::5", "2026-10-10T09:30:00.000Z"],
    ]);
    expect(list[0].body).toBe("کلاس - 30 دقیقه دیگر");
    expect(list[0].title).toBe("یادآوری wr");
  });

  it("stops at the horizon (about two months ahead) — not the whole series", async () => {
    const db = await freshDb();
    addWeeklyEvent(db);
    const list = upcomingReminderNotifications(db, NOW_REC);
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.length).toBeLessThanOrEqual(10);
    expect(new Date(list[list.length - 1].remindAt).getTime()).toBeLessThan(NOW_REC.getTime() + 61 * 24 * 3_600_000);
  });

  it("honours the end of the series: a count and an until date", async () => {
    const db = await freshDb();
    addWeeklyEvent(db, { count: 4 }); // occurrences 0..3 (09-05, 09-12, 09-19, 09-26) -> only #3 is still ahead
    expect(upcomingReminderNotifications(db, NOW_REC).map((r) => r.id)).toEqual(["wr::3"]);

    const db2 = await freshDb();
    addWeeklyEvent(db2, { until: "2026-10-04T00:00:00.000Z" });
    expect(upcomingReminderNotifications(db2, NOW_REC).map((r) => r.id)).toEqual(["wr::3", "wr::4"]);
  });

  it("does not repeat the event's own first start — its Reminder row covers that one", async () => {
    const db = await freshDb();
    addWeeklyEvent(db);
    db.run(`UPDATE "Reminder" SET "notified" = 0, "remindAt" = '2026-09-26T09:30:00.000Z' WHERE "id" = 'wr'`);
    db.run(`UPDATE "Event" SET "startAt" = '2026-09-26T10:00:00.000Z', "endAt" = '2026-09-26T11:00:00.000Z' WHERE "id" = 'w1'`);
    const ids = upcomingReminderNotifications(db, NOW_REC).map((r) => r.id);
    expect(ids[0]).toBe("wr"); // the row itself, first occurrence
    expect(ids).not.toContain("wr::0");
    expect(ids[1]).toBe("wr::1");
  });

  it("leaves a deleted series alone, a dismissed reminder alone, and a one-off event alone", async () => {
    const db = await freshDb();
    addWeeklyEvent(db, { deletedAt: "2026-09-10T00:00:00.000Z" });
    expect(upcomingReminderNotifications(db, NOW_REC)).toEqual([]);

    const db2 = await freshDb();
    addWeeklyEvent(db2);
    db2.run(`UPDATE "Reminder" SET "dismissed" = 1`);
    expect(upcomingReminderNotifications(db2, NOW_REC)).toEqual([]);

    const db3 = await freshDb();
    addWeeklyEvent(db3, { freq: "NONE" });
    expect(upcomingReminderNotifications(db3, NOW_REC)).toEqual([]);
  });

  it("gives a daily event no more than its next couple of weeks per reminder, so it cannot use up the whole quota", async () => {
    const db = await freshDb();
    addWeeklyEvent(db, { freq: "DAILY" });
    const list = upcomingReminderNotifications(db, NOW_REC);
    expect(list).toHaveLength(14);
    expect(list.map((r) => r.remindAt)).toEqual([...list.map((r) => r.remindAt)].sort());
  });

  it("merges the repeats with everything else, soonest first, under the one overall limit", async () => {
    const db = await freshDb();
    addWeeklyEvent(db);
    addEvent(db, "one", "قرار");
    addReminder(db, "single", "one", null, "2026-09-27T09:00:00.000Z");
    const ids = upcomingReminderNotifications(db, NOW_REC).map((r) => r.id);
    expect(ids.slice(0, 3)).toEqual(["wr::3", "single", "wr::4"]);
    expect(upcomingReminderNotifications(db, NOW_REC, 2).map((r) => r.id)).toEqual(["wr::3", "single"]);
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
