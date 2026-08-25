import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { listNotifications, markNotificationRead } from "./notifications";

const USER_ID = "user_notif_1";
const now = () => new Date().toISOString();

function freshDb(): LocalDb {
  resetLocalDbForTests();
  const db = openLocalDb(createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "n@example.com", "hash", "Notif", now(), now()]);
  return db;
}

describe("local notifications", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("fires a due, non-dismissed event reminder into a Notification and marks it notified", () => {
    const db = freshDb();
    db.run(`INSERT INTO "Event" ("id","userId","title","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
      "event_1",
      USER_ID,
      "جلسه تیم",
      now(),
      now(),
      now(),
      now(),
    ]);
    const past = new Date(Date.now() - 60000).toISOString();
    db.run(
      `INSERT INTO "Reminder" ("id","userId","targetType","eventId","title","offsetMinutes","remindAt","notified","dismissed","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ["rem_1", USER_ID, "EVENT", "event_1", "یادآوری جلسه", 15, past, 0, 0, now()]
    );

    const { notifications } = listNotifications(db, USER_ID);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toContain("جلسه تیم");

    const reminder = db.get<any>(`SELECT * FROM "Reminder" WHERE "id" = ?`, ["rem_1"]);
    expect(reminder.notified).toBe(1);

    // Polling again shouldn't re-fire the same already-notified reminder.
    const second = listNotifications(db, USER_ID);
    expect(second.notifications).toHaveLength(1); // still just the one unread notification, not duplicated
  });

  it("does not fire a reminder whose remindAt is still in the future", () => {
    const db = freshDb();
    const future = new Date(Date.now() + 60 * 60000).toISOString();
    db.run(
      `INSERT INTO "Reminder" ("id","userId","targetType","title","offsetMinutes","remindAt","notified","dismissed","createdAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["rem_1", USER_ID, "CUSTOM", "بعدا", 0, future, 0, 0, now()]
    );
    expect(listNotifications(db, USER_ID).notifications).toHaveLength(0);
  });

  it("nudges a neglected active habit and cools down after nudging", () => {
    const db = freshDb();
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString();
    db.run(`INSERT INTO "Habit" ("id","userId","title","isActive","isTrial","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
      "habit_1",
      USER_ID,
      "مطالعه",
      1,
      0,
      fourDaysAgo,
      now(),
    ]);

    const { notifications } = listNotifications(db, USER_ID);
    expect(notifications.some((n) => n.relatedId === "habit_1")).toBe(true);

    const habit = db.get<any>(`SELECT * FROM "Habit" WHERE "id" = ?`, ["habit_1"]);
    expect(habit.lastNudgeSentAt).not.toBeNull();
  });

  it("marks a notification read", () => {
    const db = freshDb();
    db.run(`INSERT INTO "Notification" ("id","userId","title","body","type","isRead","createdAt") VALUES (?,?,?,?,?,?,?)`, [
      "notif_1",
      USER_ID,
      "عنوان",
      "متن",
      "system",
      0,
      now(),
    ]);
    markNotificationRead(db, USER_ID, "notif_1");
    expect(listNotifications(db, USER_ID).notifications).toHaveLength(0);
  });

  it("throws a 404 for another user's notification", () => {
    const db = freshDb();
    db.run(`INSERT INTO "Notification" ("id","userId","title","body","type","isRead","createdAt") VALUES (?,?,?,?,?,?,?)`, [
      "notif_1",
      USER_ID,
      "عنوان",
      "متن",
      "system",
      0,
      now(),
    ]);
    expect(() => markNotificationRead(db, "someone_else", "notif_1")).toThrow("اعلان پیدا نشد.");
  });
});
