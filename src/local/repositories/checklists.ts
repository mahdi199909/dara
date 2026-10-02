// On-device equivalent of src/lib/checklistsServer.ts (+ the /api/checklists routes) — same
// validation (shared schemas from @/lib/schemas/checklists), the same tree rules
// (src/lib/checklistTree.ts), the same 404 message and response shapes.
import { ApiError } from "@/lib/apiErrorBase";
import { computeCheckChange, computeMove, computeMoveTo, computeRecheck, descendantIds, nextSortOrder, type TreeRow } from "@/lib/checklistTree";
import type { ChecklistItemDto, ChecklistTreeNode, CreateChecklistItemInput, CreateChecklistItemsInput, CreateChecklistTreeInput, UpdateChecklistItemInput } from "@/lib/schemas/checklists";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface ChecklistRow {
  id: string;
  userId: string;
  parentId: string | null;
  title: string;
  note: string | null;
  checked: number;
  checkedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const NOT_FOUND = "مورد چک‌لیست پیدا نشد.";

function now() {
  return new Date().toISOString();
}

function toDto(row: ChecklistRow): ChecklistItemDto {
  return {
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    note: row.note,
    checked: !!row.checked,
    checkedAt: row.checkedAt,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getOwnedRow(db: LocalDb, userId: string, id: string): ChecklistRow {
  const row = db.get<ChecklistRow>(`SELECT * FROM "ChecklistItem" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError(NOT_FOUND, 404);
  return row;
}

function treeRows(db: LocalDb, userId: string): TreeRow[] {
  return db
    .all<{ id: string; parentId: string | null; checked: number; sortOrder: number; createdAt: string }>(
      `SELECT "id","parentId","checked","sortOrder","createdAt" FROM "ChecklistItem" WHERE "userId" = ? AND "deletedAt" IS NULL`,
      [userId]
    )
    .map((r) => ({ ...r, checked: !!r.checked }));
}

function placeholders(n: number) {
  return Array.from({ length: n }, () => "?").join(",");
}

function applyChange(db: LocalDb, { check, uncheck }: { check: string[]; uncheck: string[] }) {
  const ts = now();
  if (check.length > 0) db.run(`UPDATE "ChecklistItem" SET "checked" = 1, "checkedAt" = ?, "updatedAt" = ? WHERE "id" IN (${placeholders(check.length)})`, [ts, ts, ...check]);
  if (uncheck.length > 0) db.run(`UPDATE "ChecklistItem" SET "checked" = 0, "checkedAt" = NULL, "updatedAt" = ? WHERE "id" IN (${placeholders(uncheck.length)})`, [ts, ...uncheck]);
}

function insert(db: LocalDb, userId: string, parentId: string | null, title: string, note: string | null, sortOrder: number): string {
  const id = crypto.randomUUID();
  const ts = now();
  db.run(`INSERT INTO "ChecklistItem" ("id","userId","parentId","title","note","checked","sortOrder","createdAt","updatedAt") VALUES (?,?,?,?,?,0,?,?,?)`, [
    id,
    userId,
    parentId,
    title,
    note,
    sortOrder,
    ts,
    ts,
  ]);
  return id;
}

export function listChecklistItems(db: LocalDb, userId: string): ChecklistItemDto[] {
  return db.all<ChecklistRow>(`SELECT * FROM "ChecklistItem" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "sortOrder" ASC, "createdAt" ASC`, [userId]).map(toDto);
}

export function createChecklistItem(db: LocalDb, userId: string, input: CreateChecklistItemInput): ChecklistItemDto {
  const parentId = input.parentId ?? null;
  if (parentId) getOwnedRow(db, userId, parentId);
  const id = insert(db, userId, parentId, input.title, input.note || null, nextSortOrder(treeRows(db, userId), parentId));
  // A new unticked item under a ticked one: the items above are no longer all done.
  if (parentId) applyChange(db, computeRecheck(treeRows(db, userId), parentId));
  const row = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "ChecklistItem", entityId: id, newValue: row });
  return toDto(row);
}

export function createChecklistItems(db: LocalDb, userId: string, input: CreateChecklistItemsInput): ChecklistItemDto[] {
  getOwnedRow(db, userId, input.parentId);
  let order = nextSortOrder(treeRows(db, userId), input.parentId);
  const ids = input.titles.map((title) => insert(db, userId, input.parentId, title, null, order++));
  applyChange(db, computeRecheck(treeRows(db, userId), input.parentId));
  return ids.map((id) => {
    const row = getOwnedRow(db, userId, id);
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "ChecklistItem", entityId: id, newValue: row });
    return toDto(row);
  });
}

/** A whole nested list in one go (a ready-made checklist). Returns every created item, the top one first. */
export function createChecklistTree(db: LocalDb, userId: string, input: CreateChecklistTreeInput): ChecklistItemDto[] {
  const parentId = input.parentId ?? null;
  if (parentId) getOwnedRow(db, userId, parentId);
  const ids: string[] = [];
  const add = (node: ChecklistTreeNode, parent: string | null, sortOrder: number) => {
    const id = insert(db, userId, parent, node.title, node.note || null, sortOrder);
    ids.push(id);
    (node.children ?? []).forEach((child, i) => add(child, id, i));
  };
  add(input.tree, parentId, nextSortOrder(treeRows(db, userId), parentId));
  if (parentId) applyChange(db, computeRecheck(treeRows(db, userId), parentId));
  return ids.map((id) => {
    const row = getOwnedRow(db, userId, id);
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "ChecklistItem", entityId: id, newValue: row });
    return toDto(row);
  });
}

export function updateChecklistItem(db: LocalDb, userId: string, id: string, input: UpdateChecklistItemInput): ChecklistItemDto {
  const existing = getOwnedRow(db, userId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.title !== undefined) {
    sets.push(`"title" = ?`);
    params.push(input.title);
  }
  if (input.note !== undefined) {
    sets.push(`"note" = ?`);
    params.push(input.note || null);
  }
  if (sets.length > 0) {
    sets.push(`"updatedAt" = ?`);
    params.push(now());
    db.run(`UPDATE "ChecklistItem" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);
  }
  if (input.checked !== undefined) applyChange(db, computeCheckChange(treeRows(db, userId), id, input.checked));
  if (input.move || input.position !== undefined) {
    const ts = now();
    const rows = treeRows(db, userId);
    const changes = input.position !== undefined ? computeMoveTo(rows, id, input.position) : computeMove(rows, id, input.move!);
    for (const change of changes) {
      db.run(`UPDATE "ChecklistItem" SET "sortOrder" = ?, "updatedAt" = ? WHERE "id" = ?`, [change.sortOrder, ts, change.id]);
    }
  }
  const row = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "ChecklistItem", entityId: id, oldValue: existing, newValue: row });
  return toDto(row);
}

/** Unticks the item and everything below it, so the list can be used again. */
export function resetChecklistItem(db: LocalDb, userId: string, id: string): { ok: true; reset: number } {
  const existing = getOwnedRow(db, userId, id);
  const rows = treeRows(db, userId);
  const ids = [id, ...descendantIds(rows, id)].filter((target) => rows.find((r) => r.id === target)?.checked);
  if (ids.length > 0) applyChange(db, { check: [], uncheck: ids });
  if (existing.parentId) applyChange(db, computeRecheck(treeRows(db, userId), existing.parentId));
  writeLocalAuditLog(db, { userId, action: "CHECKLIST_RESET", entityType: "ChecklistItem", entityId: id, metadata: { reset: ids.length } });
  return { ok: true, reset: ids.length };
}

/** Deletes the item with everything below it. */
export function deleteChecklistItem(db: LocalDb, userId: string, id: string): { ok: true; deleted: number } {
  const existing = getOwnedRow(db, userId, id);
  const ids = [id, ...descendantIds(treeRows(db, userId), id)];
  const ts = now();
  db.run(`UPDATE "ChecklistItem" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" IN (${placeholders(ids.length)})`, [ts, ts, ...ids]);
  if (existing.parentId) applyChange(db, computeRecheck(treeRows(db, userId), existing.parentId));
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "ChecklistItem", entityId: id, oldValue: existing, metadata: { deletedCount: ids.length } });
  return { ok: true, deleted: ids.length };
}
