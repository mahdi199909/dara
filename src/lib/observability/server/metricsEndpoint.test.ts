import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "../core/metrics";
import { MIN_METRICS_TOKEN_LENGTH, metricsAccess, renderMetrics } from "./metricsEndpoint";
import type { ServerLogSinks } from "./serverSinks";

const TOKEN = "s3cr3t-metrics-token-value-0123456789";

describe("metricsAccess", () => {
  it("does not exist without a token", () => {
    expect(metricsAccess({}, `Bearer ${TOKEN}`)).toBe("disabled");
    expect(metricsAccess({ METRICS_TOKEN: "   " }, `Bearer ${TOKEN}`)).toBe("disabled");
  });

  it("stays off for a token too short to be safe, whatever is presented", () => {
    expect(MIN_METRICS_TOKEN_LENGTH).toBe(16);
    expect(metricsAccess({ METRICS_TOKEN: "short" }, "Bearer short")).toBe("weak-token");
    expect(metricsAccess({ METRICS_TOKEN: "x".repeat(15) }, `Bearer ${"x".repeat(15)}`)).toBe("weak-token");
  });

  it("lets in exactly the bearer token", () => {
    const env = { METRICS_TOKEN: TOKEN };
    expect(metricsAccess(env, `Bearer ${TOKEN}`)).toBe("ok");
    expect(metricsAccess({ METRICS_TOKEN: ` ${TOKEN} ` }, `Bearer ${TOKEN}`)).toBe("ok");
  });

  it("refuses everything else: nothing, another scheme, a wrong or a truncated or an over-long token", () => {
    const env = { METRICS_TOKEN: TOKEN };
    for (const presented of [undefined, null, "", TOKEN, `Basic ${TOKEN}`, "Bearer ", "Bearer wrong", `Bearer ${TOKEN.slice(0, -1)}`, `Bearer ${TOKEN}x`, `bearer ${TOKEN}`]) {
      expect(metricsAccess(env, presented), String(presented)).toBe("unauthorized");
    }
  });
});

describe("renderMetrics", () => {
  const sinks = {
    stats: () => ({
      file: { directory: "/app/logs", retentionDays: 14, files: {}, queue: { queued: 3, written: 100, failures: 1, dropped: 0, droppedProtected: 0, circuit: "closed" } },
      remote: { host: "collector.example", minLevel: "WARN", queue: { queued: 40, written: 5, failures: 9, dropped: 2, droppedProtected: 0, circuit: "open" } },
    }),
  } as unknown as ServerLogSinks;

  it("prints the registry in the Prometheus format, followed by the process gauges", () => {
    const registry = new MetricsRegistry();
    registry.counter("http_requests_total", "HTTP requests handled.").inc({ method: "GET", route: "/api/tasks", status: "2xx" }, 3);
    registry.histogram("http_request_duration_ms", "Duration.").observe(8, { method: "GET", route: "/api/tasks" });
    const text = renderMetrics({ registry, sinks: undefined, env: { NEXT_PUBLIC_APP_VERSION: "1.1.0", GIT_COMMIT: "abc1234", APP_ENV: "production" } });
    expect(text).toContain('# TYPE http_requests_total counter\nhttp_requests_total{method="GET",route="/api/tasks",status="2xx"} 3');
    expect(text).toContain('http_request_duration_ms_bucket{method="GET",route="/api/tasks",le="10"} 1');
    expect(text).toMatch(/# TYPE process_uptime_seconds gauge\nprocess_uptime_seconds \d+/);
    expect(text).toMatch(/process_resident_memory_bytes \d+/);
    expect(text).toContain('parva_build_info{version="1.1.0",commit="abc1234",environment="production"} 1');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("adds the log pipeline's queues, circuits and failures per sink when there are sinks", () => {
    const text = renderMetrics({ registry: new MetricsRegistry(), sinks, env: {} });
    expect(text).toContain('parva_log_queue_size{sink="file"} 3');
    expect(text).toContain('parva_log_queue_size{sink="collector"} 40');
    expect(text).toContain('parva_log_circuit_open{sink="file"} 0');
    expect(text).toContain('parva_log_circuit_open{sink="collector"} 1');
    expect(text).toContain('parva_log_sink_failures{sink="collector"} 9');
    expect(text).toContain('parva_log_records_dropped{sink="collector"} 2');
  });

  it("leaves the log gauges out when nothing is configured, and reveals no path, host or token", () => {
    const bare = renderMetrics({ registry: new MetricsRegistry(), sinks: undefined, env: {} });
    expect(bare).not.toContain("parva_log_queue_size");
    const configured = renderMetrics({ registry: new MetricsRegistry(), sinks, env: { METRICS_TOKEN: TOKEN, LOG_REMOTE_TOKEN: "another-secret" } });
    for (const secret of ["/app/logs", "collector.example", TOKEN, "another-secret"]) expect(configured).not.toContain(secret);
  });
});
