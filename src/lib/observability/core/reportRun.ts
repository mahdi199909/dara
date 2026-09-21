// The life of one report, told to the log: started, completed (or failed), and slow when it took longer than the
// configured threshold. A report runs over a person's whole history, so what one needs to see is how long it took,
// over which period and over how many rows — and nothing about what the numbers were: the log never holds a
// balance, an amount or a title, only the shape of the work (see doc/logging/security.md).
//
//   const run = startReport(log, "time_and_money", { from, to }, { slowMs: 2000 });
//   try { const result = compute(); run.completed(result); return result; } catch (error) { run.failed(error); throw error; }
//
// Isomorphic: the server's report routes and the phone's on-device dispatcher use the same code, told a different
// threshold (SLOW_REPORT_THRESHOLD_MS on the server; a fixed one on the phone, which has no environment to read).
import { classifyError } from "./errorCodes";
import type { Logger } from "./logger";
import type { Layer } from "./schema";
import { metrics } from "./metrics";
import { markErrorReported } from "./reportedErrors";

const reportsTotal = metrics.counter("reports_total", "Reports generated, by report and outcome (completed, failed).");
const reportDuration = metrics.histogram("report_duration_ms", "Report generation time in milliseconds, by report.");

export interface ReportRange {
  from: Date | string | number;
  to: Date | string | number;
}

export interface ReportRun {
  /** Writes REPORT_GENERATION_COMPLETED — and REPORT_SLOW as well when it took too long. `result` is only counted, never logged. */
  completed(result?: unknown): void;
  /** Writes REPORT_GENERATION_FAILED with the error and marks it as reported, so the request handler does not write it again. */
  failed(error: unknown): void;
}

export interface ReportRunOptions {
  /** A report taking at least this long also writes REPORT_SLOW. */
  slowMs: number;
  layer?: Layer;
  /** Monotonic milliseconds (tests). Default: performance.now(). */
  clock?: () => number;
}

const MAX_DEPTH = 3;
const MAX_KEYS = 200;

/**
 * How many rows a report holds: the lengths of the lists in it, looked for a few levels down. Only this number ever
 * reaches the log — never a row, a name or an amount.
 */
export function countReportRows(result: unknown, depth = 0): number {
  if (Array.isArray(result)) return result.length;
  if (depth >= MAX_DEPTH || typeof result !== "object" || result === null || result instanceof Date) return 0;
  let total = 0;
  let seen = 0;
  for (const value of Object.values(result as Record<string, unknown>)) {
    if (++seen > MAX_KEYS) break;
    total += countReportRows(value, depth + 1);
  }
  return total;
}

function iso(value: Date | string | number): string {
  if (typeof value === "string") return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date.toISOString();
}

function defaultClock(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function startReport(log: Logger, report: string, range: ReportRange | null, options: ReportRunOptions): ReportRun {
  const clock = options.clock ?? defaultClock;
  const started = clock();
  const dateRange = range ? { from: iso(range.from), to: iso(range.to) } : undefined;
  const layer = options.layer;
  let finished = false;

  try {
    log.debug("REPORT_GENERATION_STARTED", { report, dateRange, layer });
  } catch {
    // a log line must never stop a report
  }

  const elapsed = () => Math.round((clock() - started) * 100) / 100;
  const once = (fn: () => void) => {
    if (finished) return;
    finished = true;
    try {
      fn();
    } catch {
      // ignore: the report itself has already succeeded or failed
    }
  };

  return {
    completed(result) {
      once(() => {
        const durationMs = elapsed();
        const recordCount = countReportRows(result);
        reportsTotal.inc({ report, outcome: "completed" });
        reportDuration.observe(durationMs, { report });
        log.info("REPORT_GENERATION_COMPLETED", { report, dateRange, recordCount, durationMs, layer });
        if (durationMs >= options.slowMs) log.warn("REPORT_SLOW", { report, dateRange, recordCount, durationMs, thresholdMs: options.slowMs, layer });
      });
    },
    failed(error) {
      once(() => {
        const durationMs = elapsed();
        reportsTotal.inc({ report, outcome: "failed" });
        reportDuration.observe(durationMs, { report });
        log.error("REPORT_GENERATION_FAILED", { report, dateRange, error, errorCode: classifyError(error) ?? "REPORT-001", durationMs, layer });
        markErrorReported(error);
      });
    },
  };
}
