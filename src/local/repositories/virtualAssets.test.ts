import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { listVirtualAssets } from "./virtualAssets";

const USER_ID = "user_va_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "va@example.com",
    "hash",
    "VA Tester",
    now(),
    now(),
  ]);
  return db;
}

describe("local virtual assets repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("groups entries by category, and buckets project/habit entries separately, summing totals", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat_1", USER_ID, "یادگیری", now(), now()]);
    db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["proj_1", USER_ID, "پروژه", now(), now()]);
    db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["habit_1", USER_ID, "عادت", now(), now()]);
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["hc_1", "habit_1", now(), now(), now()]);

    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","categoryId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["va_cat", USER_ID, "cat_1", 60, 1000, 1000, now(), now(), now()]
    );
    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","projectId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["va_proj", USER_ID, "proj_1", 0, 0, 5000, now(), now(), now()]
    );
    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","habitCheckInId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["va_habit", USER_ID, "hc_1", 0, 0, 500, now(), now(), now()]
    );

    const result = listVirtualAssets(db, USER_ID);

    expect(result.total).toBe(6500);
    expect(result.entries).toHaveLength(3);
    expect(result.byCategory).toHaveLength(1);
    expect(result.byCategory[0]).toMatchObject({ categoryId: "cat_1", name: "یادگیری", total: 1000 });
    expect(result.projectEntries.map((e) => e.id)).toEqual(["va_proj"]);
    expect(result.habitEntries.map((e) => e.id)).toEqual(["va_habit"]);
    expect(result.habitEntries[0].habitCheckIn?.habit?.id).toBe("habit_1");
  });

  it("ignores another user's entries and returns empty groupings when there are none", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "o@example.com",
      "hash",
      "Other",
      now(),
      now(),
    ]);
    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      ["va_other", "someone_else", 0, 0, 999, now(), now(), now()]
    );

    const result = listVirtualAssets(db, USER_ID);
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.byCategory).toHaveLength(0);
  });
});
