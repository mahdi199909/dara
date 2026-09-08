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
  sortOrder: number;
  generatesVirtualAsset: number;
  virtualAssetValuePerHour: number | null;
  projectId: string | null;
  parentCategoryId: string | null;
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

/** Throws if parentCategoryId doesn't name an active category owned by this same user, or if
 * that category is itself already a sub-category — this schema only supports one level of
 * nesting (see prisma/schema.prisma's own comment on Category.parentCategoryId), so a
 * sub-category can never become a parent. */
function assertValidParent(db: LocalDb, userId: string, parentCategoryId: string) {
  const parent = db.get<{ parentCategoryId: string | null }>(
    `SELECT "parentCategoryId" FROM "Category" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`,
    [parentCategoryId, userId]
  );
  if (!parent) throw new ApiError("دسته‌بندی والد پیدا نشد.", 404);
  if (parent.parentCategoryId) throw new ApiError("یک زیردسته نمی‌تواند خودش والدِ دسته‌ی دیگری باشد.", 422);
}

// Matches the web route exactly: the list is filtered only by deletedAt, NOT by isActive —
// deactivated categories (e.g. from a soft-deleted project, see projectSync.ts) still show up.
// sortOrder first (the user's own explicit ordering — see reorderCategories), createdAt as the
// tiebreaker for anything never explicitly reordered (every row defaults to sortOrder 0, so
// without this secondary key they'd otherwise come back in undefined/storage order).
export function listCategories(db: LocalDb, userId: string) {
  const rows = db.all<CategoryRow>(
    `SELECT * FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "sortOrder" ASC, "createdAt" ASC`,
    [userId]
  );
  return rows.map(toCategory);
}

export function createCategory(db: LocalDb, userId: string, input: CreateCategoryInput) {
  if (input.parentCategoryId) assertValidParent(db, userId, input.parentCategoryId);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // New categories join at the end of the user's own order, not at sortOrder 0 alongside
  // whatever an un-reordered install already has sitting there.
  const maxSortOrder = db.get<{ maxSortOrder: number | null }>(`SELECT MAX("sortOrder") as "maxSortOrder" FROM "Category" WHERE "userId" = ?`, [userId]);
  const sortOrder = (maxSortOrder?.maxSortOrder ?? -1) + 1;

  db.run(
    `INSERT INTO "Category"
       ("id","userId","name","icon","color","kind","valueType","isActive","sortOrder","generatesVirtualAsset","virtualAssetValuePerHour","parentCategoryId","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.name,
      input.icon ?? null,
      input.color ?? "#3a8d80",
      input.kind ?? "NEUTRAL",
      input.valueType ?? "EXPENSE",
      1, // isActive — not settable on create by the web route's own schema, always starts true
      sortOrder,
      input.generatesVirtualAsset ? 1 : 0,
      input.virtualAssetValuePerHour ?? null,
      input.parentCategoryId ?? null,
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
  if (input.parentCategoryId) {
    if (input.parentCategoryId === id) throw new ApiError("یک دسته‌بندی نمی‌تواند والدِ خودش باشد.", 422);
    assertValidParent(db, userId, input.parentCategoryId);
  }

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
  if (input.parentCategoryId !== undefined) set("parentCategoryId", input.parentCategoryId);
  set("updatedAt", now());

  db.run(`UPDATE "Category" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const fresh = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Category", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteCategory(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  const now_ = now();
  db.run(`UPDATE "Category" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now_, now_, id]);
  // Mirrors the schema's onDelete: SetNull for parentCategoryId — a soft-delete never runs the
  // database's own FK action, so any sub-category of this one would otherwise keep pointing at a
  // now-deleted parent forever.
  db.run(`UPDATE "Category" SET "parentCategoryId" = NULL, "updatedAt" = ? WHERE "parentCategoryId" = ? AND "userId" = ?`, [now_, id, userId]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Category", entityId: id, oldValue: existing });
  return { ok: true };
}

/** Applies a full explicit order in one shot — see reorderCategoriesSchema's own doc comment for
 * why this takes the whole list rather than one-off "move to position N" calls. Ids the caller
 * doesn't own (or that don't exist / are already deleted) are silently skipped rather than
 * thrown on, since a stale client-side list (a category deleted from another device, not yet
 * synced) shouldn't block reordering everything else. */
export function reorderCategories(db: LocalDb, userId: string, orderedIds: string[]) {
  const owned = new Set(
    db.all<{ id: string }>(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]).map((r) => r.id)
  );
  const now_ = now();
  let sortOrder = 0;
  for (const id of orderedIds) {
    if (!owned.has(id)) continue;
    db.run(`UPDATE "Category" SET "sortOrder" = ?, "updatedAt" = ? WHERE "id" = ?`, [sortOrder, now_, id]);
    sortOrder++;
  }
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}
