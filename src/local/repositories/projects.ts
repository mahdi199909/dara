// On-device equivalent of src/app/api/projects/route.ts + src/app/api/projects/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/projects), same field defaults, same audit
// actions, same 404 message, so the local dispatcher (Phase 3) can return byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
//
// Deliberately NOT ported: the web GET-one route also aggregates Activity/Transaction/Event/
// Settings/VirtualAssetEntry data into a `summary` (progress, totalDurationMin, directCost,
// income, timeCost, realCost, ...) — see src/app/api/projects/[id]/route.ts. Those resources
// don't have local repositories yet, so getProject below only returns the project and its
// tasks (Task already has a repository — src/local/repositories/tasks.ts). Wiring up the full
// summary is follow-on work once Activity/Transaction/Event get their own local repositories —
// same reasoning as skipping syncProjectCompletionAsset (see the comment in updateProject
// below, and src/local/projectSync.ts).
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateProjectInput, UpdateProjectInput } from "@/lib/schemas/projects";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { createProjectCategory, renameProjectCategory, deactivateProjectCategory } from "../projectSync";

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
  const tasks = db.all(`SELECT * FROM "Task" WHERE "projectId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`, [id]);
  return { project, tasks };
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
  db.run(`UPDATE "Project" SET "deletedAt" = ? WHERE "id" = ?`, [now(), id]);
  deactivateProjectCategory(db, id);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Project", entityId: id, oldValue: existing });
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}
