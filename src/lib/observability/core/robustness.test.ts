// Logging must never become an application problem: whatever is thrown at it — hostile values,
// gigantic exceptions, broken or missing sinks, an avalanche of records — the caller is unaffected,
// memory stays bounded and the records that matter survive.
import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../testing";
import { BatchingSink, MemorySink, NullSink, type BatchingEvent, type LogSink } from "./sink";
import type { LogRecord } from "./schema";

function json(record: LogRecord | undefined): string {
  return JSON.stringify(record);
}

describe("hostile and oversized input", () => {
  it("writes a small record for a gigantic exception", () => {
    const { logger, sink } = createTestLogger();
    let error: Error = new Error("m".repeat(5_000_000));
    error.stack = `Error: boom\n${Array.from({ length: 200_000 }, (_, i) => `    at frame${i} (file.ts:${i}:1)`).join("\n")}`;
    for (let i = 0; i < 1000; i++) error = new Error(`cause ${i}`, { cause: error });
    const started = performance.now();
    logger.error("API_UNHANDLED_ERROR", { error });
    expect(performance.now() - started).toBeLessThan(500);
    expect(json(sink.last()).length).toBeLessThan(12_000);
    expect(sink.last()?.error?.cause?.cause?.cause?.cause).toBeUndefined(); // cause chain capped
  });

  it("handles an AggregateError with thousands of members", () => {
    const { logger, sink } = createTestLogger();
    logger.error("API_UNHANDLED_ERROR", { error: new AggregateError(Array.from({ length: 10_000 }, (_, i) => new Error(`e${i}`)), "many") });
    expect(sink.last()?.error?.errors).toHaveLength(5);
  });

  it("survives every malformed value a caller might pass", () => {
    const { logger, sink } = createTestLogger();
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.me = cyclic;
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20_000; i++) {
      deep.next = {};
      deep = deep.next as Record<string, unknown>;
    }
    const bare = Object.create(null);
    bare.x = 1;
    class WithPrivates {
      #secret = "s";
      visible = 1;
      reveal() {
        return this.#secret;
      }
    }
    const input = {
      cyclic,
      deep: root,
      big: 123n,
      sym: Symbol("s"),
      [Symbol("hidden")]: "ignored",
      fn: () => 1,
      date: new Date(NaN),
      buffer: Buffer.from("secret bytes"),
      proxy: new Proxy({}, { ownKeys: () => { throw new Error("nope"); } }),
      getter: { get boom(): string { throw new Error("nope"); } },
      toJSON: () => { throw new Error("toJSON must not be called"); },
      bare,
      instance: new WithPrivates(),
      hugeString: "x".repeat(10_000_000),
      hugeArray: new Array(1_000_000).fill(1),
      nan: NaN,
    };
    expect(() => logger.info("SYNC_COMPLETED", input)).not.toThrow();
    const record = sink.last()!;
    expect(record.event).toBe("SYNC_COMPLETED");
    expect(() => JSON.stringify(record)).not.toThrow();
    expect(json(record).length).toBeLessThan(20_000);
  });

  it("never lets a secret through, whatever shape it arrives in", () => {
    const { logger, sink } = createTestLogger();
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c3JfMSJ9.abcDEF123_-xyz";
    logger.error("SYNC_FAILED", {
      headers: { Authorization: `Bearer ${jwt}`, Cookie: "hesabkon_session=abc" },
      error: new Error(`fetch failed: ${jwt} password=hunter2 postgresql://u:pw@h/db`),
      nested: [{ items: [{ apiKey: "AKIA" }] }],
      text: `token ${jwt}`,
    });
    const serialized = json(sink.last());
    for (const leaked of [jwt, "hunter2", "pw@h", "AKIA", "hesabkon_session=abc"]) expect(serialized, leaked).not.toContain(leaked);
  });
});

describe("sink outages", () => {
  it("keeps the application running with a sink that always fails, and bounds memory", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const inner: LogSink = { name: "disk-full", write: async () => { throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }); } };
      const events: BatchingEvent[] = [];
      const sink = new BatchingSink(inner, { capacity: 1000, flushIntervalMs: 10, failureThreshold: 3, baseBackoffMs: 100, now: () => now, onEvent: (e) => events.push(e) });
      const { logger } = createTestLogger({ sinks: [sink] });

      for (let i = 0; i < 100_000; i++) logger.info("TASK_CREATE_SUCCESS", { i });
      for (let round = 0; round < 20; round++) {
        await vi.advanceTimersByTimeAsync(200);
        now += 200;
      }
      expect(sink.stats().queued).toBeLessThanOrEqual(1000); // memory stays bounded
      expect(sink.stats().dropped).toBeGreaterThan(90_000);
      expect(events.some((e) => e.type === "circuit_open")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows errors on the fallback while the remote sink is unreachable, then delivers when it returns", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      let online = false;
      const delivered: string[] = [];
      const remote: LogSink = {
        name: "remote",
        write: async (r) => {
          if (!online) throw new Error("network unavailable");
          delivered.push(r.message);
        },
      };
      const fallback = new MemorySink();
      const sink = new BatchingSink(remote, { flushIntervalMs: 10, failureThreshold: 1, baseBackoffMs: 500, fallback, now: () => now });
      const { logger } = createTestLogger({ sinks: [sink] });

      logger.info("TASK_CREATE_SUCCESS", { message: "before outage" });
      await vi.advanceTimersByTimeAsync(20); // first flush fails → circuit opens
      logger.error("SYNC_FAILED", { message: "critical during outage" });
      logger.info("TASK_CREATE_SUCCESS", { message: "routine during outage" });
      expect(fallback.records.map((r) => r.message)).toEqual(["critical during outage"]);

      online = true;
      now += 1000;
      await vi.advanceTimersByTimeAsync(1000);
      await sink.flush();
      expect(delivered).toEqual(["before outage", "critical during outage", "routine during outage"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not block the caller on a slow sink", async () => {
    let released = false;
    // A real remote sink ships a whole batch per request, which is what writeBatch is for.
    const slow: LogSink = {
      name: "slow",
      write: () => {},
      writeBatch: () => new Promise<void>((resolve) => setTimeout(() => { released = true; resolve(); }, 200)),
    };
    const sink = new BatchingSink(slow, { flushIntervalMs: 5, maxBatch: 1000 });
    const { logger } = createTestLogger({ sinks: [sink] });
    const started = performance.now();
    for (let i = 0; i < 1000; i++) logger.info("TASK_CREATE_SUCCESS");
    expect(performance.now() - started).toBeLessThan(200);
    expect(released).toBe(false);
    await sink.close();
  });
});

describe("volume and speed", () => {
  it("handles a burst of 100 000 records and reports exactly what a bounded queue had to drop", async () => {
    const inner = new MemorySink(200_000);
    const sink = new BatchingSink(inner, { capacity: 20_000, maxBatch: 500, flushIntervalMs: 5 });
    const { logger } = createTestLogger({ sinks: [sink] });
    for (let i = 0; i < 100_000; i++) logger.info("HTTP_REQUEST_COMPLETED", { i });
    await sink.flush();
    const stats = sink.stats();
    expect(stats.written + stats.dropped).toBe(100_000);
    expect(stats.queued).toBe(0);
    expect(inner.records.length).toBe(stats.written);
    expect(stats.written).toBeGreaterThanOrEqual(20_000);
  });

  it("keeps ERROR records when a flood of routine ones overflows the queue", async () => {
    const inner = new MemorySink(200_000);
    const sink = new BatchingSink(inner, { capacity: 1000, maxBatch: 100, flushIntervalMs: 5 });
    const { logger } = createTestLogger({ sinks: [sink] });
    for (let i = 0; i < 50_000; i++) {
      logger.info("HTTP_REQUEST_COMPLETED", { i });
      if (i % 5000 === 0) logger.error("SYNC_FAILED", { i });
    }
    await sink.flush();
    expect(inner.find("SYNC_FAILED")).toHaveLength(10);
    expect(sink.stats().droppedProtected).toBe(0);
  });

  it("stays fast enough not to matter: 50 000 enabled records and a million disabled ones", () => {
    const { logger } = createTestLogger({ sinks: [new NullSink()], level: "INFO" });
    const t1 = performance.now();
    for (let i = 0; i < 50_000; i++) logger.info("EXPENSE_CREATE_SUCCESS", { expenseId: `exp_${i}`, count: i });
    const enabledMs = performance.now() - t1;

    const t2 = performance.now();
    for (let i = 0; i < 1_000_000; i++) logger.debug("SYNC_PULL_STARTED", { i });
    const disabledMs = performance.now() - t2;

    // Very generous bounds: they exist to catch an accidental O(n²) or a per-call allocation storm,
    // not to benchmark (scripts/logs/bench.ts does that).
    expect(enabledMs).toBeLessThan(5000);
    expect(disabledMs).toBeLessThan(2000);
  });
});
