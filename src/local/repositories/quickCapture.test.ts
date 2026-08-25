import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { quickCapture } from "./quickCapture";

const USER_ID = "user_qc_1";
const now = () => new Date().toISOString();

function freshDb(): LocalDb {
  resetLocalDbForTests();
  const db = openLocalDb(createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "q@example.com", "hash", "QC", now(), now()]);
  return db;
}

describe("local quickCapture", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a Task when the text parses with no amount/duration/date", () => {
    const db = freshDb();
    const result = quickCapture(db, USER_ID, { text: "تماس با مشتری" });
    expect(result.entityType).toBe("Task");
    expect((result.entity as any).title).toBe("تماس با مشتری");
  });

  it("creates an EXPENSE Transaction, auto-creating a default cash account if none exists", () => {
    const db = freshDb();
    const result = quickCapture(db, USER_ID, { text: "خرید نان 50000 تومان", type: "EXPENSE", amount: 50000 });
    expect(result.entityType).toBe("Transaction");
    expect((result.entity as any).amount).toBe(50000);
    expect((result.entity as any).type).toBe("EXPENSE");

    const accounts = db.all(`SELECT * FROM "FinanceAccount" WHERE "userId" = ?`, [USER_ID]);
    expect(accounts).toHaveLength(1);

    // A second expense reuses the same default account instead of creating another one.
    quickCapture(db, USER_ID, { text: "خرید شیر", type: "EXPENSE", amount: 20000 });
    expect(db.all(`SELECT * FROM "FinanceAccount" WHERE "userId" = ?`, [USER_ID])).toHaveLength(1);
  });

  it("creates an EVENT with computed endAt from durationMinutes", () => {
    const db = freshDb();
    const result = quickCapture(db, USER_ID, { text: "جلسه تیم", type: "EVENT", durationMinutes: 30, date: new Date("2026-05-01T10:00:00.000Z").toISOString() });
    expect(result.entityType).toBe("Event");
    const event = result.entity as any;
    expect(new Date(event.endAt).getTime() - new Date(event.startAt).getTime()).toBe(30 * 60000);
  });

  it("resolves a categoryId from a text hint when no explicit categoryId is given", () => {
    const db = freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat_1", USER_ID, "شبکه‌های اجتماعی", now(), now()]);
    const result = quickCapture(db, USER_ID, { text: "۲۰ دقیقه اینستاگرام" });
    expect((result.entity as any).categoryId).toBe("cat_1");
  });
});
