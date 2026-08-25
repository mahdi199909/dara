import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { search } from "./search";

const USER_ID = "user_search_1";
const now = () => new Date().toISOString();

describe("local search", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("finds matching tasks/projects/categories across entities and ignores other users' data", () => {
    const db = openLocalDb(createNodeSqliteDriver(":memory:"));
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      USER_ID,
      "s@example.com",
      "hash",
      "Searcher",
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "o@example.com",
      "hash",
      "Other",
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t1", USER_ID, "خرید نان", now(), now()]);
    db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["t2", "someone_else", "خرید شیر", now(), now()]);
    db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["p1", USER_ID, "پروژه نان‌پزی", now(), now()]);

    const results = search(db, USER_ID, "نان");
    expect(results.map((r) => r.type).sort()).toEqual(["Project", "Task"]);
    expect(results.find((r) => r.type === "Task")?.id).toBe("t1");
  });

  it("returns an empty array for an empty/whitespace query", () => {
    const db = openLocalDb(createNodeSqliteDriver(":memory:"));
    expect(search(db, USER_ID, "")).toEqual([]);
    expect(search(db, USER_ID, "   ")).toEqual([]);
    expect(search(db, USER_ID, undefined)).toEqual([]);
  });
});
