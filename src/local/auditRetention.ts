// How long the phone keeps its own copy of the audit trail. Same default as the server (two years) — a
// person's history of what they changed should not vanish early — but a phone has far less room, so it
// is pruned on every app launch instead of waiting for a server job. Dates are compared as ISO-8601
// UTC text, which is how every local audit row stores them (see writeLocalAuditLog).
import type { LocalDb } from "./db";

export const LOCAL_AUDIT_RETENTION_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deletes audit rows older than `days` and returns how many went. Throws on a database error — the caller reports it. */
export function purgeExpiredLocalAuditLogs(db: LocalDb, now: Date = new Date(), days: number = LOCAL_AUDIT_RETENTION_DAYS): number {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  return db.run(`DELETE FROM "AuditLog" WHERE "createdAt" < ?`, [cutoff]).changes;
}
