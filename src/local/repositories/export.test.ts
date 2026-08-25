import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { exportCsv } from "./export";

const USER_ID = "user_export_1";
const now = () => new Date().toISOString();

describe("local export", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("exports tasks as CSV with category/project names resolved and a UTF-8 BOM", async () => {
    const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      USER_ID,
      "e@example.com",
      "hash",
      "Exporter",
      now(),
      now(),
    ]);
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat_1", USER_ID, "خانه", now(), now()]);
    db.run(`INSERT INTO "Task" ("id","userId","title","categoryId","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, ["t1", USER_ID, "خرید نان", "cat_1", now(), now()]);

    const { csv, filename } = exportCsv(db, USER_ID, "tasks");
    expect(filename).toBe("tasks.csv");
    expect(csv).toContain("خرید نان");
    expect(csv).toContain("خانه");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("throws a 400 ApiError for an unsupported entity", async () => {
    const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
    expect(() => exportCsv(db, USER_ID, "not-a-real-entity")).toThrow("نوع خروجی پشتیبانی نمی‌شود.");
  });
});
