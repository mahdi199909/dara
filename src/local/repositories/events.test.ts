import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createEvent, createReminder, deleteEvent, deleteReminder, listEvents, toggleEventCompletion, updateEvent } from "./events";

const USER_ID = "user_test_1";
const OTHER_USER_ID = "someone_else";

async function freshDb() {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  const now = new Date().toISOString();
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "test@example.com",
    "hash",
    "Test User",
    now,
    now,
  ]);
  return db;
}

function addOtherUser(db: LocalDb) {
  const now = new Date().toISOString();
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    OTHER_USER_ID,
    "other@example.com",
    "hash",
    "Other",
    now,
    now,
  ]);
}

describe("local events repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a non-recurring event and lists it in range", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, {
      title: "قرار دکتر",
      startAt: "2026-03-10T08:00:00.000Z",
      endAt: "2026-03-10T09:00:00.000Z",
    });

    expect(event.title).toBe("قرار دکتر");
    expect(event.allDay).toBe(false);
    expect(event.recurrenceFreq).toBe("NONE");
    expect(event.directCost).toBe(0);
    expect(event.reminders).toEqual([]);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);

    const result = listEvents(db, USER_ID, { from: "2026-03-01T00:00:00.000Z", to: "2026-03-31T23:59:59.000Z" }) as any;
    expect(result.taskOccurrences).toEqual([]);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].occurrenceId).toBe(event.id);
    expect(result.occurrences[0].startAt).toBe("2026-03-10T08:00:00.000Z");
    expect(result.occurrences[0].isDone).toBe(false);
    expect(result.occurrences[0].event.id).toBe(event.id);
  });

  it("lists all events without occurrence expansion when no range is given, scoped to the caller", async () => {
    const db = await freshDb();
    addOtherUser(db);
    createEvent(db, USER_ID, { title: "دوم", startAt: "2026-04-02T00:00:00.000Z", endAt: "2026-04-02T01:00:00.000Z" });
    createEvent(db, USER_ID, { title: "اول", startAt: "2026-04-01T00:00:00.000Z", endAt: "2026-04-01T01:00:00.000Z" });
    createEvent(db, OTHER_USER_ID, { title: "غریبه", startAt: "2026-04-01T00:00:00.000Z", endAt: "2026-04-01T01:00:00.000Z" });

    const result = listEvents(db, USER_ID, {}) as any;
    expect(result.occurrences).toEqual([]);
    expect(result.taskOccurrences).toEqual([]);
    // ORDER BY startAt ASC, same as the web route's no-range branch.
    expect(result.events.map((e: any) => e.title)).toEqual(["اول", "دوم"]);
  });

  it("expands a weekly-recurring event into the right occurrences across a month range", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, {
      title: "جلسه هفتگی",
      startAt: "2026-02-01T09:00:00.000Z", // February 2026 is a non-leap 28-day month.
      endAt: "2026-02-01T10:00:00.000Z",
      recurrenceFreq: "WEEKLY",
      recurrenceInterval: 1,
    });

    const result = listEvents(db, USER_ID, { from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.000Z" }) as any;

    expect(result.occurrences).toHaveLength(4);
    expect(result.occurrences.map((o: any) => o.startAt)).toEqual([
      "2026-02-01T09:00:00.000Z",
      "2026-02-08T09:00:00.000Z",
      "2026-02-15T09:00:00.000Z",
      "2026-02-22T09:00:00.000Z",
    ]);
    expect(result.occurrences.map((o: any) => o.endAt)).toEqual([
      "2026-02-01T10:00:00.000Z",
      "2026-02-08T10:00:00.000Z",
      "2026-02-15T10:00:00.000Z",
      "2026-02-22T10:00:00.000Z",
    ]);
    expect(result.occurrences.every((o: any) => o.event.id === event.id)).toBe(true);
  });

  it("marks only the toggled occurrence as done, and toggling again reverts it", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, {
      title: "جلسه هفتگی",
      startAt: "2026-02-01T09:00:00.000Z",
      endAt: "2026-02-01T10:00:00.000Z",
      recurrenceFreq: "WEEKLY",
    });

    const toggled = toggleEventCompletion(db, USER_ID, event.id, { occurrenceDate: "2026-02-08T09:00:00.000Z" });
    expect(toggled).toEqual({ isDone: true });

    const afterComplete = listEvents(db, USER_ID, { from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.000Z" }) as any;
    const doneDates = afterComplete.occurrences.filter((o: any) => o.isDone).map((o: any) => o.startAt);
    expect(doneDates).toEqual(["2026-02-08T09:00:00.000Z"]);

    const untoggled = toggleEventCompletion(db, USER_ID, event.id, { occurrenceDate: "2026-02-08T09:00:00.000Z" });
    expect(untoggled).toEqual({ isDone: false });

    const afterUncomplete = listEvents(db, USER_ID, { from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.000Z" }) as any;
    expect(afterUncomplete.occurrences.some((o: any) => o.isDone)).toBe(false);
  });

  it("creates reminders from reminderOffsets and resyncs their remindAt when startAt changes", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, {
      title: "قرار مهم",
      startAt: "2026-05-01T12:00:00.000Z",
      endAt: "2026-05-01T13:00:00.000Z",
      reminderOffsets: [10, 60],
    });

    expect(event.reminders).toHaveLength(2);
    const sorted = [...event.reminders].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
    expect(sorted[0]).toMatchObject({ offsetMinutes: 10, remindAt: "2026-05-01T11:50:00.000Z", notified: false, title: "یادآوری: قرار مهم" });
    expect(sorted[1]).toMatchObject({ offsetMinutes: 60, remindAt: "2026-05-01T11:00:00.000Z", notified: false });

    updateEvent(db, USER_ID, event.id, { startAt: "2026-05-02T12:00:00.000Z" });

    const relisted = listEvents(db, USER_ID, {}) as any;
    const updatedEvent = relisted.events.find((e: any) => e.id === event.id);
    const resynced = [...updatedEvent.reminders].sort((a: any, b: any) => a.offsetMinutes - b.offsetMinutes);
    expect(resynced[0].remindAt).toBe("2026-05-02T11:50:00.000Z");
    expect(resynced[1].remindAt).toBe("2026-05-02T11:00:00.000Z");
    expect(resynced[0].notified).toBe(false);
  });

  it("creates and deletes a standalone reminder for an event", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER_ID, {
      title: "قرار دکتر",
      startAt: "2026-03-10T08:00:00.000Z",
      endAt: "2026-03-10T09:00:00.000Z",
    });

    const reminder = createReminder(db, USER_ID, event.id, { offsetMinutes: 30 });
    expect(reminder.title).toBe("یادآوری: قرار دکتر");
    expect(reminder.remindAt).toBe("2026-03-10T07:30:00.000Z");
    expect(reminder.notified).toBe(false);
    expect(reminder.dismissed).toBe(false);

    const result = deleteReminder(db, USER_ID, reminder.id);
    expect(result).toEqual({ ok: true });
    expect(() => deleteReminder(db, USER_ID, reminder.id)).toThrow("یادآوری پیدا نشد.");
  });

  it("attaches category and project, and includes matching tasks as taskOccurrences", async () => {
    const db = await freshDb();
    const now = new Date().toISOString();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat_1", USER_ID, "کاری", now, now]);
    db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["proj_1", USER_ID, "پروژه", now, now]);
    db.run(`INSERT INTO "Task" ("id","userId","title","categoryId","dueDate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
      "task_1",
      USER_ID,
      "کار مرتبط",
      "cat_1",
      "2026-06-15T00:00:00.000Z",
      now,
      now,
    ]);

    createEvent(db, USER_ID, {
      title: "با دسته",
      startAt: "2026-06-10T08:00:00.000Z",
      endAt: "2026-06-10T09:00:00.000Z",
      categoryId: "cat_1",
      projectId: "proj_1",
    });

    const result = listEvents(db, USER_ID, { from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T23:59:59.000Z" }) as any;
    expect(result.occurrences[0].event.category?.name).toBe("کاری");
    expect(result.occurrences[0].event.project?.name).toBe("پروژه");
    expect(result.taskOccurrences).toHaveLength(1);
    expect(result.taskOccurrences[0].title).toBe("کار مرتبط");
    expect(result.taskOccurrences[0].category?.name).toBe("کاری");
  });

  it("throws a 404 ApiError for an event or reminder belonging to another user", async () => {
    const db = await freshDb();
    addOtherUser(db);
    const event = createEvent(db, USER_ID, {
      title: "خصوصی",
      startAt: "2026-03-10T08:00:00.000Z",
      endAt: "2026-03-10T09:00:00.000Z",
    });
    const reminder = createReminder(db, USER_ID, event.id, { offsetMinutes: 15 });

    expect(() => updateEvent(db, OTHER_USER_ID, event.id, { title: "دستکاری" })).toThrow("رویداد پیدا نشد.");
    expect(() => deleteEvent(db, OTHER_USER_ID, event.id)).toThrow("رویداد پیدا نشد.");
    expect(() => createReminder(db, OTHER_USER_ID, event.id, { offsetMinutes: 10 })).toThrow("رویداد پیدا نشد.");
    expect(() => toggleEventCompletion(db, OTHER_USER_ID, event.id, { occurrenceDate: "2026-03-10T08:00:00.000Z" })).toThrow("رویداد پیدا نشد.");
    expect(() => deleteReminder(db, OTHER_USER_ID, reminder.id)).toThrow("یادآوری پیدا نشد.");

    // Sanity check: the owning user can still act on their own event/reminder.
    expect(deleteEvent(db, USER_ID, event.id)).toEqual({ ok: true });
  });
});
