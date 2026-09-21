import { describe, expect, it, vi } from "vitest";
import { DURATION_BUCKETS_MS, MetricsRegistry, metrics, quantileOf } from "./metrics";

describe("the process-wide registry", () => {
  it("is one registry per process even when the module is loaded twice, as a Next.js server build does", async () => {
    const counter = metrics.counter("copy_test_total");
    counter.inc();
    // A second copy of the module (a fresh evaluation, as another bundle's would be) must find the same registry.
    vi.resetModules();
    const another = await import("./metrics");
    expect(another.metrics).toBe(metrics);
    expect(another.metrics.counter("copy_test_total").value()).toBe(1);
    expect(another.MetricsRegistry).not.toBe(MetricsRegistry); // really a second evaluation of the module
  });
});

describe("Histogram.quantile", () => {
  it("is null for a series nobody has observed", () => {
    const histogram = new MetricsRegistry().histogram("d");
    expect(histogram.quantile(0.95)).toBeNull();
    histogram.observe(10, { route: "/a" });
    expect(histogram.quantile(0.95, { route: "/b" })).toBeNull();
  });

  it("places the median and the 95th percentile inside the buckets that hold them", () => {
    const histogram = new MetricsRegistry().histogram("d");
    for (let i = 0; i < 90; i++) histogram.observe(8); // the 5–10 bucket
    for (let i = 0; i < 10; i++) histogram.observe(400); // the 250–500 bucket
    const median = histogram.quantile(0.5)!;
    expect(median).toBeGreaterThan(5);
    expect(median).toBeLessThanOrEqual(10);
    const p95 = histogram.quantile(0.95)!;
    expect(p95).toBeGreaterThan(250);
    expect(p95).toBeLessThanOrEqual(500);
  });

  it("interpolates inside a bucket the way histogram_quantile does", () => {
    const histogram = new MetricsRegistry().histogram("d");
    for (let i = 0; i < 100; i++) histogram.observe(60); // all in the 50–100 bucket
    expect(histogram.quantile(0.5)).toBe(75);
    expect(histogram.quantile(1)).toBe(100);
    expect(histogram.quantile(0)).toBe(50);
  });

  it("reports the largest bound for observations beyond it, and copes with a q outside 0–1", () => {
    const histogram = new MetricsRegistry().histogram("d");
    for (let i = 0; i < 10; i++) histogram.observe(120_000);
    expect(histogram.quantile(0.5)).toBe(DURATION_BUCKETS_MS[DURATION_BUCKETS_MS.length - 1]);
    const other = new MetricsRegistry().histogram("d2");
    other.observe(60);
    expect(other.quantile(5)).toBe(100);
    expect(other.quantile(-1)).toBe(50);
  });

  it("keeps series apart by their labels", () => {
    const histogram = new MetricsRegistry().histogram("d");
    for (let i = 0; i < 10; i++) histogram.observe(3, { route: "/fast" });
    for (let i = 0; i < 10; i++) histogram.observe(2000, { route: "/slow" });
    expect(histogram.quantile(0.5, { route: "/fast" })!).toBeLessThanOrEqual(5);
    expect(histogram.quantile(0.5, { route: "/slow" })!).toBeGreaterThan(1000);
  });
});

describe("quantileOf", () => {
  it("works on bucket counts that were merged from several series", () => {
    const merged = new Array(DURATION_BUCKETS_MS.length).fill(0);
    merged[0] = 50; // ≤ 5 ms
    merged[3] = 50; // 25–50 ms
    expect(quantileOf(merged, 100, 0.25)).toBeLessThanOrEqual(5);
    expect(quantileOf(merged, 100, 0.75)).toBeGreaterThan(25);
    expect(quantileOf(merged, 0, 0.5)).toBeNull();
  });
});
