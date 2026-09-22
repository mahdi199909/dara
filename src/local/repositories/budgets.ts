// On-device equivalent of src/app/api/budgets/route.ts + src/app/api/budgets/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/budgets), same upsert-by-categoryId
// behavior, same audit actions, same 404 message, so the local dispatcher returns byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateBudgetInput, UpdateBudgetInput } from "@/lib/schemas/budgets";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface BudgetRow {
  id: string;
  userId: string;
  categoryId: string;
  monthlyCap: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  color: string;
}

function now(): string {
  return new Date().toISOString();
}

function getOwnedRow(db: LocalDb, userId: string, id: string): BudgetRow {
  const row = db.get<BudgetRow>(`SELECT * FROM "Budget" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("بودجه پیدا نشد.", 404);
  return row;
}

export function listBudgets(db: LocalDb, userId: string) {
  const rows = db.all<BudgetRow>(`SELECT * FROM "Budget" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`, [userId]);
  if (rows.length === 0) return [];

  const categories = db.all<CategoryRow>(
    `SELECT "id", "name", "icon", "color" FROM "Category" WHERE "id" IN (${rows.map(() => "?").join(",")})`,
    rows.map((r) => r.categoryId)
  );
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return rows.map((row) => ({ ...row, category: categoryById.get(row.categoryId) ?? null }));
}

/** One cap per category — mirrors the web route's own upsert-by-categoryId: "set the budget for
 * این دسته to X" is the only real request, never "create a second cap for a category that
 * already has one". */
export function createBudget(db: LocalDb, userId: string, input: CreateBudgetInput) {
  const category = db.get<{ id: string }>(`SELECT "id" FROM "Category" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [
    input.categoryId,
    userId,
  ]);
  if (!category) throw new ApiError("دسته‌بندی پیدا نشد.", 404);

  const existing = db.get<BudgetRow>(`SELECT * FROM "Budget" WHERE "categoryId" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [
    input.categoryId,
    userId,
  ]);
  const ts = now();

  if (existing) {
    db.run(`UPDATE "Budget" SET "monthlyCap" = ?, "updatedAt" = ? WHERE "id" = ?`, [input.monthlyCap, ts, existing.id]);
    const fresh = getOwnedRow(db, userId, existing.id);
    writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Budget", entityId: fresh.id, oldValue: existing, newValue: fresh });
    return fresh;
  }

  const id = crypto.randomUUID();
  db.run(`INSERT INTO "Budget" ("id", "userId", "categoryId", "monthlyCap", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`, [
    id,
    userId,
    input.categoryId,
    input.monthlyCap,
    ts,
    ts,
  ]);
  const fresh = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Budget", entityId: id, newValue: fresh });
  return fresh;
}

export function updateBudget(db: LocalDb, userId: string, id: string, input: UpdateBudgetInput) {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "Budget" SET "monthlyCap" = ?, "updatedAt" = ? WHERE "id" = ?`, [input.monthlyCap, ts, id]);
  const fresh = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Budget", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteBudget(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "Budget" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Budget", entityId: id, oldValue: existing });
  return { ok: true };
}
