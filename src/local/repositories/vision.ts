// On-device equivalent of src/lib/visionServer.ts (+ the /api/vision routes) — same validation (shared
// schemas from @/lib/schemas/vision), same order, same 404 messages and response shapes. The progress is
// worked out by src/lib/vision.ts, the same code the server runs.
import { ApiError } from "@/lib/apiErrorBase";
import {
  computeVisionItems,
  contributionsOf,
  type VisionEntryRow,
  type VisionItemRow,
  type VisionProjectRow,
  type VisionTaskRow,
} from "@/lib/vision";
import {
  VISION_MESSAGES,
  type CreateVisionEntryInput,
  type CreateVisionItemInput,
  type UpdateVisionItemInput,
  type VisionDetailDto,
  type VisionEntryView,
  type VisionItemDto,
  type VisionProjectView,
} from "@/lib/schemas/vision";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface VisionItemDbRow extends VisionItemRow {
  userId: string;
  deletedAt: string | null;
}

interface ProjectDbRow {
  id: string;
  userId: string;
  name: string;
  status: string;
  color: string;
  visionItemId: string | null;
}

function now() {
  return new Date().toISOString();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function readLinkedProjects(db: LocalDb, userId: string): Array<VisionProjectView & { visionItemId: string }> {
  const projects = db.all<ProjectDbRow>(
    `SELECT "id","userId","name","status","color","visionItemId" FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL AND "visionItemId" IS NOT NULL`,
    [userId]
  );
  if (projects.length === 0) return [];
  const tasks = db.all<{ projectId: string; status: string }>(
    `SELECT "projectId","status" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "projectId" IN (${placeholders(projects.length)})`,
    [userId, ...projects.map((p) => p.id)]
  );
  return projects.map((p) => {
    const own = tasks.filter((t) => t.projectId === p.id);
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      color: p.color,
      visionItemId: p.visionItemId as string,
      taskTotal: own.length,
      taskDone: own.filter((t) => t.status === "DONE").length,
    };
  });
}

function readAll(db: LocalDb, userId: string) {
  const itemRows = db.all<VisionItemDbRow>(`SELECT * FROM "VisionItem" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "sortOrder" ASC, "createdAt" ASC`, [userId]);
  const entryRows = db.all<VisionEntryRow>(`SELECT "id","itemId","value","date","note" FROM "VisionEntry" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]);
  const taskRows = db.all<VisionTaskRow>(
    `SELECT "id","title","visionItemId","visionValue","completedAt","dueDate","createdAt" FROM "Task"
      WHERE "userId" = ? AND "deletedAt" IS NULL AND "status" = 'DONE' AND "visionItemId" IS NOT NULL`,
    [userId]
  );
  const projects = readLinkedProjects(db, userId);
  const projectRows: VisionProjectRow[] = projects.map((p) => ({ id: p.id, visionItemId: p.visionItemId, taskTotal: p.taskTotal, taskDone: p.taskDone }));
  return { itemRows, entryRows, taskRows, projects, projectRows };
}

function getOwnedRow(db: LocalDb, userId: string, id: string): VisionItemDbRow {
  const row = db.get<VisionItemDbRow>(`SELECT * FROM "VisionItem" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError(VISION_MESSAGES.notFound, 404);
  return row;
}

/** A task may only be linked to one of this person's own goals. */
export function assertVisionItemOwned(db: LocalDb, userId: string, visionItemId: string): void {
  getOwnedRow(db, userId, visionItemId);
}

/** Every vision and goal with its progress worked out, in the person's own order. */
export function listVision(db: LocalDb, userId: string): VisionItemDto[] {
  const all = readAll(db, userId);
  return computeVisionItems(all.itemRows, all.entryRows, all.taskRows, all.projectRows);
}

function oneVisionDto(db: LocalDb, userId: string, id: string): VisionItemDto {
  const found = listVision(db, userId).find((i) => i.id === id);
  if (!found) throw new ApiError(VISION_MESSAGES.notFound, 404);
  return found;
}

export function getVisionDetail(db: LocalDb, userId: string, id: string): VisionDetailDto {
  getOwnedRow(db, userId, id);
  const all = readAll(db, userId);
  const item = computeVisionItems(all.itemRows, all.entryRows, all.taskRows, all.projectRows).find((i) => i.id === id)!;
  return {
    item,
    entries: contributionsOf(id, all.entryRows, all.taskRows),
    projects: all.projects.filter((p) => p.visionItemId === id).map(({ visionItemId: _unused, ...view }) => view),
  };
}

/** One level only: a goal goes under a vision, and a vision that has goals cannot itself go under another. */
function assertParent(db: LocalDb, userId: string, parentId: string | null, selfId: string | null): void {
  if (parentId === null) return;
  if (parentId === selfId) throw new ApiError(VISION_MESSAGES.parentMustBeVision, 400);
  const parent = db.get<VisionItemDbRow>(`SELECT * FROM "VisionItem" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [parentId, userId]);
  if (!parent) throw new ApiError(VISION_MESSAGES.notFound, 404);
  if (parent.parentId !== null) throw new ApiError(VISION_MESSAGES.parentMustBeVision, 400);
  if (selfId) {
    const hasGoals = db.get<{ n: number }>(`SELECT COUNT(*) AS "n" FROM "VisionItem" WHERE "userId" = ? AND "parentId" = ? AND "deletedAt" IS NULL`, [userId, selfId]);
    if ((hasGoals?.n ?? 0) > 0) throw new ApiError(VISION_MESSAGES.hasGoals, 400);
  }
}

export function createVisionItem(db: LocalDb, userId: string, input: CreateVisionItemInput): VisionItemDto {
  const parentId = input.parentId ?? null;
  assertParent(db, userId, parentId, null);
  const last = db.get<{ top: number | null }>(
    `SELECT MAX("sortOrder") AS "top" FROM "VisionItem" WHERE "userId" = ? AND "deletedAt" IS NULL AND "parentId" IS ?`,
    [userId, parentId]
  );
  const id = crypto.randomUUID();
  const ts = now();
  db.run(
    `INSERT INTO "VisionItem"
       ("id","userId","parentId","title","description","icon","color","status","sortOrder","unit","startValue","targetValue","mode","targetDate","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      parentId,
      input.title,
      input.description ?? null,
      input.icon ?? null,
      input.color ?? "#3a8d80",
      "ACTIVE",
      (last?.top ?? -1) + 1,
      input.unit ?? null,
      input.startValue ?? 0,
      input.targetValue ?? null,
      input.mode ?? "ADD",
      input.targetDate ? new Date(input.targetDate).toISOString() : null,
      ts,
      ts,
    ]
  );
  const dto = oneVisionDto(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "VisionItem", entityId: id, newValue: dto });
  return dto;
}

export function updateVisionItem(db: LocalDb, userId: string, id: string, input: UpdateVisionItemInput): VisionItemDto {
  const existing = getOwnedRow(db, userId, id);
  if (input.parentId !== undefined) assertParent(db, userId, input.parentId, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`"${column}" = ?`);
    params.push(value);
  };
  if (input.parentId !== undefined) set("parentId", input.parentId);
  if (input.title !== undefined) set("title", input.title);
  if (input.description !== undefined) set("description", input.description);
  if (input.icon !== undefined) set("icon", input.icon);
  if (input.color !== undefined) set("color", input.color);
  if (input.unit !== undefined) set("unit", input.unit);
  if (input.startValue !== undefined) set("startValue", input.startValue);
  if (input.targetValue !== undefined) set("targetValue", input.targetValue);
  if (input.mode !== undefined) set("mode", input.mode);
  if (input.sortOrder !== undefined) set("sortOrder", input.sortOrder);
  if (input.targetDate !== undefined) set("targetDate", input.targetDate ? new Date(input.targetDate).toISOString() : null);
  if (input.status !== undefined && input.status !== existing.status) {
    set("status", input.status);
    set("achievedAt", input.status === "ACHIEVED" ? now() : null);
  }
  set("updatedAt", now());
  db.run(`UPDATE "VisionItem" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const dto = oneVisionDto(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "VisionItem", entityId: id, oldValue: existing, newValue: dto });
  return dto;
}

/** Deleting a vision takes its goals with it; the tasks and projects that pointed at any of them are simply unlinked. */
export function deleteVisionItem(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedRow(db, userId, id);
  const goals = db.all<{ id: string }>(`SELECT "id" FROM "VisionItem" WHERE "userId" = ? AND "parentId" = ? AND "deletedAt" IS NULL`, [userId, id]);
  const ids = [id, ...goals.map((g) => g.id)];
  const marks = placeholders(ids.length);
  const ts = now();
  db.run(`UPDATE "VisionItem" SET "deletedAt" = ?, "updatedAt" = ? WHERE "userId" = ? AND "id" IN (${marks})`, [ts, ts, userId, ...ids]);
  db.run(`UPDATE "VisionEntry" SET "deletedAt" = ?, "updatedAt" = ? WHERE "userId" = ? AND "itemId" IN (${marks}) AND "deletedAt" IS NULL`, [ts, ts, userId, ...ids]);
  db.run(`UPDATE "Task" SET "visionItemId" = NULL, "visionValue" = NULL, "updatedAt" = ? WHERE "userId" = ? AND "visionItemId" IN (${marks})`, [ts, userId, ...ids]);
  db.run(`UPDATE "Project" SET "visionItemId" = NULL, "updatedAt" = ? WHERE "userId" = ? AND "visionItemId" IN (${marks})`, [ts, userId, ...ids]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "VisionItem", entityId: id, oldValue: existing });
  return { ok: true };
}

export function addVisionEntry(db: LocalDb, userId: string, id: string, input: CreateVisionEntryInput): VisionEntryView {
  getOwnedRow(db, userId, id);
  const entryId = crypto.randomUUID();
  const ts = now();
  const date = input.date ? new Date(input.date).toISOString() : ts;
  db.run(`INSERT INTO "VisionEntry" ("id","userId","itemId","value","date","note","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [
    entryId,
    userId,
    id,
    input.value,
    date,
    input.note ?? null,
    ts,
    ts,
  ]);
  const view: VisionEntryView = { id: entryId, kind: "MANUAL", value: input.value, date, note: input.note ?? null, taskId: null, title: null };
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "VisionEntry", entityId: entryId, newValue: view });
  return view;
}

function getOwnedEntry(db: LocalDb, userId: string, id: string, entryId: string) {
  const row = db.get<Record<string, unknown>>(`SELECT * FROM "VisionEntry" WHERE "id" = ? AND "itemId" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [entryId, id, userId]);
  if (!row) throw new ApiError(VISION_MESSAGES.entryNotFound, 404);
  return row;
}

export function deleteVisionEntry(db: LocalDb, userId: string, id: string, entryId: string): { ok: true } {
  const existing = getOwnedEntry(db, userId, id, entryId);
  const ts = now();
  db.run(`UPDATE "VisionEntry" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, entryId]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "VisionEntry", entityId: entryId, oldValue: existing });
  return { ok: true };
}

/** Puts an existing project under a goal. */
export function linkVisionProject(db: LocalDb, userId: string, id: string, projectId: string) {
  getOwnedRow(db, userId, id);
  const before = db.get<Record<string, unknown>>(`SELECT * FROM "Project" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [projectId, userId]);
  if (!before) throw new ApiError(VISION_MESSAGES.projectNotFound, 404);
  db.run(`UPDATE "Project" SET "visionItemId" = ?, "updatedAt" = ? WHERE "id" = ?`, [id, now(), projectId]);
  const after = db.get<Record<string, unknown>>(`SELECT * FROM "Project" WHERE "id" = ?`, [projectId])!;
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Project", entityId: projectId, oldValue: before, newValue: after });
  return { project: after };
}

/** Takes a project out from under a goal (the project itself stays). */
export function unlinkVisionProject(db: LocalDb, userId: string, id: string, projectId: string) {
  getOwnedRow(db, userId, id);
  const before = db.get<Record<string, unknown>>(`SELECT * FROM "Project" WHERE "id" = ? AND "userId" = ? AND "visionItemId" = ? AND "deletedAt" IS NULL`, [projectId, userId, id]);
  if (!before) throw new ApiError(VISION_MESSAGES.projectNotFound, 404);
  db.run(`UPDATE "Project" SET "visionItemId" = NULL, "updatedAt" = ? WHERE "id" = ?`, [now(), projectId]);
  const after = db.get<Record<string, unknown>>(`SELECT * FROM "Project" WHERE "id" = ?`, [projectId])!;
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Project", entityId: projectId, oldValue: before, newValue: after });
  return { project: after };
}
