// On-device port of src/lib/activityService.ts. Every formula/branch below is copied
// verbatim from there — only the data access changes (raw SQL instead of Prisma), plus the
// `db` handle every function now needs as its first parameter.
//
// Deliberately NOT ported: syncActivityDirectCostTransaction (re-exported from there as
// syncDirectCostTransaction). It needs a local Transaction repository — src/local/repositories/
// transactions.ts now covers plain Transaction CRUD, but the sync side-effect itself is out of
// scope for this pass; see the deferral comments in src/local/repositories/activities.ts at the
// two call sites (create/update) the web routes would have made it from.
//
// Porting note on startTimer: the web version force-stops running timers in two passes
// (an updateMany, then a re-query for rows still missing a durationMin) because Prisma's
// updateMany doesn't return the rows it touched. Raw SQL doesn't have that limitation, so this
// version reads the running rows first and updates each one directly in a single pass — same
// net result (every other running timer for the user gets stopped, durationMin computed, and
// its activity's duration recalculated), just without the two-phase dance. One behavioral
// corner this simplifies away: the web version's second pass matches // *any* TimeEntry stuck
// with isRunning=false/endAt-set/durationMin=null, which in practice can only be one it just
// force-stopped (or one orphaned by a crash between its two passes) — moot here since this
// version never leaves that transient state observable between passes.
import { computeVirtualAssetValue } from "@/lib/timeCost";
import type { LocalDb } from "./db";

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

interface CategoryVARow {
  id: string;
  generatesVirtualAsset: number;
  virtualAssetValuePerHour: number | null;
}

export interface TimeEntryRow {
  id: string;
  activityId: string;
  startAt: string;
  endAt: string | null;
  durationMin: number | null;
  isRunning: number;
  createdAt: string;
  updatedAt: string;
}

function now(): string {
  return new Date().toISOString();
}

/** Recomputes Activity.totalDurationMin from its TimeEntries and syncs the VirtualAssetEntry (create/update/delete). */
export function recalcActivityDuration(db: LocalDb, activityId: string): number {
  const activity = db.get<ActivityRow>(`SELECT * FROM "Activity" WHERE "id" = ?`, [activityId]);
  if (!activity) throw new Error(`Activity ${activityId} not found`);

  const timeEntries = db.all<{ durationMin: number | null }>(`SELECT "durationMin" FROM "TimeEntry" WHERE "activityId" = ?`, [activityId]);
  const totalDurationMin = timeEntries.reduce((sum, te) => sum + (te.durationMin ?? 0), 0);

  // Prisma's @updatedAt bumps Activity.updatedAt on this .update() call even though only
  // totalDurationMin is in `data` — replicated here by setting it explicitly.
  db.run(`UPDATE "Activity" SET "totalDurationMin" = ?, "updatedAt" = ? WHERE "id" = ?`, [totalDurationMin, now(), activityId]);

  const cat = activity.categoryId
    ? db.get<CategoryVARow>(`SELECT "id","generatesVirtualAsset","virtualAssetValuePerHour" FROM "Category" WHERE "id" = ?`, [activity.categoryId])
    : null;

  if (cat?.generatesVirtualAsset && cat.virtualAssetValuePerHour && totalDurationMin > 0) {
    const totalValue = computeVirtualAssetValue(totalDurationMin, cat.virtualAssetValuePerHour);
    const existing = db.get<{ id: string }>(`SELECT "id" FROM "VirtualAssetEntry" WHERE "activityId" = ?`, [activityId]);

    if (existing) {
      db.run(
        `UPDATE "VirtualAssetEntry" SET "categoryId" = ?, "durationMin" = ?, "valuePerHour" = ?, "totalValue" = ? WHERE "activityId" = ?`,
        [cat.id, totalDurationMin, cat.virtualAssetValuePerHour, totalValue, activityId]
      );
    } else {
      db.run(
        `INSERT INTO "VirtualAssetEntry" ("id","userId","activityId","categoryId","durationMin","valuePerHour","totalValue","date","createdAt")
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), activity.userId, activityId, cat.id, totalDurationMin, cat.virtualAssetValuePerHour, totalValue, activity.createdAt, now()]
      );
    }
  } else {
    db.run(`DELETE FROM "VirtualAssetEntry" WHERE "activityId" = ?`, [activityId]);
  }

  return totalDurationMin;
}

/** Force-stops any other running timer for the user (recalculating its activity's duration), then starts a new running TimeEntry on `activityId`. */
export function startTimer(db: LocalDb, userId: string, activityId: string): TimeEntryRow {
  const stopAt = now();

  const runningForUser = db.all<TimeEntryRow>(
    `SELECT te.* FROM "TimeEntry" te JOIN "Activity" a ON a."id" = te."activityId" WHERE a."userId" = ? AND te."isRunning" = 1`,
    [userId]
  );
  for (const te of runningForUser) {
    const durationMin = Math.max(0, Math.round((new Date(stopAt).getTime() - new Date(te.startAt).getTime()) / 60000));
    db.run(`UPDATE "TimeEntry" SET "isRunning" = 0, "endAt" = ?, "durationMin" = ?, "updatedAt" = ? WHERE "id" = ?`, [stopAt, durationMin, stopAt, te.id]);
    recalcActivityDuration(db, te.activityId);
  }

  const id = crypto.randomUUID();
  const startAt = now();
  db.run(`INSERT INTO "TimeEntry" ("id","activityId","startAt","isRunning","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    id,
    activityId,
    startAt,
    1,
    startAt,
    startAt,
  ]);
  return db.get<TimeEntryRow>(`SELECT * FROM "TimeEntry" WHERE "id" = ?`, [id])!;
}

/** Stops the running TimeEntry for `activityId` (if any) and recalculates its Activity's duration. Returns null if nothing was running. */
export function stopTimer(db: LocalDb, activityId: string): TimeEntryRow | null {
  const running = db.get<TimeEntryRow>(`SELECT * FROM "TimeEntry" WHERE "activityId" = ? AND "isRunning" = 1`, [activityId]);
  if (!running) return null;

  const endAt = now();
  const durationMin = Math.max(0, Math.round((new Date(endAt).getTime() - new Date(running.startAt).getTime()) / 60000));

  db.run(`UPDATE "TimeEntry" SET "endAt" = ?, "durationMin" = ?, "isRunning" = 0, "updatedAt" = ? WHERE "id" = ?`, [endAt, durationMin, endAt, running.id]);

  recalcActivityDuration(db, activityId);

  return db.get<TimeEntryRow>(`SELECT * FROM "TimeEntry" WHERE "id" = ?`, [running.id])!;
}

/** The three-branches-of-input logic, exactly as written in src/lib/activityService.ts: durationMin only / startAt+endAt / startAt+durationMin. */
export function addManualTimeEntry(db: LocalDb, activityId: string, input: { startAt?: Date; endAt?: Date; durationMin?: number }): TimeEntryRow {
  let { startAt, endAt, durationMin } = input;

  if (durationMin && !startAt && !endAt) {
    endAt = new Date();
    startAt = new Date(endAt.getTime() - durationMin * 60000);
  } else if (startAt && endAt) {
    durationMin = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000));
  } else if (startAt && durationMin) {
    endAt = new Date(startAt.getTime() + durationMin * 60000);
  } else {
    throw new Error("Either durationMin or both startAt/endAt must be provided");
  }

  const id = crypto.randomUUID();
  const nowIso = now();
  db.run(
    `INSERT INTO "TimeEntry" ("id","activityId","startAt","endAt","durationMin","isRunning","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, activityId, startAt.toISOString(), endAt.toISOString(), durationMin, 0, nowIso, nowIso]
  );

  recalcActivityDuration(db, activityId);

  return db.get<TimeEntryRow>(`SELECT * FROM "TimeEntry" WHERE "id" = ?`, [id])!;
}
