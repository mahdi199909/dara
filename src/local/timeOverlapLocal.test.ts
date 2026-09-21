// Saving a timed task or event on the phone refuses a range that another entry already occupies —
// unless the caller says it saw the warning and wants to overlap anyway.
import { beforeEach, describe, expect, it } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { createTask, updateTask } from "./repositories/tasks";
import { createEvent, updateEvent } from "./repositories/events";

const USER_ID = "user_overlap_1";
const iso = (h: number, m = 0, day = 21) => new Date(2026, 8, day, h, m).toISOString();

async function freshDb() {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "o@example.com", "hash", "O", new Date().toISOString(), new Date().toISOString()]);
  return db;
}

function conflictOf(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err as { status: number; code?: string; message: string; details?: { conflicts: Array<{ id: string; title: string; kind: string }> } };
  }
  throw new Error("expected the call to be refused");
}

describe("overlap on the phone", () => {
  beforeEach(() => resetLocalDbForTests());

  it("refuses a task whose time lies on top of another task, and names it", async () => {
    const db = await freshDb();
    const first = createTask(db, USER_ID, { title: "مطالعه", startAt: iso(9), endAt: iso(11) });
    const error = conflictOf(() => createTask(db, USER_ID, { title: "ورزش", startAt: iso(10), endAt: iso(12) }));
    expect(error.status).toBe(409);
    expect(error.code).toBe("TASK-002");
    expect(error.message).toContain("«مطالعه»");
    expect(error.details?.conflicts.map((c) => c.id)).toEqual([first.id]);
    // nothing was written for the refused one
    expect(db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Task"`)!.n).toBe(1);
  });

  it("accepts touching ranges and other days", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "الف", startAt: iso(9), endAt: iso(10) });
    expect(() => createTask(db, USER_ID, { title: "ب", startAt: iso(10), endAt: iso(11) })).not.toThrow();
    expect(() => createTask(db, USER_ID, { title: "ج", startAt: iso(9, 0, 22), endAt: iso(10, 0, 22) })).not.toThrow();
  });

  it("saves the overlap when the caller allows it", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "الف", startAt: iso(9), endAt: iso(11) });
    expect(() => createTask(db, USER_ID, { title: "ب", startAt: iso(10), endAt: iso(12), allowOverlap: true })).not.toThrow();
    expect(db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Task"`)!.n).toBe(2);
  });

  it("leaves tasks without a time range alone", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "الف", startAt: iso(9), endAt: iso(11) });
    expect(() => createTask(db, USER_ID, { title: "بدون زمان" })).not.toThrow();
    expect(() => createTask(db, USER_ID, { title: "فقط شروع", startAt: iso(10) })).not.toThrow();
  });

  it("checks a moved task but not a task that is merely ticked done, and never against itself", async () => {
    const db = await freshDb();
    const a = createTask(db, USER_ID, { title: "الف", startAt: iso(9), endAt: iso(11) });
    createTask(db, USER_ID, { title: "ب", startAt: iso(13), endAt: iso(14) });

    expect(() => updateTask(db, USER_ID, a.id, { startAt: iso(9, 30), endAt: iso(11, 30) })).not.toThrow(); // still only itself
    const error = conflictOf(() => updateTask(db, USER_ID, a.id, { startAt: iso(12, 30), endAt: iso(13, 30) }));
    expect(error.code).toBe("TASK-002");
    // forcing an overlap through a lying time-free edit is not needed: status changes are never checked
    expect(() => updateTask(db, USER_ID, a.id, { status: "DONE" })).not.toThrow();
    expect(() => updateTask(db, USER_ID, a.id, { startAt: iso(12, 30), endAt: iso(13, 30), allowOverlap: true })).not.toThrow();
  });

  it("checks timed events against tasks, and tasks against events", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "کار", startAt: iso(9), endAt: iso(10) });
    const error = conflictOf(() => createEvent(db, USER_ID, { title: "جلسه", startAt: iso(9, 30), endAt: iso(10, 30) }));
    expect(error.code).toBe("TASK-002");
    expect(error.message).toContain("«کار»");

    createEvent(db, USER_ID, { title: "جلسه", startAt: iso(14), endAt: iso(15) });
    const back = conflictOf(() => createTask(db, USER_ID, { title: "دیگر", startAt: iso(14, 30), endAt: iso(15, 30) }));
    expect(back.message).toContain("«جلسه»");
    expect(back.details?.conflicts[0].kind).toBe("EVENT");
  });

  it("does not treat all-day events or recurring series as occupying time when they are created", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "کار", startAt: iso(9), endAt: iso(10) });
    expect(() => createEvent(db, USER_ID, { title: "تعطیل", startAt: iso(0), endAt: iso(23, 59), allDay: true })).not.toThrow();
    expect(() => createEvent(db, USER_ID, { title: "تکراری", startAt: iso(9), endAt: iso(10), recurrenceFreq: "DAILY" })).not.toThrow();
  });

  it("sees a recurring series' later occurrences when something is put on top of them", async () => {
    const db = await freshDb();
    createEvent(db, USER_ID, { title: "ورزش", startAt: iso(6, 0, 20), endAt: iso(7, 0, 20), recurrenceFreq: "DAILY" });
    const error = conflictOf(() => createTask(db, USER_ID, { title: "خواندن", startAt: iso(6, 30, 23), endAt: iso(7, 30, 23) }));
    expect(error.message).toContain("«ورزش»");
  });

  it("checks an event that is moved, but not itself", async () => {
    const db = await freshDb();
    const meeting = createEvent(db, USER_ID, { title: "جلسه", startAt: iso(9), endAt: iso(10) });
    createTask(db, USER_ID, { title: "کار", startAt: iso(11), endAt: iso(12) });
    const id = (meeting as { id: string }).id;
    expect(() => updateEvent(db, USER_ID, id, { startAt: iso(9, 30), endAt: iso(10, 30) })).not.toThrow();
    const error = conflictOf(() => updateEvent(db, USER_ID, id, { startAt: iso(11, 30), endAt: iso(12, 30) }));
    expect(error.code).toBe("TASK-002");
    expect(() => updateEvent(db, USER_ID, id, { title: "جلسه مهم" })).not.toThrow();
  });

  it("ignores deleted tasks", async () => {
    const db = await freshDb();
    const a = createTask(db, USER_ID, { title: "الف", startAt: iso(9), endAt: iso(11) });
    db.run(`UPDATE "Task" SET "deletedAt" = ? WHERE "id" = ?`, [new Date().toISOString(), a.id]);
    expect(() => createTask(db, USER_ID, { title: "ب", startAt: iso(10), endAt: iso(12) })).not.toThrow();
  });
});
