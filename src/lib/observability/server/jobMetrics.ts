// The counters a "failed jobs" panel is built from: how many runs of each background job, by outcome, and how long
// they took. Every job (audit retention, log retention) reports through here next to its JOB_* log line.
import { metrics } from "../core/metrics";

const runs = metrics.counter("jobs_total", "Background job runs, by job and outcome (completed, failed, skipped).");
const durations = metrics.histogram("job_duration_ms", "Background job duration in milliseconds, by job.");

export type JobOutcome = "completed" | "failed" | "skipped";

export function recordJob(job: string, outcome: JobOutcome, durationMs?: number): void {
  try {
    runs.inc({ job, outcome });
    if (durationMs !== undefined && outcome !== "skipped") durations.observe(durationMs, { job });
  } catch {
    // a metric must never break the job it describes
  }
}
