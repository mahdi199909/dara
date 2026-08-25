// On-device equivalent of src/app/api/categories/route.ts + src/app/api/categories/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/categories), same field defaults, same audit
// actions, same 404 message, so the local dispatcher (Phase 3) can return byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateCategoryInput, UpdateCategoryInput } from "@/lib/schemas/categories";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface CategoryRow {
  id: string;
  userId: string;
  name: string;
  icon: string | null;
  color: string;
  kind: string;
  valueType: string;
  isActive: number;
  generatesVirtualAsset: number;
  virtualAssetValuePerHour: number | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// SQLite has no native boolean type — isActive/generatesVirtualAsset come back from the
// driver as 0/1, but the web route's Prisma-backed JSON has real JS booleans, so cast here to
// keep the two shapes identical (same pattern as reportEngine.ts's `isActive: !!h.isActive`
// for Habit).
function toCategory(row: CategoryRow) {
  return { ...row, isActive: !!row.isActive, generatesVirtualAsset: !!row.generatesVirtualAsset };
}

function getOwnedRow(db: LocalDb, userId: string, id: string) {
  const row = db.get<CategoryRow>(`SELECT * FROM "Category" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("دسته‌بندی پیدا نشد.", 404);
  return toCategory(row);
}

// Matches the web route exactly: the list is filtered only by deletedAt, NOT by isActive —
// deactivated categories (e.g. from a soft-deleted project, see projectSync.ts) still show up.
export function listCategories(db: LocalDb, userId: string) {
  const rows = db.all<CategoryRow>(`SELECT * FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`, [userId]);
  return rows.map(toCategory);
}

export function createCategory(db: LocalDb, userId: string, input: CreateCategoryInput) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO "Category"
       ("id","userId","name","icon","color","kind","valueType","isActive","generatesVirtualAsset","virtualAssetValuePerHour","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.name,
      input.icon ?? null,
      input.color ?? "#3a8d80",
      input.kind ?? "NEUTRAL",
      input.valueType ?? "EXPENSE",
      1, // isActive — not settable on create by the web route's own schema, always starts true
      input.generatesVirtualAsset ? 1 : 0,
      input.virtualAssetValuePerHour ?? null,
      now,
      now,
    ]
  );

  const fresh = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Category", entityId: id, newValue: fresh });
  return fresh;
}

export function updateCategory(db: LocalDb, userId: string, id: string, input: UpdateCategoryInput) {
  const existing = getOwnedRow(db, userId, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", input.name);
  if (input.icon !== undefined) set("icon", input.icon);
  if (input.color !== undefined) set("color", input.color);
  if (input.kind !== undefined) set("kind", input.kind);
  if (input.valueType !== undefined) set("valueType", input.valueType);
  if (input.isActive !== undefined) set("isActive", input.isActive ? 1 : 0);
  if (input.generatesVirtualAsset !== undefined) set("generatesVirtualAsset", input.generatesVirtualAsset ? 1 : 0);
  if (input.virtualAssetValuePerHour !== undefined) set("virtualAssetValuePerHour", input.virtualAssetValuePerHour);
  set("updatedAt", now());

  db.run(`UPDATE "Category" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const fresh = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Category", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteCategory(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  db.run(`UPDATE "Category" SET "deletedAt" = ? WHERE "id" = ?`, [now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Category", entityId: id, oldValue: existing });
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}
