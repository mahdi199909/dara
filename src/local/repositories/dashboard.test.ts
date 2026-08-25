import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { getDashboard } from "./dashboard";

const USER_ID = "user_dash_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "d@example.com", "hash", "Dash", now(), now()]);
  return db;
}

describe("local dashboard", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("assembles today/month reports, net worth, tasks, and events without throwing on an empty account", async () => {
    const db = await freshDb();
    const dashboard = getDashboard(db, USER_ID);
    expect(dashboard.today.totalDurationMin).toBe(0);
    expect(dashboard.netWorth.netWorth).toBe(0);
    expect(dashboard.tasksToday).toEqual([]);
    expect(dashboard.eventsToday).toEqual([]);
    expect(dashboard.activeRunningTimer).toBeNull();
  });

  it("includes an undated, not-done task and the currently running timer", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, ["t1", USER_ID, "کار بی‌تاریخ", "TODO", now(), now()]);
    db.run(`INSERT INTO "Activity" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["a1", USER_ID, "فعالیت", now(), now()]);
    db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, ["te1", "a1", now(), 1, now(), now()]);

    const dashboard = getDashboard(db, USER_ID);
    expect(dashboard.tasksToday.map((t: any) => t.id)).toContain("t1");
    expect(dashboard.activeRunningTimer?.id).toBe("te1");
    expect((dashboard.activeRunningTimer as any)?.activity?.id).toBe("a1");
  });
});
