// On-device equivalent of src/app/api/accounts/route.ts + src/app/api/accounts/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/accounts), same balance computation, same
// audit actions, same error messages, so the local dispatcher (Phase 3) can return byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
//
// Note on fidelity (see the web routes): GET (list) and POST (create) both return the account
// with a computed `balance` field, but PATCH does NOT (the web route's PATCH handler responds
// with the raw prisma.financeAccount.update() result, never re-wrapped in withBalance) — that
// asymmetry is reproduced here on purpose, not fixed.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateAccountInput, UpdateAccountInput } from "@/lib/schemas/accounts";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface FinanceAccountRow {
  id: string;
  userId: string;
  name: string;
  type: string;
  initialBalance: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Converts SQLite's integer boolean storage to a real boolean, matching Prisma's JSON shape. */
function toAccount(row: FinanceAccountRow) {
  return { ...row, isActive: !!row.isActive };
}

function sumAmount(db: LocalDb, sql: string, params: unknown[]): number {
  const result = db.get<{ total: number | null }>(sql, params);
  return result?.total ?? 0;
}

/** Local equivalent of the web route's withBalance(): initialBalance +/- non-deleted transactions touching this account. */
function withBalance(db: LocalDb, row: FinanceAccountRow) {
  const income = sumAmount(
    db,
    `SELECT SUM("amount") as total FROM "Transaction" WHERE "accountId" = ? AND "type" = 'INCOME' AND "deletedAt" IS NULL`,
    [row.id]
  );
  const expense = sumAmount(
    db,
    `SELECT SUM("amount") as total FROM "Transaction" WHERE "accountId" = ? AND "type" = 'EXPENSE' AND "deletedAt" IS NULL`,
    [row.id]
  );
  const transferOut = sumAmount(
    db,
    `SELECT SUM("amount") as total FROM "Transaction" WHERE "accountId" = ? AND "type" = 'TRANSFER' AND "deletedAt" IS NULL`,
    [row.id]
  );
  const transferIn = sumAmount(
    db,
    `SELECT SUM("amount") as total FROM "Transaction" WHERE "transferToAccountId" = ? AND "type" = 'TRANSFER' AND "deletedAt" IS NULL`,
    [row.id]
  );
  const balance = row.initialBalance + income - expense - transferOut + transferIn;
  return { ...toAccount(row), balance };
}

function getOwnedRow(db: LocalDb, userId: string, id: string): FinanceAccountRow {
  const row = db.get<FinanceAccountRow>(`SELECT * FROM "FinanceAccount" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("حساب پیدا نشد.", 404);
  return row;
}

export function listAccounts(db: LocalDb, userId: string) {
  const rows = db.all<FinanceAccountRow>(`SELECT * FROM "FinanceAccount" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`, [userId]);
  return rows.map((row) => withBalance(db, row));
}

export function createAccount(db: LocalDb, userId: string, input: CreateAccountInput) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO "FinanceAccount" ("id","userId","name","type","initialBalance","isActive","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, userId, input.name, input.type ?? "BANK_ACCOUNT", input.initialBalance ?? 0, 1, now, now]
  );

  const row = db.get<FinanceAccountRow>(`SELECT * FROM "FinanceAccount" WHERE "id" = ?`, [id])!;
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "FinanceAccount", entityId: id, newValue: toAccount(row) });
  return withBalance(db, row);
}

export function updateAccount(db: LocalDb, userId: string, id: string, input: UpdateAccountInput) {
  const existing = getOwnedRow(db, userId, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", input.name);
  if (input.type !== undefined) set("type", input.type);
  if (input.isActive !== undefined) set("isActive", input.isActive ? 1 : 0);
  set("updatedAt", new Date().toISOString());

  db.run(`UPDATE "FinanceAccount" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const row = db.get<FinanceAccountRow>(`SELECT * FROM "FinanceAccount" WHERE "id" = ?`, [id])!;
  const fresh = toAccount(row); // no withBalance() here — matches the web route's PATCH response
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "FinanceAccount", entityId: id, oldValue: toAccount(existing), newValue: fresh });
  return fresh;
}

export function deleteAccount(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);

  // Matches the web route's guard exactly: only counts transactions where this account is the
  // primary accountId, not ones where it's only a transferToAccountId (transfer destination).
  const txCount = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Transaction" WHERE "accountId" = ? AND "deletedAt" IS NULL`, [id])!.n;
  if (txCount > 0) {
    throw new ApiError("این حساب دارای تراکنش است و نمی‌تواند حذف شود؛ آن را غیرفعال کنید.", 409);
  }

  db.run(`UPDATE "FinanceAccount" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [new Date().toISOString(), new Date().toISOString(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "FinanceAccount", entityId: id, oldValue: toAccount(existing) });
  return { ok: true };
}
