// Phone-side half of deletion sync — see TOMBSTONE_TABLES in src/lib/syncTables.ts for the why.
// Every place the app hard-DELETEs a row from one of those tables goes through here, so the
// deletion is remembered in SyncTombstone (the same Prisma-derived table the server has; local
// rows use the placeholder LOCAL_USER_ID like every other local row) and reaches the server, and
// through it every other device, on the next push. A bare `DELETE FROM` would leave the other
// side's copy standing forever.
import { TOMBSTONE_TABLES } from "@/lib/syncTables";
import type { LocalDb } from "./db";
import { LOCAL_USER_ID } from "./localUser";

export function recordLocalTombstone(db: LocalDb, table: string, rowId: string, at: string = new Date().toISOString()): void {
  // A device has exactly one local user (LOCAL_USER_ID in production); use whichever row exists so
  // the userId foreign key always holds — a bare constant would break any database whose single
  // user was created under another id.
  const userId = db.get<{ id: string }>(`SELECT "id" FROM "User" ORDER BY "createdAt" LIMIT 1`)?.id ?? LOCAL_USER_ID;
  db.run(
    `INSERT INTO "SyncTombstone" ("id","userId","table","rowId","deletedAt") VALUES (?,?,?,?,?)
     ON CONFLICT("userId","table","rowId") DO UPDATE SET "deletedAt" = excluded."deletedAt"`,
    [crypto.randomUUID(), userId, table, rowId, at]
  );
}

/** Deletes every row of `table` matching the raw `whereSql` (e.g. `"habitCheckInId" = ?`) and
 * records a tombstone for each. Returns how many rows went away. */
export function deleteRowsWithTombstones(db: LocalDb, table: string, whereSql: string, params: unknown[]): number {
  if (!TOMBSTONE_TABLES.includes(table)) throw new Error(`"${table}" is not a tombstoned table`);
  const ids = db.all<{ id: string }>(`SELECT "id" FROM "${table}" WHERE ${whereSql}`, params).map((r) => r.id);
  if (ids.length === 0) return 0;
  db.run(`DELETE FROM "${table}" WHERE ${whereSql}`, params);
  const at = new Date().toISOString();
  for (const id of ids) recordLocalTombstone(db, table, id, at);
  return ids.length;
}

export interface LocalTombstone {
  table: string;
  id: string;
  deletedAt: string;
}

/** Deletions made on this device after `since` (null = all of them). */
export function listLocalTombstonesSince(db: LocalDb, since: string | null): LocalTombstone[] {
  const rows = since
    ? db.all<{ table: string; rowId: string; deletedAt: string }>(`SELECT "table","rowId","deletedAt" FROM "SyncTombstone" WHERE "deletedAt" > ?`, [since])
    : db.all<{ table: string; rowId: string; deletedAt: string }>(`SELECT "table","rowId","deletedAt" FROM "SyncTombstone"`);
  return rows.map((r) => ({ table: r.table, id: r.rowId, deletedAt: r.deletedAt }));
}

/** True when this device deleted `rowId` at or after `stamp` — used to keep a row the server
 * still has (because it hasn't received the deletion yet) from being resurrected by a pull. */
export function hasLocalTombstoneAtOrAfter(db: LocalDb, table: string, rowId: string, stamp: string): boolean {
  const t = db.get<{ deletedAt: string }>(`SELECT "deletedAt" FROM "SyncTombstone" WHERE "table" = ? AND "rowId" = ?`, [table, rowId]);
  return !!t && new Date(t.deletedAt).getTime() >= new Date(stamp).getTime();
}

/** Applies a deletion that came FROM the server: removes the row (and the derived rows hanging
 * off it, since SQLite foreign-key cascades aren't reliably enabled on-device) without recording
 * a new tombstone — the server already knows. */
export function applyRemoteTombstone(db: LocalDb, table: string, rowId: string): void {
  if (!TOMBSTONE_TABLES.includes(table)) return;
  if (table === "HabitCheckIn") db.run(`DELETE FROM "VirtualAssetEntry" WHERE "habitCheckInId" = ?`, [rowId]);
  db.run(`DELETE FROM "${table}" WHERE "id" = ?`, [rowId]);
  // A tombstone we hold for the same row is now redundant with the server's.
  db.run(`DELETE FROM "SyncTombstone" WHERE "table" = ? AND "rowId" = ?`, [table, rowId]);
}
