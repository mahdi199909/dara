// GET /api/metrics: the process's counters and timings in the Prometheus text format, for Grafana / Prometheus (or
// anything that reads it) — the "Observability Future" of the logging specification, without a dependency: the registry
// is the tiny in-process one in core/metrics.ts, and this only renders it.
//
// It is switched on by METRICS_TOKEN and answers only to `Authorization: Bearer <that token>`. With no token set the
// endpoint does not exist (404); a token shorter than 16 characters is treated the same, so a guessable one can never
// expose it. Everything it prints is a count, a duration or a name — never a person's data.
import { createHash, timingSafeEqual } from "node:crypto";
import { metrics, type MetricsRegistry } from "../core/metrics";
import { getServerLogSinks, type ServerLogSinks } from "./serverSinks";

export const MIN_METRICS_TOKEN_LENGTH = 16;

/** Read as a literal `process.env.NEXT_PUBLIC_…` on purpose: Next.js inlines it at build time, so the version is known here even though nothing sets it at run time. */
const BUILT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

export type MetricsAccess = "ok" | "disabled" | "unauthorized" | "weak-token";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Whether a request presenting `authorization` may read the metrics. The comparison takes the same time whatever is presented. */
export function metricsAccess(env: Record<string, string | undefined>, authorization: string | null | undefined): MetricsAccess {
  const token = env.METRICS_TOKEN?.trim();
  if (!token) return "disabled";
  if (token.length < MIN_METRICS_TOKEN_LENGTH) return "weak-token";
  const presented = authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
  return timingSafeEqual(digest(presented), digest(token)) ? "ok" : "unauthorized";
}

function gauge(name: string, help: string, samples: Array<{ labels?: Record<string, string>; value: number }>): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  for (const { labels, value } of samples) {
    const text = labels ? `{${Object.entries(labels).map(([key, val]) => `${key}="${val.replace(/["\\\n]/g, "_")}"`).join(",")}}` : "";
    lines.push(`${name}${text} ${value}`);
  }
  return lines;
}

/** The registry's text, plus the few numbers that are gauges rather than counters: uptime, memory, the log queues, the build. */
export function renderMetrics(options: { registry?: MetricsRegistry; sinks?: ServerLogSinks | undefined; env?: Record<string, string | undefined> } = {}): string {
  const registry = options.registry ?? metrics;
  const sinks = "sinks" in options ? options.sinks : getServerLogSinks();
  const env = options.env ?? process.env;
  const memory = process.memoryUsage();

  const lines: string[] = [
    ...gauge("process_uptime_seconds", "Seconds since the server process started.", [{ value: Math.round(process.uptime()) }]),
    ...gauge("process_resident_memory_bytes", "Resident memory of the server process.", [{ value: memory.rss }]),
    ...gauge("process_heap_used_bytes", "Heap in use by the server process.", [{ value: memory.heapUsed }]),
    ...gauge("parva_build_info", "The build that is running (1), labelled with what identifies it.", [{ labels: { version: env.NEXT_PUBLIC_APP_VERSION ?? BUILT_VERSION ?? "unknown", commit: env.GIT_COMMIT ?? "unknown", environment: env.APP_ENV ?? env.NODE_ENV ?? "unknown" }, value: 1 }]),
  ];

  const queues: Array<{ sink: string; stats: { queued: number; written: number; failures: number; dropped: number; circuit: string } }> = [];
  const stats = sinks?.stats();
  if (stats?.file) queues.push({ sink: "file", stats: stats.file.queue });
  if (stats?.remote) queues.push({ sink: "collector", stats: stats.remote.queue });
  if (queues.length > 0) {
    lines.push(
      ...gauge("parva_log_queue_size", "Log records waiting to be written, by sink.", queues.map((q) => ({ labels: { sink: q.sink }, value: q.stats.queued }))),
      ...gauge("parva_log_circuit_open", "1 while a log sink is paused after repeated failures.", queues.map((q) => ({ labels: { sink: q.sink }, value: q.stats.circuit === "closed" ? 0 : 1 }))),
      ...gauge("parva_log_sink_failures", "Failed writes to a log sink since the process started.", queues.map((q) => ({ labels: { sink: q.sink }, value: q.stats.failures }))),
      ...gauge("parva_log_records_dropped", "Log records dropped because a sink's queue was full, since the process started.", queues.map((q) => ({ labels: { sink: q.sink }, value: q.stats.dropped }))),
    );
  }
  return `${registry.toPrometheus()}${lines.join("\n")}\n`;
}
