// On-device port of src/lib/projectSync.ts's create/rename/deactivate rule — every Project
// gets a matching Category (same name, defaults to "دارایی") so project work categorizes
// naturally in Quick Capture — using raw SQL against the local "Category" table instead of
// Prisma. Called from src/local/repositories/projects.ts on project create/rename/soft-delete.
//
// Deliberately NOT ported: syncProjectCompletionAsset. It registers a completed project as
// its own virtual asset by summing directCost/timeCost across the project's Activities,
// Tasks, and Transactions (via @/lib/hourlyValue + @/lib/timeCost) — Activity and Transaction
// don't have local repositories yet, so porting it now would mean half-building two other
// resources before this vertical slice is done (same reasoning as src/local/repositories/
// tasks.ts's own deferred sync calls). See the comment in this repo's updateProject.
import type { LocalDb } from "./db";

export function createProjectCategory(db: LocalDb, project: { id: string; userId: string; name: string; color: string }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO "Category" ("id","userId","name","icon","color","kind","valueType","projectId","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, project.userId, project.name, "📁", project.color, "PRODUCTIVE", "ASSET", project.id, now, now]
  );

  return db.get(`SELECT * FROM "Category" WHERE "id" = ?`, [id]);
}

export function renameProjectCategory(db: LocalDb, projectId: string, name: string) {
  db.run(`UPDATE "Category" SET "name" = ?, "updatedAt" = ? WHERE "projectId" = ?`, [name, new Date().toISOString(), projectId]);
}

/** Soft-deleting a project deactivates (not deletes) its category, preserving historical categorization on past tasks/transactions. */
export function deactivateProjectCategory(db: LocalDb, projectId: string) {
  db.run(`UPDATE "Category" SET "isActive" = 0, "updatedAt" = ? WHERE "projectId" = ?`, [new Date().toISOString(), projectId]);
}
