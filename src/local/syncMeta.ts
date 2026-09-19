// Small persistent notebook for the sync engine, in two local-only tables created by db.ts's
// bootstrap (neither exists on the web side, and neither is synced):
//  - _local_sync_meta: key/value facts that must outlive a logout, which wipes the license cache
//    (and with it the sync cursors) — chiefly "which server account does this device's data
//    belong to" and "up to when has the server acknowledged my deletions".
//  - _local_sync_issues: rows the server refused, with the reason it gave, so they're retried on
//    later syncs (a parent that hadn't arrived yet) and shown to the person if they never succeed.
import type { LocalDb } from "./db";

export const META_LINKED_USER_ID = "linkedRemoteUserId";
export const META_LINKED_EMAIL = "linkedRemoteEmail";
export const META_TOMBSTONES_ACKED_AT = "tombstonesAckedAt";
export const META_LAST_OK_AT = "lastSyncOkAt";
export const META_LAST_ERROR = "lastSyncError";

export function getSyncMeta(db: LocalDb, key: string): string | null {
  const row = db.get<{ value: string | null }>(`SELECT "value" FROM "_local_sync_meta" WHERE "key" = ?`, [key]);
  return row?.value ?? null;
}

export function setSyncMeta(db: LocalDb, key: string, value: string | null): void {
  if (value === null) {
    db.run(`DELETE FROM "_local_sync_meta" WHERE "key" = ?`, [key]);
    return;
  }
  db.run(`INSERT INTO "_local_sync_meta" ("key","value") VALUES (?,?) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`, [key, value]);
}

export interface SyncIssue {
  tbl: string;
  rowId: string;
  reason: string;
  attempts: number;
  at: string;
}

export function recordSyncIssue(db: LocalDb, tbl: string, rowId: string, reason: string): void {
  db.run(
    `INSERT INTO "_local_sync_issues" ("tbl","rowId","reason","attempts","at") VALUES (?,?,?,1,?)
     ON CONFLICT("tbl","rowId") DO UPDATE SET "reason" = excluded."reason", "attempts" = "attempts" + 1, "at" = excluded."at"`,
    [tbl, rowId, reason.slice(0, 300), new Date().toISOString()]
  );
}

export function clearSyncIssue(db: LocalDb, tbl: string, rowId: string): void {
  db.run(`DELETE FROM "_local_sync_issues" WHERE "tbl" = ? AND "rowId" = ?`, [tbl, rowId]);
}

export function listSyncIssues(db: LocalDb): SyncIssue[] {
  return db.all<SyncIssue>(`SELECT "tbl","rowId","reason","attempts","at" FROM "_local_sync_issues" ORDER BY "at" DESC`);
}

export function clearAllSyncIssues(db: LocalDb): void {
  db.run(`DELETE FROM "_local_sync_issues"`);
}

const RETRY_FREE_ATTEMPTS = 3;
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Issues worth re-sending now: the first few attempts happen on every sync (an FK ordering
 * problem usually resolves by itself), after that at most once per cooldown so one permanently
 * bad row can't make every sync heavier. */
export function retryableIssues(db: LocalDb): SyncIssue[] {
  const cutoff = Date.now() - RETRY_COOLDOWN_MS;
  return listSyncIssues(db).filter((i) => i.attempts < RETRY_FREE_ATTEMPTS || new Date(i.at).getTime() < cutoff);
}
