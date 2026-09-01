// On-device equivalent of src/app/api/tasks/route.ts + src/app/api/tasks/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/tasks), same field defaults, same audit
// actions, same 404 message, so the local dispatcher (Phase 3) can return byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
//
// Deliberately NOT ported yet: syncTaskDirectCostTransaction / syncTaskIncomeTransaction /
// syncTaskVirtualAsset (see @/lib/directCostSync). Those need local Transaction and
// VirtualAssetEntry repositories, which are Phase 4's job — porting them here would mean
// half-building two other resources before this vertical slice is even done.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateTaskInput, UpdateTaskInput } from "@/lib/schemas/tasks";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { fetchByIds } from "../relations";

interface TaskRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  categoryId: string | null;
  projectId: string | null;
  estimatedCost: number | null;
  completedAt: string | null;
  valueType: string;
  directCost: number;
  incomeAmount: number;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function attachRelations(db: LocalDb, rows: TaskRow[]) {
  const categoryById = fetchByIds<{ id: string }>(db, "Category", rows.map((r) => r.categoryId));
  const projectById = fetchByIds<{ id: string }>(db, "Project", rows.map((r) => r.projectId));

  return rows.map((row) => ({
    ...row,
    category: row.categoryId ? categoryById.get(row.categoryId) ?? null : null,
    project: row.projectId ? projectById.get(row.projectId) ?? null : null,
  }));
}

function getOwnedRow(db: LocalDb, userId: string, id: string): TaskRow {
  const row = db.get<TaskRow>(`SELECT * FROM "Task" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("کار پیدا نشد.", 404);
  return row;
}

function getTaskById(db: LocalDb, userId: string, id: string) {
  const row = db.get<TaskRow>(`SELECT * FROM "Task" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  return row ? attachRelations(db, [row])[0] : null;
}

export function listTasks(db: LocalDb, userId: string, filters: { status?: string; projectId?: string } = {}) {
  const where = [`"userId" = ?`, `"deletedAt" IS NULL`];
  const params: unknown[] = [userId];
  if (filters.status) {
    where.push(`"status" = ?`);
    params.push(filters.status);
  }
  if (filters.projectId) {
    where.push(`"projectId" = ?`);
    params.push(filters.projectId);
  }

  const rows = db.all<TaskRow>(
    `SELECT * FROM "Task" WHERE ${where.join(" AND ")} ORDER BY "status" ASC, "dueDate" ASC, "createdAt" DESC`,
    params
  );
  return attachRelations(db, rows);
}

export function createTask(db: LocalDb, userId: string, input: CreateTaskInput) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO "Task"
       ("id","userId","title","description","status","dueDate","categoryId","projectId","estimatedCost","valueType","directCost","incomeAmount","startAt","endAt","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.title,
      input.description ?? null,
      input.status ?? "TODO",
      input.dueDate ?? null,
      input.categoryId ?? null,
      input.projectId ?? null,
      input.estimatedCost ?? null,
      input.valueType ?? "EXPENSE",
      input.directCost ?? 0,
      input.incomeAmount ?? 0,
      input.startAt ?? null,
      input.endAt ?? null,
      now,
      now,
    ]
  );

  const fresh = getTaskById(db, userId, id)!;
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: id, newValue: fresh });
  return fresh;
}

export function updateTask(db: LocalDb, userId: string, id: string, input: UpdateTaskInput) {
  const existing = getOwnedRow(db, userId, id);
  const wasDone = existing.status === "DONE";
  const willBeDone = input.status === "DONE";

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.description !== undefined) set("description", input.description);
  if (input.status !== undefined) set("status", input.status);
  if (input.dueDate !== undefined) set("dueDate", input.dueDate);
  if (input.categoryId !== undefined) set("categoryId", input.categoryId);
  if (input.projectId !== undefined) set("projectId", input.projectId);
  if (input.estimatedCost !== undefined) set("estimatedCost", input.estimatedCost);
  if (input.valueType !== undefined) set("valueType", input.valueType);
  if (input.directCost !== undefined) set("directCost", input.directCost);
  if (input.incomeAmount !== undefined) set("incomeAmount", input.incomeAmount);
  if (input.startAt !== undefined) set("startAt", input.startAt);
  if (input.endAt !== undefined) set("endAt", input.endAt);
  // Matches the web route's exact (slightly surprising) rule: completedAt is only left
  // untouched when this PATCH flips DONE->not-done is false AND wasn't already not-done —
  // see the route's ternary. Kept identical here on purpose for local/web output parity.
  set("completedAt", !wasDone && willBeDone ? now() : willBeDone === false ? null : existing.completedAt);
  set("updatedAt", now());

  db.run(`UPDATE "Task" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const fresh = getTaskById(db, userId, id)!;
  writeLocalAuditLog(db, {
    userId,
    action: !wasDone && willBeDone ? "COMPLETE_TASK" : "UPDATE",
    entityType: "Task",
    entityId: id,
    oldValue: existing,
    newValue: fresh,
  });
  return fresh;
}

export function deleteTask(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  db.run(`UPDATE "Task" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now(), now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Task", entityId: id, oldValue: existing });
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}
