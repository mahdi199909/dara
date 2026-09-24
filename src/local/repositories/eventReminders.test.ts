// What the phone tells the operating system when an event's reminders are created, moved and removed
// — in particular that a recurring event does not stop at its first occurrence.
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ schedule: vi.fn(), reschedule: vi.fn(), cancel: vi.fn(), sync: vi.fn() }));
vi.mock("../nativeNotifications", () => ({
  scheduleReminderNotification: native.schedule,
  rescheduleReminderNotification: native.reschedule,
  cancelReminderNotifications: native.cancel,
  syncScheduledReminderNotifications: native.sync,
}));

import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createEvent, createReminder, deleteEvent, deleteReminder, updateEvent } from "./events";

const USER_ID = "user_ev_rem";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  const ts = new Date().toISOString();
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "e@example.com", "hash", "Ev", ts, ts]);
  return db;
}

/** An event `daysAhead` days from now, an hour long. */
function input(daysAhead: number, extra: Record<string, unknown> = {}) {
  const start = Date.now() + daysAhead * DAY;
  return { title: "کلاس", startAt: new Date(start).toISOString(), endAt: new Date(start + HOUR).toISOString(), ...extra };
}

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset();
});

describe("a one-off event", () => {
  it("hands each reminder to the system, worded by its lead time — «now» for one at the start", async () => {
    const db = await freshDb();
    createEvent(db, USER_ID, input(2, { reminderOffsets: [30, 0] }));

    expect(native.schedule).toHaveBeenCalledTimes(2);
    const bodies = native.schedule.mock.calls.map(([r]) => r.body).sort();
    expect(bodies).toEqual(["کلاس - 30 دقیقه دیگر", "کلاس - همین الان"].sort());
    expect(native.sync).not.toHaveBeenCalled(); // no reconcile needed: nothing repeats
  });

  it("re-times the alarms when the event moves, without a reconcile", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { reminderOffsets: [30] }));
    native.schedule.mockClear();

    updateEvent(db, USER_ID, event.id, { startAt: new Date(Date.now() + 3 * DAY).toISOString(), endAt: new Date(Date.now() + 3 * DAY + HOUR).toISOString() });

    expect(native.reschedule).toHaveBeenCalledTimes(1);
    expect(native.sync).not.toHaveBeenCalled();
  });

  it("cancels the alarms when the event is deleted, without a reconcile", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { reminderOffsets: [30] }));
    deleteEvent(db, USER_ID, event.id);
    expect(native.cancel).toHaveBeenCalledTimes(1);
    expect(native.sync).not.toHaveBeenCalled();
  });
});

describe("a recurring event", () => {
  it("arms the repeats right after it is created, not only its first occurrence", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { recurrenceFreq: "WEEKLY", reminderOffsets: [30] }));

    expect(native.schedule).toHaveBeenCalledTimes(1); // the first occurrence, by its Reminder row
    expect(native.sync).toHaveBeenCalledTimes(1);
    const wanted = native.sync.mock.calls[0][0] as Array<{ id: string }>;
    const reminderId = event.reminders[0].id;
    expect(wanted.map((r) => r.id)).toEqual([reminderId, `${reminderId}::1`, `${reminderId}::2`, `${reminderId}::3`, `${reminderId}::4`, `${reminderId}::5`, `${reminderId}::6`, `${reminderId}::7`, `${reminderId}::8`]);
  });

  it("does nothing extra for a recurring event without reminders", async () => {
    const db = await freshDb();
    createEvent(db, USER_ID, input(2, { recurrenceFreq: "DAILY" }));
    expect(native.sync).not.toHaveBeenCalled();
  });

  it("re-arms when the series changes — a new time, or an end to it", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { recurrenceFreq: "WEEKLY", reminderOffsets: [30] }));
    native.sync.mockClear();

    updateEvent(db, USER_ID, event.id, { recurrenceCount: 2 });

    expect(native.sync).toHaveBeenCalledTimes(1);
    const wanted = native.sync.mock.calls[0][0] as Array<{ id: string }>;
    expect(wanted).toHaveLength(2); // the first occurrence's row, and repeat 1
  });

  it("re-arms when an event stops repeating, so the repeats it had are dropped", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { recurrenceFreq: "WEEKLY", reminderOffsets: [30] }));
    native.sync.mockClear();

    updateEvent(db, USER_ID, event.id, { recurrenceFreq: "NONE" });

    expect(native.sync).toHaveBeenCalledTimes(1);
    expect(native.sync.mock.calls[0][0]).toHaveLength(1); // only the event's own reminder is left
  });

  it("drops every repeat when the series is deleted", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { recurrenceFreq: "WEEKLY", reminderOffsets: [30] }));
    native.sync.mockClear();

    deleteEvent(db, USER_ID, event.id);

    expect(native.sync).toHaveBeenCalledTimes(1);
    expect(native.sync.mock.calls[0][0]).toEqual([]);
  });

  it("arms the repeats of a reminder added later, and drops them when that reminder is deleted", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2, { recurrenceFreq: "WEEKLY" }));

    const { id } = createReminder(db, USER_ID, event.id, { offsetMinutes: 60 });
    expect(native.sync).toHaveBeenCalledTimes(1);
    expect((native.sync.mock.calls[0][0] as Array<{ id: string }>).some((r) => r.id === `${id}::1`)).toBe(true);
    native.sync.mockClear();

    deleteReminder(db, USER_ID, id);
    expect(native.sync).toHaveBeenCalledTimes(1);
    expect(native.sync.mock.calls[0][0]).toEqual([]);
  });

  it("does not reconcile after deleting the reminder of a one-off event", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, input(2));
    const { id } = createReminder(db, USER_ID, event.id, { offsetMinutes: 60 });
    native.sync.mockClear();
    deleteReminder(db, USER_ID, id);
    expect(native.sync).not.toHaveBeenCalled();
  });
});
