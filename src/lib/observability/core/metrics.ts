// A deliberately tiny in-process metrics registry: counters and fixed-bucket histograms with labels,
// a JSON snapshot and Prometheus text output. No dependency, no background thread. It is what a
// dashboard (Grafana over the Prometheus text, or the admin page) reads: request counts, error
// rate, latency, sync duration, dropped logs. Label cardinality is bounded so a bad label (an id)
// can never grow memory without limit.
export type Labels = Readonly<Record<string, string>>;

const MAX_SERIES_PER_METRIC = 200;
const OVERFLOW_KEY = '__overflow__="true"';

function labelKey(labels: Labels | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels);
  if (keys.length === 0) return "";
  keys.sort();
  return keys.map((key) => `${key}="${String(labels[key]).replace(/["\\\n]/g, "_")}"`).join(",");
}

export class Counter {
  private readonly series = new Map<string, number>();

  constructor(readonly name: string, readonly help = "") {}

  inc(labels?: Labels, by = 1): void {
    this.incKey(labelKey(labels), by);
  }

  private incKey(key: string, by: number): void {
    if (!this.series.has(key) && this.series.size >= MAX_SERIES_PER_METRIC) key = OVERFLOW_KEY;
    this.series.set(key, (this.series.get(key) ?? 0) + by);
  }

  /** A view with fixed labels: the label key is built once, so a hot path (every log record) never rebuilds it. */
  bind(labels: Labels): { inc(by?: number): void } {
    const key = labelKey(labels);
    return { inc: (by = 1) => this.incKey(key, by) };
  }

  value(labels?: Labels): number {
    return this.series.get(labelKey(labels)) ?? 0;
  }

  entries(): Array<{ labels: string; value: number }> {
    return Array.from(this.series, ([labels, value]) => ({ labels, value }));
  }

  reset(): void {
    this.series.clear();
  }
}

export const DURATION_BUCKETS_MS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

interface HistogramSeries {
  buckets: number[];
  count: number;
  sum: number;
}

export class Histogram {
  private readonly series = new Map<string, HistogramSeries>();

  constructor(readonly name: string, readonly help = "", readonly buckets: readonly number[] = DURATION_BUCKETS_MS) {}

  observe(value: number, labels?: Labels): void {
    if (!Number.isFinite(value)) return;
    let key = labelKey(labels);
    if (!this.series.has(key) && this.series.size >= MAX_SERIES_PER_METRIC) key = OVERFLOW_KEY;
    let series = this.series.get(key);
    if (!series) {
      series = { buckets: new Array(this.buckets.length).fill(0), count: 0, sum: 0 };
      this.series.set(key, series);
    }
    series.count++;
    series.sum += value;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        series.buckets[i]++;
        break;
      }
    }
  }

  entries(): Array<{ labels: string; count: number; sum: number; buckets: number[] }> {
    return Array.from(this.series, ([labels, s]) => ({ labels, count: s.count, sum: s.sum, buckets: [...s.buckets] }));
  }

  reset(): void {
    this.series.clear();
  }
}

export interface MetricsSnapshot {
  counters: Record<string, Array<{ labels: string; value: number }>>;
  histograms: Record<string, Array<{ labels: string; count: number; sum: number; buckets: Record<string, number> }>>;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string, help = ""): Counter {
    let metric = this.counters.get(name);
    if (!metric) {
      metric = new Counter(name, help);
      this.counters.set(name, metric);
    }
    return metric;
  }

  histogram(name: string, help = "", buckets: readonly number[] = DURATION_BUCKETS_MS): Histogram {
    let metric = this.histograms.get(name);
    if (!metric) {
      metric = new Histogram(name, help, buckets);
      this.histograms.set(name, metric);
    }
    return metric;
  }

  snapshot(): MetricsSnapshot {
    const snapshot: MetricsSnapshot = { counters: {}, histograms: {} };
    for (const [name, counter] of this.counters) snapshot.counters[name] = counter.entries();
    for (const [name, histogram] of this.histograms) {
      snapshot.histograms[name] = histogram.entries().map((entry) => ({
        labels: entry.labels,
        count: entry.count,
        sum: entry.sum,
        buckets: Object.fromEntries(histogram.buckets.map((bound, i) => [String(bound), entry.buckets[i]])),
      }));
    }
    return snapshot;
  }

  /** Prometheus exposition format (text/plain; version=0.0.4). */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [name, counter] of this.counters) {
      if (counter.help) lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const { labels, value } of counter.entries()) lines.push(`${name}${labels ? `{${labels}}` : ""} ${value}`);
    }
    for (const [name, histogram] of this.histograms) {
      if (histogram.help) lines.push(`# HELP ${name} ${histogram.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of histogram.entries()) {
        const prefix = entry.labels ? `${entry.labels},` : "";
        let cumulative = 0;
        histogram.buckets.forEach((bound, i) => {
          cumulative += entry.buckets[i];
          lines.push(`${name}_bucket{${prefix}le="${bound}"} ${cumulative}`);
        });
        lines.push(`${name}_bucket{${prefix}le="+Inf"} ${entry.count}`);
        lines.push(`${name}_sum${entry.labels ? `{${entry.labels}}` : ""} ${entry.sum}`);
        lines.push(`${name}_count${entry.labels ? `{${entry.labels}}` : ""} ${entry.count}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  reset(): void {
    for (const counter of this.counters.values()) counter.reset();
    for (const histogram of this.histograms.values()) histogram.reset();
  }
}

/** The process-wide registry. Tests that need isolation create their own MetricsRegistry. */
export const metrics = new MetricsRegistry();
