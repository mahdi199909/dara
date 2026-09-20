// How long the server keeps the audit trail. Independent of the application log (which is kept for
// days): the audit is the person's own history of their data and is kept for years — two by default.
//
//   AUDIT_RETENTION_DAYS   unset → 730;  a number of days;  0 / off / never / forever → keep everything
//
// Runs once shortly after the server starts and then daily, from src/instrumentation.ts. Old rows go
// with a single DELETE by date; nothing else is touched. Every run is one line in the application log.
import { prisma } from "./db";
import { getLogger } from "./observability";

const log = getLogger(null, "audit-retention");

export const DEFAULT_AUDIT_RETENTION_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;
/** After a restart the server is busy with its first requests; the purge can wait a few minutes. */
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const JOB = "audit-retention";

/** The retention in days, or null when the trail is to be kept forever. Anything unparseable falls back to the default. */
export function auditRetentionDays(raw: string | undefined = process.env.AUDIT_RETENTION_DAYS): number | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return DEFAULT_AUDIT_RETENTION_DAYS;
  if (text === "off" || text === "never" || text === "forever" || text === "0") return null;
  const days = Number(text);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_AUDIT_RETENTION_DAYS;
}

export interface PurgeResult {
  deleted: number;
  cutoff: Date;
  retentionDays: number;
}

/** Deletes audit entries older than the retention. Returns null when retention is off or the run failed (which it reports). Never throws. */
export async function purgeExpiredAuditLogs(now: Date = new Date(), days: number | null = auditRetentionDays()): Promise<PurgeResult | null> {
  if (days === null) {
    log.debug("JOB_SKIPPED", { job: JOB, reason: "retention is off (AUDIT_RETENTION_DAYS)" });
    return null;
  }
  const started = Date.now();
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  try {
    log.debug("JOB_STARTED", { job: JOB, retentionDays: days, cutoff: cutoff.toISOString() });
    const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    log.log(count > 0 ? "INFO" : "DEBUG", "JOB_COMPLETED", { job: JOB, deleted: count, retentionDays: days, cutoff: cutoff.toISOString(), durationMs: Date.now() - started });
    return { deleted: count, cutoff, retentionDays: days };
  } catch (error) {
    log.error("JOB_FAILED", { job: JOB, error, retentionDays: days, durationMs: Date.now() - started });
    return null;
  }
}

const STARTED_KEY = Symbol.for("parva.jobs.auditRetention.v1");

/** Schedules the purge: once, a few minutes after start, then every 24 hours. The timers never keep the process alive. */
export function startAuditRetentionJob(): void {
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[STARTED_KEY]) return; // a hot reload or a second bundle must not double the timers
  holder[STARTED_KEY] = true;
  const run = () => void purgeExpiredAuditLogs();
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  setInterval(run, DAY_MS).unref();
}
