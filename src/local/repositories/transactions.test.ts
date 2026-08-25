import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createAccount } from "./accounts";
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from "./transactions";

const USER_ID = "user_test_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "test@example.com",
    "hash",
    "Test User",
    now(),
    now(),
  ]);
  return db;
}

function insertCategory(db: LocalDb, id: string) {
  db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [id, USER_ID, id, now(), now()]);
}
function insertProject(db: LocalDb, id: string) {
  db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [id, USER_ID, id, now(), now()]);
}
function insertTask(db: LocalDb, id: string) {
  db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [id, USER_ID, id, now(), now()]);
}
function insertAsset(db: LocalDb, id: string) {
  db.run(`INSERT INTO "Asset" ("id","userId","name","purchasePrice","purchaseDate","currentValue","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
    id,
    USER_ID,
    id,
    100000,
    now(),
    100000,
    now(),
    now(),
  ]);
}

describe("local transactions repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a transaction with the same defaults as the web route, and returns the bare row (no joins)", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });

    const tx = createTransaction(db, USER_ID, { type: "EXPENSE", amount: 5000, accountId: account.id });

    expect(tx.type).toBe("EXPENSE");
    expect(tx.amount).toBe(5000);
    expect(tx.accountId).toBe(account.id);
    expect(tx.description).toBeNull();
    expect(tx.categoryId).toBeNull();
    expect(tx.taskId).toBeNull();
    expect(tx.projectId).toBeNull();
    expect(tx.assetId).toBeNull();
    expect(tx.transferToAccountId).toBeNull();
    expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tx.id).toMatch(/^[0-9a-f-]{36}$/);
    // The web route's POST handler never re-fetches with `include` — matches that exactly.
    expect("account" in tx).toBe(false);
    expect("category" in tx).toBe(false);
  });

  it("rejects a create when the source account doesn't belong to the caller", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    expect(() => createTransaction(db, "someone_else", { type: "EXPENSE", amount: 100, accountId: account.id })).toThrow(
      "حساب مبدا پیدا نشد."
    );
  });

  it("requires transferToAccountId for TRANSFER, and validates it belongs to the caller", async () => {
    const db = await freshDb();
    const source = createAccount(db, USER_ID, { name: "مبدا" });

    expect(() => createTransaction(db, USER_ID, { type: "TRANSFER", amount: 100, accountId: source.id })).toThrow(
      "حساب مقصد برای انتقال الزامی است."
    );
    expect(() =>
      createTransaction(db, USER_ID, { type: "TRANSFER", amount: 100, accountId: source.id, transferToAccountId: "missing" })
    ).toThrow("حساب مقصد پیدا نشد.");
  });

  it("persists transferToAccountId for TRANSFER but silently drops it for non-TRANSFER types", async () => {
    const db = await freshDb();
    const source = createAccount(db, USER_ID, { name: "مبدا" });
    const destination = createAccount(db, USER_ID, { name: "مقصد" });

    const transfer = createTransaction(db, USER_ID, {
      type: "TRANSFER",
      amount: 100,
      accountId: source.id,
      transferToAccountId: destination.id,
    });
    expect(transfer.transferToAccountId).toBe(destination.id);

    // Same body shape but type EXPENSE: transferToAccountId must be dropped, exactly like the web route.
    const expense = createTransaction(db, USER_ID, {
      type: "EXPENSE",
      amount: 100,
      accountId: source.id,
      transferToAccountId: destination.id,
    });
    expect(expense.transferToAccountId).toBeNull();
  });

  it("lists only the calling user's non-deleted transactions, ordered by date desc", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    createTransaction(db, USER_ID, { type: "EXPENSE", amount: 100, accountId: account.id, date: "2026-01-01T00:00:00.000Z" });
    createTransaction(db, USER_ID, { type: "EXPENSE", amount: 200, accountId: account.id, date: "2026-01-03T00:00:00.000Z" });
    createTransaction(db, USER_ID, { type: "EXPENSE", amount: 300, accountId: account.id, date: "2026-01-02T00:00:00.000Z" });

    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "other@example.com",
      "hash",
      "Other",
      now(),
      now(),
    ]);
    const otherAccount = createAccount(db, "someone_else", { name: "غریبه" });
    const otherTx = createTransaction(db, "someone_else", { type: "EXPENSE", amount: 999, accountId: otherAccount.id });

    const transactions = listTransactions(db, USER_ID);
    expect(transactions.map((t) => t.amount)).toEqual([200, 300, 100]);
    expect(transactions.find((t) => t.id === otherTx.id)).toBeUndefined();
  });

  it("joins category, account, project, task, and asset — but not activity/event/installment/transferToAccount", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    insertCategory(db, "cat_1");
    insertProject(db, "proj_1");
    insertTask(db, "task_1");
    insertAsset(db, "asset_1");

    const created = createTransaction(db, USER_ID, {
      type: "EXPENSE",
      amount: 100,
      accountId: account.id,
      categoryId: "cat_1",
      projectId: "proj_1",
      taskId: "task_1",
      assetId: "asset_1",
    });

    const [tx] = listTransactions(db, USER_ID);
    expect(tx.id).toBe(created.id);
    expect((tx.account as any)?.id).toBe(account.id);
    expect((tx.category as any)?.id).toBe("cat_1");
    expect((tx.project as any)?.id).toBe("proj_1");
    expect((tx.task as any)?.id).toBe("task_1");
    expect((tx.asset as any)?.id).toBe("asset_1");
    expect("activity" in tx).toBe(false);
    expect("event" in tx).toBe(false);
    expect("installment" in tx).toBe(false);
    expect("transferToAccount" in tx).toBe(false);
  });

  it("filters list by type, accountId, and date range, and caps limit at 500", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    const otherAccount = createAccount(db, USER_ID, { name: "دیگر" });
    createTransaction(db, USER_ID, { type: "INCOME", amount: 100, accountId: account.id, date: "2026-01-05T00:00:00.000Z" });
    createTransaction(db, USER_ID, { type: "EXPENSE", amount: 200, accountId: account.id, date: "2026-01-10T00:00:00.000Z" });
    createTransaction(db, USER_ID, { type: "EXPENSE", amount: 300, accountId: otherAccount.id, date: "2026-01-15T00:00:00.000Z" });

    expect(listTransactions(db, USER_ID, { type: "EXPENSE" }).map((t) => t.amount).sort()).toEqual([200, 300]);
    expect(listTransactions(db, USER_ID, { accountId: account.id }).map((t) => t.amount).sort()).toEqual([100, 200]);
    expect(listTransactions(db, USER_ID, { from: "2026-01-06T00:00:00.000Z" }).map((t) => t.amount).sort()).toEqual([200, 300]);
    expect(listTransactions(db, USER_ID, { to: "2026-01-10T00:00:00.000Z" }).map((t) => t.amount).sort()).toEqual([100, 200]);
    expect(listTransactions(db, USER_ID, { limit: 1 })).toHaveLength(1);
    expect(listTransactions(db, USER_ID, { limit: 5000 })).toHaveLength(3); // capped at 500 internally, still returns all 3 here
  });

  it("updates amount/date/description/category/project/task and returns the bare row (no joins)", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    insertCategory(db, "cat_1");
    insertTask(db, "task_1");
    insertProject(db, "proj_1");
    const tx = createTransaction(db, USER_ID, { type: "EXPENSE", amount: 100, accountId: account.id });

    const updated = updateTransaction(db, USER_ID, tx.id, {
      amount: 250,
      description: "یادداشت",
      categoryId: "cat_1",
      taskId: "task_1",
      projectId: "proj_1",
    });

    expect(updated.amount).toBe(250);
    expect(updated.description).toBe("یادداشت");
    expect(updated.categoryId).toBe("cat_1");
    expect(updated.taskId).toBe("task_1");
    expect(updated.projectId).toBe("proj_1");
    // Not a strict inequality: two calls within the same millisecond can produce an identical
    // ISO timestamp, making a `.not.toBe()` assertion here flaky rather than meaningful.
    expect(updated.updatedAt >= tx.updatedAt).toBe(true);
    expect("category" in updated).toBe(false);
  });

  it("clears nullable fields when explicitly set to null on update", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    insertCategory(db, "cat_1");
    const tx = createTransaction(db, USER_ID, { type: "EXPENSE", amount: 100, accountId: account.id, categoryId: "cat_1" });
    expect(tx.categoryId).toBe("cat_1");

    const updated = updateTransaction(db, USER_ID, tx.id, { categoryId: null });
    expect(updated.categoryId).toBeNull();
  });

  it("throws a 404 ApiError for a transaction belonging to another user", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    const tx = createTransaction(db, USER_ID, { type: "EXPENSE", amount: 100, accountId: account.id });
    expect(() => updateTransaction(db, "someone_else", tx.id, { amount: 1 })).toThrow("تراکنش پیدا نشد.");
  });

  it("soft-deletes a transaction", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    const tx = createTransaction(db, USER_ID, { type: "EXPENSE", amount: 100, accountId: account.id });

    const result = deleteTransaction(db, USER_ID, tx.id);
    expect(result).toEqual({ ok: true });
    expect(listTransactions(db, USER_ID).find((t) => t.id === tx.id)).toBeUndefined();
  });

  it("blocks update and delete for a transaction linked to an installment", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد" });
    db.run(
      `INSERT INTO "InstallmentPlan" ("id","userId","title","totalAmount","installmentAmount","numberOfInstallments","dueDay","startDate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ["plan_1", USER_ID, "وام", 1200000, 100000, 12, 1, now(), now(), now()]
    );
    db.run(`INSERT INTO "Installment" ("id","planId","index","dueDate","amount","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "inst_1",
      "plan_1",
      1,
      now(),
      100000,
      "PAID",
      now(),
      now(),
    ]);
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","installmentId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["tx_installment", USER_ID, "EXPENSE", 100000, now(), account.id, "inst_1", now(), now()]
    );

    expect(() => updateTransaction(db, USER_ID, "tx_installment", { amount: 1 })).toThrow(
      "تراکنش‌های مرتبط با قسط از این مسیر قابل ویرایش نیستند."
    );
    expect(() => deleteTransaction(db, USER_ID, "tx_installment")).toThrow("تراکنش‌های مرتبط با قسط از این مسیر قابل حذف نیستند.");
  });
});
