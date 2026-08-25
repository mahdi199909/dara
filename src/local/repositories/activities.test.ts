import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import {
  addTimeEntry,
  createActivity,
  deleteActivity,
  getActivity,
  listActivities,
  startActivityTimer,
  stopActivityTimer,
  updateActivity,
} from "./activities";

const USER_ID = "user_test_1";
const OTHER_USER_ID = "user_test_2";

function freshDb(): LocalDb {
  resetLocalDbForTests();
  const db = openLocalDb(createNodeSqliteDriver(":memory:"));
  const nowIso = new Date().toISOString();
  for (const id of [USER_ID, OTHER_USER_ID]) {
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      id,
      `${id}@example.com`,
      "hash",
      "Test User",
      nowIso,
      nowIso,
    ]);
  }
  return db;
}

function insertCategory(db: LocalDb, id: string, opts: { generatesVirtualAsset?: boolean; virtualAssetValuePerHour?: number } = {}) {
  const nowIso = new Date().toISOString();
  db.run(
    `INSERT INTO "Category" ("id","userId","name","generatesVirtualAsset","virtualAssetValuePerHour","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?)`,
    [id, USER_ID, "دسته آزمایشی", opts.generatesVirtualAsset ? 1 : 0, opts.virtualAssetValuePerHour ?? null, nowIso, nowIso]
  );
}

describe("local activities repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates an activity with the same defaults as the web route", () => {
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "مطالعه کتاب" });

    expect(activity.title).toBe("مطالعه کتاب");
    expect(activity.notes).toBeNull();
    expect(activity.totalDurationMin).toBe(0);
    expect(activity.directCost).toBe(0);
    expect(activity.category).toBeNull();
    expect(activity.timeEntries).toEqual([]);
    expect(activity.virtualAssetEntry).toBeNull();
    expect(activity.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("adds a manual time entry (durationMin only) and updates totalDurationMin", () => {
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "فعالیت" });

    const timeEntry = addTimeEntry(db, USER_ID, activity.id, { durationMin: 45 });
    expect(timeEntry.durationMin).toBe(45);
    expect(timeEntry.isRunning).toBe(0);

    const fresh = getActivity(db, USER_ID, activity.id);
    expect(fresh.totalDurationMin).toBe(45);
    expect(fresh.timeEntries).toHaveLength(1);
  });

  it("computes durationMin from an explicit startAt/endAt range", () => {
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "فعالیت" });
    const startAt = new Date("2026-01-01T10:00:00.000Z");
    const endAt = new Date("2026-01-01T10:30:00.000Z");

    const timeEntry = addTimeEntry(db, USER_ID, activity.id, { startAt: startAt.toISOString(), endAt: endAt.toISOString() });
    expect(timeEntry.durationMin).toBe(30);
    expect(getActivity(db, USER_ID, activity.id).totalDurationMin).toBe(30);
  });

  it("requires durationMin or a startAt/endAt range when adding a time entry", () => {
    // Mirrors the web route's manual `if (!body.durationMin && !(body.startAt && body.endAt))`
    // check — this isn't part of the zod schema itself, so it's re-checked here explicitly.
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "فعالیت" });
    expect(() => addTimeEntry(db, USER_ID, activity.id, {})).toThrow("مدت زمان یا بازه شروع/پایان را وارد کنید.");
  });

  it("starts then stops a timer, computing duration on stop", () => {
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "فعالیت" });

    const started = startActivityTimer(db, USER_ID, activity.id);
    expect(started.isRunning).toBe(1);
    expect(started.endAt).toBeNull();
    expect(started.durationMin).toBeNull();

    const { timeEntry: stopped, activity: activityAfterStop } = stopActivityTimer(db, USER_ID, activity.id);
    expect(stopped.isRunning).toBe(0);
    expect(stopped.endAt).not.toBeNull();
    expect(stopped.durationMin).toBeGreaterThanOrEqual(0);
    expect(activityAfterStop.totalDurationMin).toBe(stopped.durationMin);
  });

  it("throws a 400 ApiError when stopping a timer that isn't running", () => {
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "فعالیت" });
    expect(() => stopActivityTimer(db, USER_ID, activity.id)).toThrow("تایمر فعالی برای این فعالیت وجود ندارد.");
  });

  it("starting a second timer force-stops the first one, recalculating its activity's duration", () => {
    const db = freshDb();
    const activityA = createActivity(db, USER_ID, { title: "فعالیت الف" });
    const activityB = createActivity(db, USER_ID, { title: "فعالیت ب" });

    const firstTimer = startActivityTimer(db, USER_ID, activityA.id);
    expect(firstTimer.isRunning).toBe(1);

    const secondTimer = startActivityTimer(db, USER_ID, activityB.id);
    expect(secondTimer.isRunning).toBe(1);

    const refreshedA = getActivity(db, USER_ID, activityA.id);
    expect(refreshedA.timeEntries).toHaveLength(1);
    expect(refreshedA.timeEntries[0].id).toBe(firstTimer.id);
    expect(refreshedA.timeEntries[0].isRunning).toBe(0);
    expect(refreshedA.timeEntries[0].endAt).not.toBeNull();
    expect(refreshedA.timeEntries[0].durationMin).toBeGreaterThanOrEqual(0);
    expect(refreshedA.totalDurationMin).toBe(refreshedA.timeEntries[0].durationMin);

    const refreshedB = getActivity(db, USER_ID, activityB.id);
    expect(refreshedB.timeEntries[0].id).toBe(secondTimer.id);
    expect(refreshedB.timeEntries[0].isRunning).toBe(1);
  });

  it("creates a virtual asset value when the activity's category generates one, and removes it when the category no longer does", () => {
    const db = freshDb();
    insertCategory(db, "cat_va", { generatesVirtualAsset: true, virtualAssetValuePerHour: 600 });
    insertCategory(db, "cat_plain");

    const activity = createActivity(db, USER_ID, { title: "فعالیت با دارایی مجازی", categoryId: "cat_va" });
    addTimeEntry(db, USER_ID, activity.id, { durationMin: 60 });

    const withAsset = getActivity(db, USER_ID, activity.id);
    expect(withAsset.virtualAssetEntry).not.toBeNull();
    expect(withAsset.virtualAssetEntry?.totalValue).toBe(600); // round(60min/60 * 600/hr)
    expect(withAsset.virtualAssetEntry?.durationMin).toBe(60);

    // Switching to a category that doesn't generate virtual assets should delete the entry —
    // triggered by updateActivity's categoryId-changed -> recalcActivityDuration call.
    updateActivity(db, USER_ID, activity.id, { categoryId: "cat_plain" });

    const withoutAsset = getActivity(db, USER_ID, activity.id);
    expect(withoutAsset.virtualAssetEntry).toBeNull();
  });

  it("lists only the calling user's non-deleted activities", () => {
    const db = freshDb();
    const mine = createActivity(db, USER_ID, { title: "فعالیت من" });
    createActivity(db, OTHER_USER_ID, { title: "فعالیت غریبه" });

    expect(listActivities(db, USER_ID).map((a) => a.id)).toEqual([mine.id]);

    deleteActivity(db, USER_ID, mine.id);
    expect(listActivities(db, USER_ID)).toEqual([]);
  });

  it("throws a 404 ApiError for an activity belonging to another user", () => {
    const db = freshDb();
    const activity = createActivity(db, USER_ID, { title: "فعالیت" });

    expect(() => getActivity(db, OTHER_USER_ID, activity.id)).toThrow("فعالیت پیدا نشد.");
    expect(() => updateActivity(db, OTHER_USER_ID, activity.id, { title: "دستکاری" })).toThrow("فعالیت پیدا نشد.");
    expect(() => addTimeEntry(db, OTHER_USER_ID, activity.id, { durationMin: 10 })).toThrow("فعالیت پیدا نشد.");
    expect(() => startActivityTimer(db, OTHER_USER_ID, activity.id)).toThrow("فعالیت پیدا نشد.");
    expect(() => stopActivityTimer(db, OTHER_USER_ID, activity.id)).toThrow("فعالیت پیدا نشد.");
    expect(() => deleteActivity(db, OTHER_USER_ID, activity.id)).toThrow("فعالیت پیدا نشد.");
  });
});
