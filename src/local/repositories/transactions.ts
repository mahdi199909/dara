// On-device equivalent of src/app/api/transactions/route.ts + src/app/api/transactions/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/transactions), same field defaults, same
// audit actions, same 404/409 messages, so the local dispatcher (Phase 3) can return
// byte-identical shapes regardless of whether it's backed by this repository or the real HTTP
// routes.
//
// Note on fidelity (see the web routes): the GET (list) handler's `include` is
// { category, account, project, task, asset } only — NOT transferToAccount, activity, event, or
// installment, even though those are all valid FKs on Transaction. Also, unlike GET, the POST
// and PATCH handlers do NOT re-fetch with `include` at all — their responses (and the audit log
// newValue/oldValue) are the bare row. Both asymmetries are reproduced here on purpose, not fixed.
//
// Deliberately NOT ported here: the linking side-effects other features layer on top of a plain
// transaction (e.g. src/lib/directCostSync.ts, the installment "pay" action). Those build their
// own Transaction rows by calling into this same create/update, so they're out of scope for this
// file — it only covers the direct /api/transactions CRUD surface.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateTransactionInput, UpdateTransactionInput } from "@/lib/schemas/transactions";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { fetchByIds } from "../relations";

interface TransactionRow {
  id: string;
  userId: string;
  type: string;
  amount: number;
  date: string;
  description: string | null;
  accountId: string;
  transferToAccountId: string | null;
  categoryId: string | null;
  taskId: string | null;
  projectId: string | null;
  assetId: string | null;
  activityId: string | null;
  eventId: string | null;
  installmentId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Attaches the same 5 relations the web route's GET `include` fetches — nothing more. */
function attachRelations(db: LocalDb, rows: TransactionRow[]) {
  const categoryById = fetchByIds<{ id: string }>(db, "Category", rows.map((r) => r.categoryId));
  const accountById = fetchByIds<{ id: string }>(db, "FinanceAccount", rows.map((r) => r.accountId));
  const projectById = fetchByIds<{ id: string }>(db, "Project", rows.map((r) => r.projectId));
  const taskById = fetchByIds<{ id: string }>(db, "Task", rows.map((r) => r.taskId));
  const assetById = fetchByIds<{ id: string }>(db, "Asset", rows.map((r) => r.assetId));

  return rows.map((row) => ({
    ...row,
    category: row.categoryId ? categoryById.get(row.categoryId) ?? null : null,
    account: accountById.get(row.accountId) ?? null,
    project: row.projectId ? projectById.get(row.projectId) ?? null : null,
    task: row.taskId ? taskById.get(row.taskId) ?? null : null,
    asset: row.assetId ? assetById.get(row.assetId) ?? null : null,
  }));
}

function getOwnedRow(db: LocalDb, userId: string, id: string): TransactionRow {
  const row = db.get<TransactionRow>(`SELECT * FROM "Transaction" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("تراکنش پیدا نشد.", 404);
  return row;
}

export function listTransactions(
  db: LocalDb,
  userId: string,
  filters: { from?: string; to?: string; type?: string; accountId?: string; limit?: number } = {}
) {
  const where = [`"userId" = ?`, `"deletedAt" IS NULL`];
  const params: unknown[] = [userId];

  if (filters.type) {
    where.push(`"type" = ?`);
    params.push(filters.type);
  }
  if (filters.accountId) {
    where.push(`"accountId" = ?`);
    params.push(filters.accountId);
  }
  if (filters.from) {
    where.push(`"date" >= ?`);
    params.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    where.push(`"date" <= ?`);
    params.push(new Date(filters.to).toISOString());
  }

  const limit = Math.min(filters.limit ?? 100, 500);

  const rows = db.all<TransactionRow>(`SELECT * FROM "Transaction" WHERE ${where.join(" AND ")} ORDER BY "date" DESC LIMIT ?`, [...params, limit]);
  return attachRelations(db, rows);
}

export function createTransaction(db: LocalDb, userId: string, input: CreateTransactionInput) {
  const account = db.get<{ id: string }>(`SELECT "id" FROM "FinanceAccount" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [
    input.accountId,
    userId,
  ]);
  if (!account) throw new ApiError("حساب مبدا پیدا نشد.", 404);

  if (input.type === "TRANSFER") {
    if (!input.transferToAccountId) throw new ApiError("حساب مقصد برای انتقال الزامی است.", 400);
    const dest = db.get<{ id: string }>(`SELECT "id" FROM "FinanceAccount" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [
      input.transferToAccountId,
      userId,
    ]);
    if (!dest) throw new ApiError("حساب مقصد پیدا نشد.", 404);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const date = input.date ? new Date(input.date).toISOString() : now;

  db.run(
    `INSERT INTO "Transaction"
       ("id","userId","type","amount","date","description","accountId","transferToAccountId","categoryId","taskId","projectId","assetId","activityId","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.type,
      input.amount,
      date,
      input.description ?? null,
      input.accountId,
      // Matches the web route's exact rule: transferToAccountId is only persisted for TRANSFER,
      // even if the body included it for an INCOME/EXPENSE transaction.
      input.type === "TRANSFER" ? input.transferToAccountId ?? null : null,
      input.categoryId ?? null,
      input.taskId ?? null,
      input.projectId ?? null,
      input.assetId ?? null,
      input.activityId ?? null,
      now,
      now,
    ]
  );

  // No attachRelations() here — matches the web route's POST response, which returns the bare
  // prisma.transaction.create() result with no `include`.
  const fresh = db.get<TransactionRow>(`SELECT * FROM "Transaction" WHERE "id" = ?`, [id])!;
  writeLocalAuditLog(db, {
    userId,
    action: input.type === "INCOME" ? "CREATE_INCOME" : input.type === "EXPENSE" ? "CREATE_EXPENSE" : "CREATE_TRANSFER",
    entityType: "Transaction",
    entityId: id,
    newValue: fresh,
  });
  return fresh;
}

export function updateTransaction(db: LocalDb, userId: string, id: string, input: UpdateTransactionInput) {
  const existing = getOwnedRow(db, userId, id);
  if (existing.installmentId) throw new ApiError("تراکنش‌های مرتبط با قسط از این مسیر قابل ویرایش نیستند.", 409);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.amount !== undefined) set("amount", input.amount);
  if (input.date !== undefined) set("date", new Date(input.date).toISOString());
  if (input.description !== undefined) set("description", input.description);
  if (input.categoryId !== undefined) set("categoryId", input.categoryId);
  if (input.projectId !== undefined) set("projectId", input.projectId);
  if (input.taskId !== undefined) set("taskId", input.taskId);
  set("updatedAt", new Date().toISOString());

  db.run(`UPDATE "Transaction" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  // No attachRelations() here either — matches the web route's PATCH response.
  const fresh = db.get<TransactionRow>(`SELECT * FROM "Transaction" WHERE "id" = ?`, [id])!;
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Transaction", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteTransaction(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  if (existing.installmentId) throw new ApiError("تراکنش‌های مرتبط با قسط از این مسیر قابل حذف نیستند.", 409);

  db.run(`UPDATE "Transaction" SET "deletedAt" = ? WHERE "id" = ?`, [new Date().toISOString(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Transaction", entityId: id, oldValue: existing });
  return { ok: true };
}
