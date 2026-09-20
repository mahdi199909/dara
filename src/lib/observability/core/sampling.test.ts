import { describe, expect, it } from "vitest";
import { MetricsRegistry, DURATION_BUCKETS_MS } from "./metrics";
import { DEFAULT_SAMPLING, hashToUnit, shouldKeep } from "./sampling";

describe("sampling", () => {
  const thin = { debug: 0, trace: 0, highVolumeInfo: 0 };

  it("keeps everything by default", () => {
    for (const level of ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"] as const) {
      expect(shouldKeep({ level, protected: false, highVolume: true }, DEFAULT_SAMPLING)).toBe(true);
    }
  });

  it("never drops WARN and above, or anything protected, however hard it is thinned", () => {
    for (const level of ["WARN", "ERROR", "CRITICAL"] as const) expect(shouldKeep({ level, protected: false, highVolume: true }, thin, () => 0.99)).toBe(true);
    for (const level of ["TRACE", "DEBUG", "INFO"] as const) expect(shouldKeep({ level, protected: true, highVolume: true }, thin, () => 0.99)).toBe(true);
  });

  it("thins only DEBUG, TRACE and high-volume INFO", () => {
    expect(shouldKeep({ level: "DEBUG", protected: false, highVolume: false }, thin)).toBe(false);
    expect(shouldKeep({ level: "TRACE", protected: false, highVolume: false }, thin)).toBe(false);
    expect(shouldKeep({ level: "INFO", protected: false, highVolume: true }, thin)).toBe(false);
    expect(shouldKeep({ level: "INFO", protected: false, highVolume: false }, thin)).toBe(true); // ordinary INFO is never sampled
  });

  it("decides per request, so one request's records are all kept or all dropped", () => {
    const config = { debug: 0.5, trace: 0.5, highVolumeInfo: 0.5 };
    for (let i = 0; i < 200; i++) {
      const key = `req_${i}`;
      const decisions = new Set([1, 2, 3].map(() => shouldKeep({ level: "DEBUG", protected: false, highVolume: false, correlationKey: key }, config, Math.random)));
      expect(decisions.size, key).toBe(1);
    }
  });

  it("keeps roughly the requested fraction across many requests", () => {
    const config = { debug: 0.25, trace: 1, highVolumeInfo: 1 };
    let kept = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (shouldKeep({ level: "DEBUG", protected: false, highVolume: false, correlationKey: `req_${i}` }, config)) kept++;
    expect(kept / n).toBeGreaterThan(0.22);
    expect(kept / n).toBeLessThan(0.28);
  });

  it("uses the random source when there is nothing to correlate on", () => {
    const config = { debug: 0.5, trace: 0.5, highVolumeInfo: 0.5 };
    expect(shouldKeep({ level: "DEBUG", protected: false, highVolume: false }, config, () => 0.1)).toBe(true);
    expect(shouldKeep({ level: "DEBUG", protected: false, highVolume: false }, config, () => 0.9)).toBe(false);
  });

  it("hashes to [0, 1) deterministically", () => {
    expect(hashToUnit("abc")).toBe(hashToUnit("abc"));
    expect(hashToUnit("abc")).not.toBe(hashToUnit("abd"));
    for (const key of ["", "a", "req_01J", "ü"]) {
      const h = hashToUnit(key);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("metrics", () => {
  it("counts with labels and reads the values back", () => {
    const registry = new MetricsRegistry();
    const requests = registry.counter("http_requests_total", "Requests.");
    requests.inc({ route: "/api/tasks", status: "200" });
    requests.inc({ route: "/api/tasks", status: "200" }, 2);
    requests.inc({ status: "500", route: "/api/tasks" }); // label order does not matter
    expect(requests.value({ route: "/api/tasks", status: "200" })).toBe(3);
    expect(requests.value({ route: "/api/tasks", status: "500" })).toBe(1);
    expect(requests.value({ route: "/x", status: "200" })).toBe(0);
    expect(registry.counter("http_requests_total")).toBe(requests); // same name, same counter
  });

  it("binds fixed labels for hot paths", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter("logs_total");
    const info = counter.bind({ level: "INFO" });
    info.inc();
    info.inc(4);
    expect(counter.value({ level: "INFO" })).toBe(5);
  });

  it("bounds label cardinality so a bad label can never grow memory without limit", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter("by_id");
    for (let i = 0; i < 5000; i++) counter.inc({ id: `entity_${i}` });
    expect(counter.entries().length).toBeLessThanOrEqual(201);
    expect(counter.entries().find((e) => e.labels.includes("__overflow__"))?.value).toBeGreaterThan(4000);
  });

  it("observes durations into cumulative buckets, with sum and count", () => {
    const registry = new MetricsRegistry();
    const h = registry.histogram("http_request_duration_ms");
    for (const v of [3, 7, 40, 40, 900, 100_000]) h.observe(v, { route: "/api/x" });
    h.observe(NaN);
    h.observe(Infinity);
    const [entry] = registry.snapshot().histograms.http_request_duration_ms;
    expect(entry.count).toBe(6);
    expect(entry.sum).toBe(3 + 7 + 40 + 40 + 900 + 100_000);
    expect(entry.buckets["5"]).toBe(1);
    expect(entry.buckets["10"]).toBe(1);
    expect(entry.buckets["50"]).toBe(2);
    expect(entry.buckets["1000"]).toBe(1);
    expect(DURATION_BUCKETS_MS).toContain(30000);
  });

  it("writes Prometheus text a scraper accepts", () => {
    const registry = new MetricsRegistry();
    registry.counter("logs_dropped_total", "Dropped logs.").inc({ reason: "overflow" }, 3);
    registry.histogram("sync_duration_ms", "Sync time.").observe(42, { outcome: "ok" });
    const text = registry.toPrometheus();
    expect(text).toContain("# HELP logs_dropped_total Dropped logs.");
    expect(text).toContain("# TYPE logs_dropped_total counter");
    expect(text).toContain('logs_dropped_total{reason="overflow"} 3');
    expect(text).toContain("# TYPE sync_duration_ms histogram");
    expect(text).toContain('sync_duration_ms_bucket{outcome="ok",le="50"} 1');
    expect(text).toContain('sync_duration_ms_bucket{outcome="ok",le="+Inf"} 1');
    expect(text).toContain('sync_duration_ms_sum{outcome="ok"} 42');
    expect(text).toContain('sync_duration_ms_count{outcome="ok"} 1');
    expect(text.endsWith("\n")).toBe(true);
  });

  it("escapes label values and resets", () => {
    const registry = new MetricsRegistry();
    const c = registry.counter("odd");
    c.inc({ v: 'a"b\\c\nd' });
    expect(registry.toPrometheus()).toContain('odd{v="a_b_c_d"} 1');
    registry.reset();
    expect(c.entries()).toEqual([]);
  });
});
