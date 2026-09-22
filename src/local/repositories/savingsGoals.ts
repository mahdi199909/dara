// On-device equivalent of src/app/api/savings-goals/route.ts + .../[id]/route.ts — same
// validation (shared schemas from @/lib/schemas/savingsGoals), same account-ownership guard, same
// audit actions, same 404 messages, so the local dispatcher returns byte-identical shapes
// regardless of whether it's backed by this repository or the real HTTP routes.
import { ApiError } from "@/lib/apiErrorBase";
import { parseDayKey } from "@/lib/calendarGrid";
import type { CreateSavingsGoalInput, UpdateSavingsGoalInput } from "@/lib/schemas/savingsGoals";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface SavingsGoalRow {
  id: string;
  userId: string;
  title: string;
  targetAmount: number;
  targetDate: string | null;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface AccountRow {
  id: string;
  name: string;
  type: string;
}

function requireOwnedAccount(db: LocalDb, userId: string, accountId: string) {
  const account = db.get<{ id: string }>(`SELECT "id" FROM "FinanceAccount" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [accountId, userId]);
  if (!account) throw new ApiError("حساب پیدا نشد.", 404);
}

function getOwnedRow(db: LocalDb, userId: string, id: string): SavingsGoalRow {
  const row = db.get<SavingsGoalRow>(`SELECT * FROM "SavingsGoal" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("هدف پیدا نشد.", 404);
  return row;
}

function withAccount(db: LocalDb, row: SavingsGoalRow) {
  const account = db.get<AccountRow>(`SELECT "id", "name", "type" FROM "FinanceAccount" WHERE "id" = ?`, [row.accountId]);
  return { ...row, account: account ?? null };
}

export function listSavingsGoals(db: LocalDb, userId: string) {
  const rows = db.all<SavingsGoalRow>(`SELECT * FROM "SavingsGoal" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`, [userId]);
  return rows.map((row) => withAccount(db, row));
}

export function createSavingsGoal(db: LocalDb, userId: string, input: CreateSavingsGoalInput) {
  requireOwnedAccount(db, userId, input.accountId);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const targetDate = input.targetDate ? parseDayKey(input.targetDate)!.toISOString() : null;

  db.run(
    `INSERT INTO "SavingsGoal" ("id","userId","title","targetAmount","targetDate","accountId","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, userId, input.title, input.targetAmount, targetDate, input.accountId, now, now]
  );

  const fresh = withAccount(db, getOwnedRow(db, userId, id));
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "SavingsGoal", entityId: id, newValue: fresh });
  return fresh;
}

export function updateSavingsGoal(db: LocalDb, userId: string, id: string, input: UpdateSavingsGoalInput) {
  const existing = getOwnedRow(db, userId, id);
  if (input.accountId !== undefined) requireOwnedAccount(db, userId, input.accountId);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.targetAmount !== undefined) set("targetAmount", input.targetAmount);
  if (input.targetDate !== undefined) set("targetDate", input.targetDate ? parseDayKey(input.targetDate)!.toISOString() : null);
  if (input.accountId !== undefined) set("accountId", input.accountId);
  set("updatedAt", new Date().toISOString());

  db.run(`UPDATE "SavingsGoal" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const fresh = withAccount(db, getOwnedRow(db, userId, id));
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "SavingsGoal", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteSavingsGoal(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  const ts = new Date().toISOString();
  db.run(`UPDATE "SavingsGoal" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "SavingsGoal", entityId: id, oldValue: existing });
  return { ok: true };
}
