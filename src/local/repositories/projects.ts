// On-device equivalent of src/app/api/projects/route.ts + src/app/api/projects/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/projects), same field defaults, same audit
// actions, same 404 message, so the local dispatcher (Phase 3) can return byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateProjectInput, UpdateProjectInput } from "@/lib/schemas/projects";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { createProjectCategory, renameProjectCategory, deactivateProjectCategory } from "../projectSync";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { computeRealCost } from "@/lib/timeCost";

interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  status: string;
  color: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function getOwnedRow(db: LocalDb, userId: string, id: string): ProjectRow {
  const row = db.get<ProjectRow>(`SELECT * FROM "Project" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("پروژه پیدا نشد.", 404);
  return row;
}

export function listProjects(db: LocalDb, userId: string) {
  const rows = db.all<ProjectRow>(`SELECT * FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`, [userId]);
  if (rows.length === 0) return [];

  // Mirrors the web route's `include: { _count: { select: { tasks: { where: { deletedAt: null } } } } }`.
  const counts = db.all<{ projectId: string; n: number }>(
    `SELECT "projectId" as "projectId", COUNT(*) as "n" FROM "Task"
     WHERE "deletedAt" IS NULL AND "projectId" IN (${rows.map(() => "?").join(",")})
     GROUP BY "projectId"`,
    rows.map((r) => r.id)
  );
  const countByProject = new Map(counts.map((c) => [c.projectId, c.n]));

  return rows.map((row) => ({ ...row, _count: { tasks: countByProject.get(row.id) ?? 0 } }));
}

export function getProject(db: LocalDb, userId: string, id: string) {
  const project = getOwnedRow(db, userId, id);
  // Same query the web route makes for its `tasks` field: no userId filter (ownership was
  // already checked via getOwnedRow above, and the web route trusts projectId scoping the
  // same way — it never re-checks task.userId either), no relations attached (the web route's
  // findMany here has no `include`).
  const tasks = db.all<any>(`SELECT * FROM "Task" WHERE "projectId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`, [id]);

  // Mirrors the web route's `include: { category: true }` — a plain LEFT JOIN since there's no
  // ORM here to do it for us.
  const activityRows = db.all<any>(
    `SELECT a.*, c."id" as "categoryRowId", c."name" as "categoryName", c."icon" as "categoryIcon", c."color" as "categoryColor"
     FROM "Activity" a LEFT JOIN "Category" c ON c."id" = a."categoryId"
     WHERE a."projectId" = ? AND a."deletedAt" IS NULL ORDER BY a."createdAt" DESC`,
    [id]
  );
  const activities = activityRows.map((row) => {
    const { categoryRowId, categoryName, categoryIcon, categoryColor, ...activity } = row;
    return { ...activity, category: categoryRowId ? { id: categoryRowId, name: categoryName, icon: categoryIcon, color: categoryColor } : null };
  });

  const transactions = db.all<any>(`SELECT * FROM "Transaction" WHERE "projectId" = ? AND "deletedAt" IS NULL ORDER BY "date" DESC`, [id]);
  const events = db.all<any>(`SELECT * FROM "Event" WHERE "projectId" = ? AND "deletedAt" IS NULL ORDER BY "startAt" DESC`, [id]);
  const virtualAssetEntry = db.get<any>(`SELECT * FROM "VirtualAssetEntry" WHERE "projectId" = ?`, [id]) ?? null;

  const settingsRow = db.get<any>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);
  const hourlyValue = computeHourlyValue(settingsRow ?? {});

  // Same computation as the web route: time from Activities/Tasks, money from Transactions only
  // (every Activity/Task directCost/incomeAmount is already mirrored into a linked Transaction —
  // see directCostSync.ts — so summing both here too would double-count).
  const activityDurationMin = activities.reduce((s: number, a: any) => s + a.totalDurationMin, 0);
  const taskDurationMin = tasks.reduce((s: number, t: any) => {
    if (!t.startAt || !t.endAt) return s;
    return s + Math.max(0, Math.round((new Date(t.endAt).getTime() - new Date(t.startAt).getTime()) / 60000));
  }, 0);
  const totalDurationMin = activityDurationMin + taskDurationMin;

  const directCost = transactions.filter((t: any) => t.type === "EXPENSE").reduce((s: number, t: any) => s + t.amount, 0);
  const income = transactions.filter((t: any) => t.type === "INCOME").reduce((s: number, t: any) => s + t.amount, 0);
  const { timeCost, realCost } = computeRealCost(totalDurationMin, directCost, hourlyValue);

  const doneTasks = tasks.filter((t: any) => t.status === "DONE").length;
  const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

  return {
    project,
    tasks,
    activities,
    transactions,
    events,
    virtualAssetEntry,
    summary: {
      progress,
      totalTasks: tasks.length,
      doneTasks,
      totalDurationMin,
      directCost,
      income,
      netCashFlow: income - directCost,
      timeCost,
      realCost,
    },
  };
}

export function createProject(db: LocalDb, userId: string, input: CreateProjectInput) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO "Project" ("id","userId","name","description","status","color","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, userId, input.name, input.description ?? null, input.status ?? "ACTIVE", input.color ?? "#3a8d80", now, now]
  );

  const fresh = getOwnedRow(db, userId, id);

  // Every project gets a matching category (defaults to "دارایی") so project work
  // categorizes naturally in Quick Capture — see ../projectSync.ts.
  createProjectCategory(db, fresh);

  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Project", entityId: id, newValue: fresh });
  return fresh;
}

export function updateProject(db: LocalDb, userId: string, id: string, input: UpdateProjectInput) {
  const existing = getOwnedRow(db, userId, id);
  const wasCompleted = existing.status === "COMPLETED";
  const willBeCompleted = input.status === "COMPLETED";

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", input.name);
  if (input.description !== undefined) set("description", input.description);
  if (input.status !== undefined) set("status", input.status);
  if (input.color !== undefined) set("color", input.color);
  // Matches the web route's exact ternary: completedAt is set only on a not-completed ->
  // COMPLETED transition, cleared back to null whenever the new status is anything other than
  // COMPLETED, and left untouched otherwise (no status change, or already COMPLETED).
  if (!wasCompleted && willBeCompleted) set("completedAt", now());
  else if (input.status && input.status !== "COMPLETED") set("completedAt", null);
  set("updatedAt", now());

  db.run(`UPDATE "Project" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  if (input.name && input.name !== existing.name) renameProjectCategory(db, id, input.name);

  // syncProjectCompletionAsset (src/lib/projectSync.ts) is deliberately NOT ported here — it
  // needs Activity/Task/Transaction data aggregated together, and Activity/Transaction don't
  // have local repositories yet. See src/local/projectSync.ts for the full note.

  const fresh = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, {
    userId,
    action: !wasCompleted && willBeCompleted ? "COMPLETE_PROJECT" : "UPDATE",
    entityType: "Project",
    entityId: id,
    oldValue: existing,
    newValue: fresh,
  });
  return fresh;
}

export function deleteProject(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedRow(db, userId, id);
  db.run(`UPDATE "Project" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now(), now(), id]);
  deactivateProjectCategory(db, id);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Project", entityId: id, oldValue: existing });
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}
