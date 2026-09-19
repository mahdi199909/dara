// On-device port of src/lib/projectSync.ts's create/rename/deactivate rule — every Project
// gets a matching Category (same name, defaults to "دارایی") so project work categorizes
// naturally in Quick Capture — using raw SQL against the local "Category" table instead of
// Prisma. Called from src/local/repositories/projects.ts on project create/rename/soft-delete.
//
// syncProjectCompletionAsset (bottom of this file) registers a completed project as its own
// virtual asset by summing directCost/timeCost across the project's Activities, Tasks and
// Transactions. It used to be left out of this port ("Activity and Transaction don't have local
// repositories yet") long after those repositories existed, so completing a project on the phone
// never credited its value to "سرمایه من" while completing it on the web did.
import { computeHourlyValue } from "@/lib/hourlyValue";
import { computeTimeCost } from "@/lib/timeCost";
import type { LocalDb } from "./db";
import { deleteRowsWithTombstones } from "./tombstones";

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

/**
 * Marking a project COMPLETED registers it as its own virtual asset — the real cost
 * (direct cost + time cost) invested across all its tasks/activities/transactions,
 * representing "this finished project is itself worth what you put into it." Un-completing
 * removes the entry again. Mirrors src/lib/projectSync.ts's syncProjectCompletionAsset.
 */
export function syncProjectCompletionAsset(db: LocalDb, projectId: string) {
  const project = db.get<any>(`SELECT * FROM "Project" WHERE "id" = ?`, [projectId]);
  if (!project) throw new Error(`Project ${projectId} not found`);

  if (project.status !== "COMPLETED") {
    deleteRowsWithTombstones(db, "VirtualAssetEntry", '"projectId" = ?', [projectId]);
    return;
  }

  const settings = db.get<any>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [project.userId]);
  const activities = db.all<any>(`SELECT * FROM "Activity" WHERE "projectId" = ? AND "deletedAt" IS NULL`, [projectId]);
  const tasks = db.all<any>(`SELECT * FROM "Task" WHERE "projectId" = ? AND "deletedAt" IS NULL`, [projectId]);
  const transactions = db.all<any>(`SELECT * FROM "Transaction" WHERE "projectId" = ? AND "deletedAt" IS NULL`, [projectId]);

  const hourlyValue = computeHourlyValue(settings ?? {});

  const activityDurationMin = activities.reduce((s: number, a: any) => s + a.totalDurationMin, 0);
  const taskDurationMin = tasks.reduce((s: number, t: any) => {
    if (!t.startAt || !t.endAt) return s;
    return s + Math.max(0, Math.round((new Date(t.endAt).getTime() - new Date(t.startAt).getTime()) / 60000));
  }, 0);
  const totalDurationMin = activityDurationMin + taskDurationMin;

  const directCost =
    activities.reduce((s: number, a: any) => s + a.directCost, 0) +
    tasks.reduce((s: number, t: any) => s + t.directCost, 0) +
    transactions.filter((t: any) => t.type === "EXPENSE" && !t.activityId && !t.taskId).reduce((s: number, t: any) => s + t.amount, 0);

  const timeCost = computeTimeCost(totalDurationMin, hourlyValue);
  const totalValue = directCost + timeCost;

  if (totalValue <= 0) {
    deleteRowsWithTombstones(db, "VirtualAssetEntry", '"projectId" = ?', [projectId]);
    return;
  }

  const date = project.completedAt ?? new Date().toISOString();
  const now = new Date().toISOString();
  const existing = db.get<{ id: string }>(`SELECT "id" FROM "VirtualAssetEntry" WHERE "projectId" = ?`, [projectId]);
  if (existing) {
    db.run(`UPDATE "VirtualAssetEntry" SET "durationMin" = ?, "valuePerHour" = ?, "totalValue" = ?, "date" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      totalDurationMin,
      hourlyValue,
      totalValue,
      date,
      now,
      existing.id,
    ]);
  } else {
    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","projectId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), project.userId, projectId, totalDurationMin, hourlyValue, totalValue, date, now, now]
    );
  }
}
