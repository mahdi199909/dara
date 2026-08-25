import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createAccount, deleteAccount, listAccounts, updateAccount } from "./accounts";

const USER_ID = "user_test_1";

async function freshDb() {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "test@example.com",
    "hash",
    "Test User",
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  return db;
}

describe("local accounts repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates an account with the same defaults as the web route", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "بانک ملی" });

    expect(account.name).toBe("بانک ملی");
    expect(account.type).toBe("BANK_ACCOUNT");
    expect(account.initialBalance).toBe(0);
    expect(account.isActive).toBe(true);
    expect(account.balance).toBe(0);
    expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honors an explicit type and initialBalance on create", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "نقد", type: "CASH", initialBalance: 500000 });

    expect(account.type).toBe("CASH");
    expect(account.initialBalance).toBe(500000);
    expect(account.balance).toBe(500000);
  });

  it("lists only the calling user's non-deleted accounts, ordered by createdAt like the web route", async () => {
    const db = await freshDb();
    createAccount(db, USER_ID, { name: "اول" });
    createAccount(db, USER_ID, { name: "دوم" });
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "other@example.com",
      "hash",
      "Other",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    const otherAccount = createAccount(db, "someone_else", { name: "غریبه" });

    const accounts = listAccounts(db, USER_ID);
    expect(accounts.map((a) => a.name)).toEqual(["اول", "دوم"]);
    expect(accounts.find((a) => a.id === otherAccount.id)).toBeUndefined();
  });

  it("computes balance from income, expense, and transfer transactions, ignoring soft-deleted ones", async () => {
    const db = await freshDb();
    const main = createAccount(db, USER_ID, { name: "اصلی", initialBalance: 1000 });
    const other = createAccount(db, USER_ID, { name: "دیگری" });
    const now = new Date().toISOString();

    db.run(`INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "tx_income",
      USER_ID,
      "INCOME",
      500,
      now,
      main.id,
      now,
      now,
    ]);
    db.run(`INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "tx_expense",
      USER_ID,
      "EXPENSE",
      200,
      now,
      main.id,
      now,
      now,
    ]);
    // Transfer OUT of `main` into `other`.
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","transferToAccountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["tx_transfer", USER_ID, "TRANSFER", 300, now, main.id, other.id, now, now]
    );
    // A soft-deleted transaction must not count toward the balance.
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt","deletedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["tx_deleted", USER_ID, "INCOME", 999999, now, main.id, now, now, now]
    );

    const accounts = listAccounts(db, USER_ID);
    const mainAccount = accounts.find((a) => a.id === main.id)!;
    const otherAccount = accounts.find((a) => a.id === other.id)!;

    // 1000 + 500 income - 200 expense - 300 transferred out = 1000
    expect(mainAccount.balance).toBe(1000);
    // 0 + 300 transferred in = 300
    expect(otherAccount.balance).toBe(300);
  });

  it("updates fields but omits balance from the response, matching the web route's PATCH", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "اول" });

    const updated = updateAccount(db, USER_ID, account.id, { name: "تغییر یافته", isActive: false });
    expect(updated.name).toBe("تغییر یافته");
    expect(updated.isActive).toBe(false);
    expect("balance" in updated).toBe(false);
  });

  it("throws a 404 ApiError for an account belonging to another user", async () => {
    const db = await freshDb();
    const account = createAccount(db, USER_ID, { name: "اول" });
    expect(() => updateAccount(db, "someone_else", account.id, { name: "دستکاری" })).toThrow("حساب پیدا نشد.");
  });

  it("blocks deleting an account that has transactions, but allows deleting one that doesn't", async () => {
    const db = await freshDb();
    const withTx = createAccount(db, USER_ID, { name: "دارای تراکنش" });
    const now = new Date().toISOString();
    db.run(`INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
      "tx_1",
      USER_ID,
      "INCOME",
      100,
      now,
      withTx.id,
      now,
      now,
    ]);

    expect(() => deleteAccount(db, USER_ID, withTx.id)).toThrow("این حساب دارای تراکنش است و نمی‌تواند حذف شود؛ آن را غیرفعال کنید.");

    const empty = createAccount(db, USER_ID, { name: "خالی" });
    const result = deleteAccount(db, USER_ID, empty.id);
    expect(result).toEqual({ ok: true });
    expect(listAccounts(db, USER_ID).find((a) => a.id === empty.id)).toBeUndefined();
  });

  it("does not count a transaction where the account is only the transfer destination toward the delete guard", async () => {
    // Mirrors the web route's exact (arguably incomplete) guard: it only checks accountId, not
    // transferToAccountId, so an account that's solely a transfer *destination* can still be
    // soft-deleted even though a transaction still references it.
    const db = await freshDb();
    const source = createAccount(db, USER_ID, { name: "مبدا" });
    const destination = createAccount(db, USER_ID, { name: "مقصد" });
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","transferToAccountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["tx_transfer", USER_ID, "TRANSFER", 100, now, source.id, destination.id, now, now]
    );

    const result = deleteAccount(db, USER_ID, destination.id);
    expect(result).toEqual({ ok: true });
  });
});
