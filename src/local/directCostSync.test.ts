import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction, syncTaskVirtualAsset, syncEventDirectCostTransaction } from "./directCostSync";

const USER_ID = "user_dcs_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "dcs@example.com", "hash", "DCS", now(), now()]);
  return db;
}

describe("local directCostSync", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a linked EXPENSE transaction for a task's directCost, auto-creating a default account", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","directCost","incomeAmount","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, ["task_1", USER_ID, "خرید لپ‌تاپ", 30000000, 0, now(), now()]);

    syncTaskDirectCostTransaction(db, "task_1");

    const tx = db.get<any>(`SELECT * FROM "Transaction" WHERE "taskId" = ? AND "type" = 'EXPENSE'`, ["task_1"]);
    expect(tx.amount).toBe(30000000);
    expect(tx.description).toBe("خرید لپ‌تاپ");
    expect(tx.accountId).toBeTruthy();
  });

  it("updates the existing linked transaction on re-sync instead of duplicating it", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","directCost","incomeAmount","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, ["task_1", USER_ID, "خرید", 10000, 0, now(), now()]);
    syncTaskDirectCostTransaction(db, "task_1");
    db.run(`UPDATE "Task" SET "directCost" = ? WHERE "id" = ?`, [20000, "task_1"]);
    syncTaskDirectCostTransaction(db, "task_1");

    const txs = db.all<any>(`SELECT * FROM "Transaction" WHERE "taskId" = ? AND "type" = 'EXPENSE'`, ["task_1"]);
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(20000);
  });

  it("soft-deletes the linked transaction when directCost drops to zero", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","directCost","incomeAmount","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, ["task_1", USER_ID, "خرید", 10000, 0, now(), now()]);
    syncTaskDirectCostTransaction(db, "task_1");
    db.run(`UPDATE "Task" SET "directCost" = 0 WHERE "id" = ?`, ["task_1"]);
    syncTaskDirectCostTransaction(db, "task_1");

    const tx = db.get<any>(`SELECT * FROM "Transaction" WHERE "taskId" = ? AND "type" = 'EXPENSE'`, ["task_1"]);
    expect(tx.deletedAt).not.toBeNull();
  });

  it("keeps income and direct-cost transactions separate for the same task", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Task" ("id","userId","title","directCost","incomeAmount","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, ["task_1", USER_ID, "پروژه فریلنس", 5000, 500000, now(), now()]);
    syncTaskDirectCostTransaction(db, "task_1");
    syncTaskIncomeTransaction(db, "task_1");

    const txs = db.all<any>(`SELECT * FROM "Transaction" WHERE "taskId" = ? AND "deletedAt" IS NULL`, ["task_1"]);
    expect(txs).toHaveLength(2);
    expect(txs.find((t) => t.type === "EXPENSE")?.amount).toBe(5000);
    expect(txs.find((t) => t.type === "INCOME")?.amount).toBe(500000);
  });

  it("creates a virtual asset entry for a task logged in a virtual-asset-generating category", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","generatesVirtualAsset","virtualAssetValuePerHour","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
      "cat_1",
      USER_ID,
      "دارایی",
      1,
      100000,
      now(),
      now(),
    ]);
    const start = new Date("2026-01-01T08:00:00.000Z");
    const end = new Date("2026-01-01T10:00:00.000Z");
    db.run(`INSERT INTO "Task" ("id","userId","title","categoryId","startAt","endAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "task_1",
      USER_ID,
      "کار دارایی‌ساز",
      "cat_1",
      start.toISOString(),
      end.toISOString(),
      now(),
      now(),
    ]);

    syncTaskVirtualAsset(db, "task_1");

    const vae = db.get<any>(`SELECT * FROM "VirtualAssetEntry" WHERE "taskId" = ?`, ["task_1"]);
    expect(vae.totalValue).toBe(200000); // 2 hours * 100,000/hour
  });

  it("creates a linked transaction for an event's directCost", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Event" ("id","userId","title","startAt","endAt","directCost","incomeAmount","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`, [
      "event_1",
      USER_ID,
      "کنسرت",
      now(),
      now(),
      300000,
      0,
      now(),
      now(),
    ]);
    syncEventDirectCostTransaction(db, "event_1");
    const tx = db.get<any>(`SELECT * FROM "Transaction" WHERE "eventId" = ?`, ["event_1"]);
    expect(tx.amount).toBe(300000);
  });
});
