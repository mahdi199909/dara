// How long the server keeps its application log files. Independent of the audit trail (which is kept for years — see
// auditRetention.ts): these are the records that explain what the system did, and they are kept for days.
//
//   LOG_RETENTION_DAYS   default 14 (7, 14, 30 and 90 are the usual choices); 0 / off / never / forever: until the size ceiling
//
// The rotating file sink already deletes what has expired whenever it rotates; this job does it on a schedule as
// well, for a quiet server that may not rotate for days. It runs a few minutes after start and then daily (from
// src/instrumentation.ts), and every run is one line in the application log and one count in jobs_total.
import { getLogger } from "./observability";
import { recordJob } from "./observability/server/jobMetrics";
import { getServerLogSinks } from "./observability/server/serverSinks";

const log = getLogger(null, "log-retention");

const DAY_MS = 24 * 60 * 60 * 1000;
/** After a restart the server is busy with its first requests; the clean-up can wait a few minutes. */
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;
const JOB = "log-retention";

export interface LogPurgeResult {
  removed: number;
  retentionDays: number | null;
}

/** Applies the retention to the server's log files. Returns null when there is no file log or the run failed (which it reports). Never throws. */
export async function purgeExpiredLogFiles(): Promise<LogPurgeResult | null> {
  const sinks = getServerLogSinks();
  if (!sinks?.file) {
    log.debug("JOB_SKIPPED", { job: JOB, reason: "no log file is configured (LOG_FILE_DIR)" });
    recordJob(JOB, "skipped");
    return null;
  }
  const started = Date.now();
  const retentionDays = sinks.config.file?.retentionDays ?? null;
  try {
    log.debug("JOB_STARTED", { job: JOB, retentionDays });
    const removed = await sinks.file.sink.pruneNow();
    const durationMs = Date.now() - started;
    log.log(removed > 0 ? "INFO" : "DEBUG", "JOB_COMPLETED", { job: JOB, deleted: removed, retentionDays, durationMs });
    recordJob(JOB, "completed", durationMs);
    return { removed, retentionDays };
  } catch (error) {
    const durationMs = Date.now() - started;
    log.error("JOB_FAILED", { job: JOB, error, retentionDays, durationMs });
    recordJob(JOB, "failed", durationMs);
    return null;
  }
}

const STARTED_KEY = Symbol.for("parva.jobs.logRetention.v1");

/** Schedules the clean-up: once, a few minutes after start, then every 24 hours. The timers never keep the process alive. */
export function startLogRetentionJob(): void {
  const holder = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (holder[STARTED_KEY]) return; // a hot reload or a second bundle must not double the timers
  holder[STARTED_KEY] = true;
  const run = () => void purgeExpiredLogFiles();
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  setInterval(run, DAY_MS).unref();
}
