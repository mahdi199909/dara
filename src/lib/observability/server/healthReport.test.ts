import { afterEach, describe, expect, it } from "vitest";
import { MetricsRegistry } from "../core/metrics";
import { createTestLogger } from "../testing";
import { resetAdminLogging } from "./adminLogging";
import { buildHealthReport, parseLabels } from "./healthReport";
import { installRecentProblems, resetRecentProblems } from "./recentProblems";

afterEach(() => {
  resetAdminLogging();
  resetRecentProblems();
});

/** A registry holding what a server that had been busy for a while would hold. */
function busyServer() {
  const registry = new MetricsRegistry();
  const requests = registry.counter("http_requests_total");
  requests.inc({ method: "GET", route: "/api/tasks", status: "2xx" }, 70);
  requests.inc({ method: "POST", route: "/api/tasks", status: "2xx" }, 15);
  requests.inc({ method: "POST", route: "/api/tasks", status: "4xx" }, 5);
  requests.inc({ method: "POST", route: "/api/sync/push", status: "2xx" }, 6);
  requests.inc({ method: "POST", route: "/api/sync/push", status: "5xx" }, 2);
  requests.inc({ method: "GET", route: "/api/reports", status: "5xx" }, 2);

  const duration = registry.histogram("http_request_duration_ms");
  for (let i = 0; i < 70; i++) duration.observe(8, { method: "GET", route: "/api/tasks" });
  for (let i = 0; i < 20; i++) duration.observe(40, { method: "POST", route: "/api/tasks" });
  for (let i = 0; i < 8; i++) duration.observe(1800, { method: "POST", route: "/api/sync/push" });
  for (let i = 0; i < 2; i++) duration.observe(900, { method: "GET", route: "/api/reports" });

  registry.counter("http_slow_requests_total").inc({ route: "/api/sync/push" }, 3);
  registry.counter("http_slow_requests_total").inc({ route: "/api/reports" }, 1);

  const queries = registry.counter("db_queries_total");
  queries.inc({ outcome: "ok" }, 400);
  queries.inc({ outcome: "error" }, 4);
  registry.counter("db_slow_queries_total").inc({}, 7);
  registry.histogram("db_query_duration_ms").observe(4);
  const transactions = registry.counter("db_transactions_total");
  transactions.inc({ outcome: "commit" }, 30);
  transactions.inc({ outcome: "rollback" }, 2);

  const sync = registry.counter("sync_requests_total");
  sync.inc({ direction: "push", outcome: "success" }, 5);
  sync.inc({ direction: "push", outcome: "partial" }, 1);
  sync.inc({ direction: "pull", outcome: "success" }, 9);

  const auth = registry.counter("auth_events_total");
  auth.inc({ event: "login_success" }, 12);
  auth.inc({ event: "login_failed" }, 3);
  auth.inc({ event: "rate_limited" }, 1);

  const jobs = registry.counter("jobs_total");
  jobs.inc({ job: "audit-retention", outcome: "completed" }, 2);
  jobs.inc({ job: "log-retention", outcome: "failed" }, 1);
  jobs.inc({ job: "log-retention", outcome: "skipped" }, 4);

  const reports = registry.counter("reports_total");
  reports.inc({ report: "time_and_money", outcome: "completed" }, 8);
  reports.inc({ report: "time_and_money", outcome: "failed" }, 1);
  const reportDuration = registry.histogram("report_duration_ms");
  for (let i = 0; i < 9; i++) reportDuration.observe(120, { report: "time_and_money" });

  registry.counter("log_events_total").inc({ event: "AUTH_LOGIN_FAILED", level: "WARN" }, 3);
  registry.counter("log_events_total").inc({ event: "SYNC_FAILED", level: "ERROR" }, 6);
  registry.counter("logs_emitted_total").inc({ level: "INFO" }, 500);
  registry.counter("logs_emitted_total").inc({ level: "ERROR" }, 6);
  registry.counter("logs_sampled_out_total").inc({}, 11);
  registry.counter("log_sink_errors_total").inc({ sink: "http" }, 2);
  return registry;
}

const report = () => {
  const { core, logger } = createTestLogger({ level: "INFO" });
  installRecentProblems(core);
  logger.warn("AUTH_LOGIN_FAILED", { errorCode: "AUTH-001" });
  logger.error("SYNC_FAILED", { errorCode: "SYNC-002" });
  return buildHealthReport({ registry: busyServer(), core, sinks: undefined });
};

describe("parseLabels", () => {
  it("reads the label text the registry writes", () => {
    expect(parseLabels('method="GET",route="/api/tasks",status="2xx"')).toEqual({ method: "GET", route: "/api/tasks", status: "2xx" });
    expect(parseLabels("")).toEqual({});
  });
});

describe("buildHealthReport", () => {
  it("counts requests, errors and the error rate", () => {
    const { requests } = report();
    expect(requests).toMatchObject({ total: 100, clientErrors: 5, serverErrors: 4, errorRate: 0.04, slow: 4 });
  });

  it("estimates latency percentiles from the histogram", () => {
    const { requests } = report();
    expect(requests.p50Ms).toBeLessThanOrEqual(10);
    expect(requests.p95Ms!).toBeGreaterThan(500);
  });

  it("names the slowest routes (with enough requests to mean something) and the busiest", () => {
    const { requests } = report();
    expect(requests.busiestRoutes[0]).toMatchObject({ method: "GET", route: "/api/tasks", requests: 70 });
    // a method and a route are one row; /api/reports has only two requests, too few for its percentile to mean anything
    expect(requests.slowestRoutes.map((row) => `${row.method} ${row.route}`)).toEqual(["POST /api/sync/push", "POST /api/tasks", "GET /api/tasks"]);
    expect(requests.slowestRoutes[0]).toMatchObject({ method: "POST", requests: 8, serverErrors: 2 });
    expect(requests.slowestRoutes[0].p95Ms!).toBeGreaterThan(1000);
  });

  it("reports the database: failures, slow queries and transactions by outcome", () => {
    expect(report().database).toMatchObject({ queries: 404, failed: 4, slow: 7, transactions: { commit: 30, rollback: 2 } });
  });

  it("reports sync by direction and outcome, with the server errors and slow requests on the sync routes", () => {
    expect(report().sync).toEqual({ push: { success: 5, partial: 1 }, pull: { success: 9 }, serverErrors: 2, slow: 3 });
  });

  it("reports authentication events by name", () => {
    expect(report().auth).toEqual({ login_success: 12, login_failed: 3, rate_limited: 1 });
  });

  it("reports each job and each report with its outcomes", () => {
    const health = report();
    expect(health.jobs).toEqual([
      { job: "audit-retention", completed: 2, failed: 0, skipped: 0 },
      { job: "log-retention", completed: 0, failed: 1, skipped: 4 },
    ]);
    expect(health.reports).toHaveLength(1);
    expect(health.reports[0]).toMatchObject({ report: "time_and_money", completed: 8, failed: 1 });
    expect(health.reports[0].p95Ms!).toBeGreaterThan(100);
    expect(health.reports[0].p95Ms!).toBeLessThanOrEqual(250);
  });

  it("reports the log pipeline: what was written, what the most frequent problems were, and what went wrong just now", () => {
    const { logging } = report();
    expect(logging).toMatchObject({ emitted: { INFO: 500, ERROR: 6 }, sampledOut: 11, sinkErrors: 2, sinks: null });
    expect(logging.notable).toEqual([
      { event: "SYNC_FAILED", level: "ERROR", count: 6 },
      { event: "AUTH_LOGIN_FAILED", level: "WARN", count: 3 },
    ]);
    expect(logging.recentProblems.map((p) => p.event)).toEqual(["SYNC_FAILED", "AUTH_LOGIN_FAILED"]);
    expect(logging.levels).toMatchObject({ base: "INFO", configuredBase: "INFO" });
  });

  it("describes a server that has just started without dividing by zero", () => {
    const { core } = createTestLogger();
    const health = buildHealthReport({ registry: new MetricsRegistry(), core, sinks: undefined });
    expect(health.requests).toMatchObject({ total: 0, errorRate: 0, p50Ms: null, p95Ms: null, slow: 0, slowestRoutes: [], busiestRoutes: [] });
    expect(health.jobs).toEqual([]);
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(health.process.node).toMatch(/^v\d+/);
  });

  it("holds counts, durations and event names only — nothing that could be a person's", () => {
    const text = JSON.stringify(report());
    expect(text).not.toMatch(/@|password|token/i);
  });
});
