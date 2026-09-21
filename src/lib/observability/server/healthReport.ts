// What the admin health view shows, and what the Prometheus endpoint's dashboards are built from: the process's own
// counters and timings (requests, errors, slow requests, database, sync, sign-in failures, jobs, reports, the log
// pipeline) read from the metrics registry, plus the last few problems. Everything is since the process started —
// a restart resets it, which is why `uptimeSeconds` is the first thing in it.
//
// It only reads. No figure here is a person's data: counts, durations and event names.
import { DURATION_BUCKETS_MS, metrics, quantileOf, type MetricsRegistry } from "../core/metrics";
import type { LoggerCore } from "../core/logger";
import { getRootCore } from "../root";
import { describeLogging, type LoggingState } from "./adminLogging";
import { recentProblems, type RecentProblem } from "./recentProblems";
import { getServerLogSinks, type ServerLogSinks } from "./serverSinks";

type Labels = Record<string, string>;

/** `method="GET",route="/api/x"` → { method: "GET", route: "/api/x" } (label values never contain a quote: the registry replaces it). */
export function parseLabels(text: string): Labels {
  const out: Labels = {};
  for (const match of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"/g)) out[match[1]] = match[2];
  return out;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface RouteHealth {
  route: string;
  method: string;
  requests: number;
  serverErrors: number;
  p95Ms: number | null;
}

export interface HealthReport {
  generatedAt: string;
  uptimeSeconds: number;
  process: { node: string; rssMb: number; heapUsedMb: number };
  requests: {
    total: number;
    clientErrors: number;
    serverErrors: number;
    /** Server errors as a share of all requests (0–1). */
    errorRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    slow: number;
    /** The five with the highest 95th percentile (at least five requests each), and the five with the most requests. */
    slowestRoutes: RouteHealth[];
    busiestRoutes: RouteHealth[];
  };
  database: { queries: number; failed: number; slow: number; p95Ms: number | null; transactions: Record<string, number> };
  sync: { push: Record<string, number>; pull: Record<string, number>; serverErrors: number; slow: number };
  auth: Record<string, number>;
  jobs: Array<{ job: string; completed: number; failed: number; skipped: number }>;
  reports: Array<{ report: string; completed: number; failed: number; p95Ms: number | null }>;
  logging: {
    emitted: Record<string, number>;
    sampledOut: number;
    sinkErrors: number;
    /** The events at WARN or above that occurred most often, with their counts. */
    notable: Array<{ event: string; level: string; count: number }>;
    levels: LoggingState;
    sinks: ReturnType<ServerLogSinks["stats"]> | null;
    recentProblems: RecentProblem[];
  };
}

export interface HealthOptions {
  registry?: MetricsRegistry;
  core?: LoggerCore;
  sinks?: ServerLogSinks | undefined;
  /** How many recent problems to list (default 20). */
  recent?: number;
}

function sumCounter(snapshot: ReturnType<MetricsRegistry["snapshot"]>, name: string, where: (labels: Labels) => boolean = () => true): number {
  let total = 0;
  for (const entry of snapshot.counters[name] ?? []) if (where(parseLabels(entry.labels))) total += entry.value;
  return total;
}

function groupCounter(snapshot: ReturnType<MetricsRegistry["snapshot"]>, name: string, by: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of snapshot.counters[name] ?? []) {
    const key = parseLabels(entry.labels)[by] ?? "(none)";
    out[key] = (out[key] ?? 0) + entry.value;
  }
  return out;
}

type HistogramEntries = ReturnType<MetricsRegistry["snapshot"]>["histograms"][string];

/** The quantile over every series of a histogram that passes `where`, their buckets added together. */
function mergedQuantile(entries: HistogramEntries | undefined, q: number, where: (labels: Labels) => boolean = () => true): number | null {
  const buckets = new Array<number>(DURATION_BUCKETS_MS.length).fill(0);
  let count = 0;
  for (const entry of entries ?? []) {
    if (!where(parseLabels(entry.labels))) continue;
    count += entry.count;
    DURATION_BUCKETS_MS.forEach((bound, i) => {
      buckets[i] += entry.buckets[String(bound)] ?? 0;
    });
  }
  return quantileOf(buckets, count, q);
}

export function buildHealthReport(options: HealthOptions = {}): HealthReport {
  const registry = options.registry ?? metrics;
  const core = options.core ?? getRootCore();
  const snapshot = registry.snapshot();
  const sinks = "sinks" in options ? options.sinks : getServerLogSinks();

  // requests
  const requestSeries = snapshot.counters.http_requests_total ?? [];
  const byRoute = new Map<string, { method: string; route: string; requests: number; serverErrors: number }>();
  let total = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let syncServerErrors = 0;
  for (const { labels, value } of requestSeries) {
    const parsed = parseLabels(labels);
    total += value;
    if (parsed.status === "4xx") clientErrors += value;
    if (parsed.status === "5xx") {
      serverErrors += value;
      if (parsed.route?.startsWith("/api/sync/")) syncServerErrors += value;
    }
    const key = `${parsed.method} ${parsed.route}`;
    const row = byRoute.get(key) ?? { method: parsed.method ?? "", route: parsed.route ?? "", requests: 0, serverErrors: 0 };
    row.requests += value;
    if (parsed.status === "5xx") row.serverErrors += value;
    byRoute.set(key, row);
  }
  const durations = snapshot.histograms.http_request_duration_ms;
  const routes: RouteHealth[] = [...byRoute.values()].map((row) => {
    const entry = durations?.find((candidate) => {
      const labels = parseLabels(candidate.labels);
      return labels.method === row.method && labels.route === row.route;
    });
    return { ...row, p95Ms: entry ? quantileOf(DURATION_BUCKETS_MS.map((bound) => entry.buckets[String(bound)] ?? 0), entry.count, 0.95) : null };
  });

  // reports
  const reportGroups = new Map<string, { completed: number; failed: number }>();
  for (const entry of snapshot.counters.reports_total ?? []) {
    const labels = parseLabels(entry.labels);
    const row = reportGroups.get(labels.report) ?? { completed: 0, failed: 0 };
    if (labels.outcome === "failed") row.failed += entry.value;
    else row.completed += entry.value;
    reportGroups.set(labels.report, row);
  }

  // jobs
  const jobGroups = new Map<string, { completed: number; failed: number; skipped: number }>();
  for (const entry of snapshot.counters.jobs_total ?? []) {
    const labels = parseLabels(entry.labels);
    const row = jobGroups.get(labels.job) ?? { completed: 0, failed: 0, skipped: 0 };
    if (labels.outcome === "failed") row.failed += entry.value;
    else if (labels.outcome === "skipped") row.skipped += entry.value;
    else row.completed += entry.value;
    jobGroups.set(labels.job, row);
  }

  const syncRequests = snapshot.counters.sync_requests_total ?? [];
  const syncOutcomes = (direction: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const entry of syncRequests) {
      const labels = parseLabels(entry.labels);
      if (labels.direction === direction) out[labels.outcome] = (out[labels.outcome] ?? 0) + entry.value;
    }
    return out;
  };

  const notable = (snapshot.counters.log_events_total ?? [])
    .map((entry) => {
      const labels = parseLabels(entry.labels);
      return { event: labels.event ?? "", level: labels.level ?? "", count: entry.value };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const memory = typeof process !== "undefined" && typeof process.memoryUsage === "function" ? process.memoryUsage() : { rss: 0, heapUsed: 0 };

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    process: { node: process.version, rssMb: round2(memory.rss / 1048576), heapUsedMb: round2(memory.heapUsed / 1048576) },
    requests: {
      total,
      clientErrors,
      serverErrors,
      errorRate: total > 0 ? Math.round((serverErrors / total) * 10_000) / 10_000 : 0,
      p50Ms: mergedQuantile(durations, 0.5),
      p95Ms: mergedQuantile(durations, 0.95),
      slow: sumCounter(snapshot, "http_slow_requests_total"),
      slowestRoutes: routes
        .filter((row) => row.requests >= 5 && row.p95Ms !== null)
        .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
        .slice(0, 5),
      busiestRoutes: [...routes].sort((a, b) => b.requests - a.requests).slice(0, 5),
    },
    database: {
      queries: sumCounter(snapshot, "db_queries_total"),
      failed: sumCounter(snapshot, "db_queries_total", (labels) => labels.outcome !== undefined && labels.outcome !== "ok"),
      slow: sumCounter(snapshot, "db_slow_queries_total"),
      p95Ms: mergedQuantile(snapshot.histograms.db_query_duration_ms, 0.95),
      transactions: groupCounter(snapshot, "db_transactions_total", "outcome"),
    },
    sync: {
      push: syncOutcomes("push"),
      pull: syncOutcomes("pull"),
      serverErrors: syncServerErrors,
      slow: sumCounter(snapshot, "http_slow_requests_total", (labels) => labels.route?.startsWith("/api/sync/") === true),
    },
    auth: groupCounter(snapshot, "auth_events_total", "event"),
    jobs: [...jobGroups].map(([job, row]) => ({ job, ...row })).sort((a, b) => a.job.localeCompare(b.job)),
    reports: [...reportGroups]
      .map(([report, row]) => ({ report, ...row, p95Ms: mergedQuantile(snapshot.histograms.report_duration_ms, 0.95, (labels) => labels.report === report) }))
      .sort((a, b) => a.report.localeCompare(b.report)),
    logging: {
      emitted: groupCounter(snapshot, "logs_emitted_total", "level"),
      sampledOut: sumCounter(snapshot, "logs_sampled_out_total"),
      sinkErrors: sumCounter(snapshot, "log_sink_errors_total"),
      notable,
      levels: describeLogging(core),
      sinks: sinks ? sinks.stats() : null,
      recentProblems: recentProblems(options.recent ?? 20),
    },
  };
}
