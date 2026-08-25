// On-device equivalent of src/app/api/activities/route.ts, src/app/api/activities/[id]/route.ts,
// src/app/api/activities/[id]/time-entries/route.ts, src/app/api/activities/[id]/timer/start/route.ts,
// and src/app/api/activities/[id]/timer/stop/route.ts — same validation (shared schemas from
// @/lib/schemas/activities), same field defaults, same audit actions, same 404/400 messages, so
// the local dispatcher (Phase 3) can return byte-identical shapes regardless of whether it's
// backed by this repository or the real HTTP routes.
//
// Note on fidelity (see the web routes): the three places that attach relations each use a
// DIFFERENT `include` shape, reproduced here on purpose, not fixed:
//   - GET (list)  -> category, project, task, timeEntries (unordered), virtualAssetEntry
//   - GET (one)   -> category, project, task, timeEntries (startAt desc), virtualAssetEntry
//   - POST (create response) -> category, timeEntries (unordered), virtualAssetEntry only —
//     project/task are NOT attached here, unlike the other two.
// Also, PATCH's response/audit newValue is the bare post-update row (no relations at all), even
// though it may call recalcActivityDuration first — see the comment inside updateActivity.
//
// Deliberately NOT ported: syncDirectCostTransaction (src/lib/directCostSync.ts's
// syncActivityDirectCostTransaction, re-exported from src/lib/activityService.ts). It needs to
// write a Transaction row; src/local/repositories/transactions.ts now covers plain Transaction
// CRUD, but wiring the sync side-effect itself is out of scope for this pass — see the two
// call sites below (create/update) marked with a deferral comment instead of being silently
// dropped.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateActivityInput, UpdateActivityInput, AddTimeEntryInput } from "@/lib/schemas/activities";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { fetchByIds } from "../relations";
import { recalcActivityDuration, startTimer, stopTimer, addManualTimeEntry, type TimeEntryRow } from "../activityService";

interface ActivityRow {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  categoryId: string | null;
  taskId: string | null;
  projectId: string | null;
  totalDurationMin: number;
  directCost: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface VirtualAssetEntryRow {
  id: string;
  userId: string;
  activityId: string | null;
  taskId: string | null;
  projectId: string | null;
  habitCheckInId: string | null;
  categoryId: string | null;
  durationMin: number;
  valuePerHour: number;
  totalValue: number;
  date: string;
  createdAt: string;
}

function now(): string {
  return new Date().toISOString();
}

function getOwnedRow(db: LocalDb, userId: string, id: string): ActivityRow {
  const row = db.get<ActivityRow>(`SELECT * FROM "Activity" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("فعالیت پیدا نشد.", 404);
  return row;
}

function getTimeEntries(db: LocalDb, activityId: string, order: "asc" | "desc" | "none"): TimeEntryRow[] {
  const orderClause = order === "none" ? "" : ` ORDER BY "startAt" ${order === "desc" ? "DESC" : "ASC"}`;
  return db.all<TimeEntryRow>(`SELECT * FROM "TimeEntry" WHERE "activityId" = ?${orderClause}`, [activityId]);
}

// VirtualAssetEntry is keyed by its OWN id, with a unique `activityId` FK pointing back at
// Activity — the reverse direction from Category/Project/Task (where Activity holds the FK), so
// fetchByIds (which looks rows up by their own id) doesn't apply here; this is the one place
// that needs its own small IN-query+Map, same pattern fetchByIds uses internally.
function fetchVirtualAssetEntriesByActivityIds(db: LocalDb, activityIds: string[]): Map<string, VirtualAssetEntryRow> {
  const unique = [...new Set(activityIds)];
  if (unique.length === 0) return new Map();
  const rows = db.all<VirtualAssetEntryRow>(
    `SELECT * FROM "VirtualAssetEntry" WHERE "activityId" IN (${unique.map(() => "?").join(",")})`,
    unique
  );
  return new Map(rows.map((r) => [r.activityId as string, r]));
}

/** Mirrors GET /api/activities' include: category, project, task, timeEntries (unordered), virtualAssetEntry. */
function attachForList(db: LocalDb, rows: ActivityRow[]) {
  const categoryById = fetchByIds<{ id: string }>(db, "Category", rows.map((r) => r.categoryId));
  const projectById = fetchByIds<{ id: string }>(db, "Project", rows.map((r) => r.projectId));
  const taskById = fetchByIds<{ id: string }>(db, "Task", rows.map((r) => r.taskId));
  const vaByActivityId = fetchVirtualAssetEntriesByActivityIds(db, rows.map((r) => r.id));

  return rows.map((row) => ({
    ...row,
    category: row.categoryId ? categoryById.get(row.categoryId) ?? null : null,
    project: row.projectId ? projectById.get(row.projectId) ?? null : null,
    task: row.taskId ? taskById.get(row.taskId) ?? null : null,
    timeEntries: getTimeEntries(db, row.id, "none"),
    virtualAssetEntry: vaByActivityId.get(row.id) ?? null,
  }));
}

/** Mirrors GET /api/activities/[id]'s include: same as list, but timeEntries ordered startAt desc. */
function attachForDetail(db: LocalDb, rows: ActivityRow[]) {
  const categoryById = fetchByIds<{ id: string }>(db, "Category", rows.map((r) => r.categoryId));
  const projectById = fetchByIds<{ id: string }>(db, "Project", rows.map((r) => r.projectId));
  const taskById = fetchByIds<{ id: string }>(db, "Task", rows.map((r) => r.taskId));
  const vaByActivityId = fetchVirtualAssetEntriesByActivityIds(db, rows.map((r) => r.id));

  return rows.map((row) => ({
    ...row,
    category: row.categoryId ? categoryById.get(row.categoryId) ?? null : null,
    project: row.projectId ? projectById.get(row.projectId) ?? null : null,
    task: row.taskId ? taskById.get(row.taskId) ?? null : null,
    timeEntries: getTimeEntries(db, row.id, "desc"),
    virtualAssetEntry: vaByActivityId.get(row.id) ?? null,
  }));
}

/** Mirrors POST /api/activities' re-fetch include: category, timeEntries (unordered), virtualAssetEntry — no project/task. */
function attachForCreateResponse(db: LocalDb, rows: ActivityRow[]) {
  const categoryById = fetchByIds<{ id: string }>(db, "Category", rows.map((r) => r.categoryId));
  const vaByActivityId = fetchVirtualAssetEntriesByActivityIds(db, rows.map((r) => r.id));

  return rows.map((row) => ({
    ...row,
    category: row.categoryId ? categoryById.get(row.categoryId) ?? null : null,
    timeEntries: getTimeEntries(db, row.id, "none"),
    virtualAssetEntry: vaByActivityId.get(row.id) ?? null,
  }));
}

export function listActivities(
  db: LocalDb,
  userId: string,
  filters: { from?: string; to?: string; projectId?: string; categoryId?: string; limit?: number } = {}
) {
  const where = [`"userId" = ?`, `"deletedAt" IS NULL`];
  const params: unknown[] = [userId];
  if (filters.projectId) {
    where.push(`"projectId" = ?`);
    params.push(filters.projectId);
  }
  if (filters.categoryId) {
    where.push(`"categoryId" = ?`);
    params.push(filters.categoryId);
  }
  if (filters.from) {
    where.push(`"createdAt" >= ?`);
    params.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    where.push(`"createdAt" <= ?`);
    params.push(new Date(filters.to).toISOString());
  }

  const limit = Math.min(Number(filters.limit ?? 50), 200);

  const rows = db.all<ActivityRow>(`SELECT * FROM "Activity" WHERE ${where.join(" AND ")} ORDER BY "createdAt" DESC LIMIT ?`, [...params, limit]);
  return attachForList(db, rows);
}

export function createActivity(db: LocalDb, userId: string, input: CreateActivityInput) {
  const id = crypto.randomUUID();
  const nowIso = now();

  db.run(
    `INSERT INTO "Activity"
       ("id","userId","title","notes","categoryId","taskId","projectId","totalDurationMin","directCost","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.title,
      input.notes ?? null,
      input.categoryId ?? null,
      input.taskId ?? null,
      input.projectId ?? null,
      0,
      input.directCost ?? 0,
      nowIso,
      nowIso,
    ]
  );

  if (input.durationMin && input.durationMin > 0) {
    addManualTimeEntry(db, id, { durationMin: input.durationMin });
  } else if (input.startTimerNow) {
    startTimer(db, userId, id);
  }

  // Deferred: the web route calls syncDirectCostTransaction(activity.id) here when
  // directCost > 0 — see the file header. Skipped for this pass.

  const fresh = attachForCreateResponse(db, [db.get<ActivityRow>(`SELECT * FROM "Activity" WHERE "id" = ?`, [id])!])[0];
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Activity", entityId: id, newValue: fresh });
  return fresh;
}

export function getActivity(db: LocalDb, userId: string, id: string) {
  getOwnedRow(db, userId, id); // 404 check only; the web route re-fetches by id alone below, same as it does.
  const row = db.get<ActivityRow>(`SELECT * FROM "Activity" WHERE "id" = ?`, [id])!;
  return attachForDetail(db, [row])[0];
}

export function updateActivity(db: LocalDb, userId: string, id: string, input: UpdateActivityInput) {
  const existing = getOwnedRow(db, userId, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.notes !== undefined) set("notes", input.notes);
  if (input.categoryId !== undefined) set("categoryId", input.categoryId);
  if (input.taskId !== undefined) set("taskId", input.taskId);
  if (input.projectId !== undefined) set("projectId", input.projectId);
  if (input.directCost !== undefined) set("directCost", input.directCost);
  set("updatedAt", now());

  db.run(`UPDATE "Activity" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  // Captured immediately after the UPDATE — deliberately BEFORE recalcActivityDuration below,
  // matching the web route's exact (if a little surprising) order: its own `activity` variable
  // is what gets returned to the client AND written as the audit log's newValue, so a categoryId
  // change's effect on totalDurationMin/virtualAssetEntry is applied to the DB but NOT reflected
  // in this same response — see the file header note.
  const fresh = db.get<ActivityRow>(`SELECT * FROM "Activity" WHERE "id" = ?`, [id])!;

  if (input.categoryId !== undefined) recalcActivityDuration(db, id);
  // Deferred: the web route calls syncDirectCostTransaction(activity.id) here when
  // input.directCost !== undefined — see the file header. Skipped for this pass.

  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Activity", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteActivity(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  db.run(`UPDATE "Activity" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now(), now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Activity", entityId: id, oldValue: existing });
  return { ok: true };
}

export function addTimeEntry(db: LocalDb, userId: string, activityId: string, input: AddTimeEntryInput): TimeEntryRow {
  getOwnedRow(db, userId, activityId);

  if (!input.durationMin && !(input.startAt && input.endAt)) {
    throw new ApiError("مدت زمان یا بازه شروع/پایان را وارد کنید.", 400);
  }

  const timeEntry = addManualTimeEntry(db, activityId, {
    durationMin: input.durationMin,
    startAt: input.startAt ? new Date(input.startAt) : undefined,
    endAt: input.endAt ? new Date(input.endAt) : undefined,
  });

  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "TimeEntry", entityId: timeEntry.id, newValue: timeEntry });
  return timeEntry;
}

export function startActivityTimer(db: LocalDb, userId: string, activityId: string): TimeEntryRow {
  getOwnedRow(db, userId, activityId);

  const timeEntry = startTimer(db, userId, activityId);

  writeLocalAuditLog(db, { userId, action: "TIMER_START", entityType: "Activity", entityId: activityId, newValue: timeEntry });
  return timeEntry;
}

export function stopActivityTimer(db: LocalDb, userId: string, activityId: string): { timeEntry: TimeEntryRow; activity: ActivityRow } {
  getOwnedRow(db, userId, activityId);

  const timeEntry = stopTimer(db, activityId);
  if (!timeEntry) throw new ApiError("تایمر فعالی برای این فعالیت وجود ندارد.", 400);

  writeLocalAuditLog(db, { userId, action: "TIMER_STOP", entityType: "Activity", entityId: activityId, newValue: timeEntry });

  const activity = db.get<ActivityRow>(`SELECT * FROM "Activity" WHERE "id" = ?`, [activityId])!;
  return { timeEntry, activity };
}
