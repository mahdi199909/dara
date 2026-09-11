import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { getTitleSuggestions } from "./titleSuggestions";

const USER_ID = "user_titles_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "t@example.com",
    "hash",
    "Titles",
    now(),
    now(),
  ]);
  return db;
}

describe("local titleSuggestions", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("combines Task and Event titles into one ranked pool", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t1", USER_ID, "خرید نان", now(), now()]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t2", USER_ID, "خرید نان", now(), now()]);
    db.run(
      `INSERT INTO "Event" ("id","userId","title","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`,
      ["e1", USER_ID, "خرید نان", now(), now(), now(), now()]
    );

    const suggestions = getTitleSuggestions(db, USER_ID, "");
    const combined = suggestions.find((s) => s.title === "خرید نان");
    expect(combined?.count).toBe(3); // 2 Task rows + 1 Event row, merged
  });

  it("excludes soft-deleted rows and other users' data", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "o@example.com",
      "hash",
      "Other",
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t1", USER_ID, "زنده", now(), now()]);
    db.run(`INSERT INTO "Task" ("id","userId","title","deletedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "t2",
      USER_ID,
      "حذف‌شده",
      now(),
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t3", "someone_else", "کاربر دیگر", now(), now()]);

    const titles = getTitleSuggestions(db, USER_ID, "").map((s) => s.title);
    expect(titles).toContain("زنده");
    expect(titles).not.toContain("حذف‌شده");
    expect(titles).not.toContain("کاربر دیگر");
  });

  it("filters by the query substring", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t1", USER_ID, "خرید نان", now(), now()]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t2", USER_ID, "تماس با دکتر", now(), now()]);

    const titles = getTitleSuggestions(db, USER_ID, "خرید").map((s) => s.title);
    expect(titles).toEqual(["خرید نان"]);
  });
});
