import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogRecord } from "./schema";
import { BatchingSink, ConsoleSink, FilteredSink, MemorySink, NullSink, type BatchingEvent, type ConsoleLike, type LogSink } from "./sink";

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    timestamp: "2026-09-20T12:44:23.000Z",
    level: "INFO",
    event: "TASK_CREATE_SUCCESS",
    message: "Task created.",
    service: "parva-test",
    environment: "development",
    platform: "server",
    metadata: {},
    ...overrides,
  };
}

function fakeConsole() {
  const calls: Array<{ method: keyof ConsoleLike; args: unknown[] }> = [];
  const make = (method: keyof ConsoleLike) => (...args: unknown[]) => void calls.push({ method, args });
  const target: ConsoleLike = { debug: make("debug"), info: make("info"), log: make("log"), warn: make("warn"), error: make("error") };
  return { calls, target };
}

describe("ConsoleSink", () => {
  it("writes one JSON line per record, warn/error on their own streams", () => {
    const { calls, target } = fakeConsole();
    const sink = new ConsoleSink({ format: "json", console: () => target });
    sink.write(record({ level: "DEBUG" }));
    sink.write(record({ level: "INFO" }));
    sink.write(record({ level: "WARN" }));
    sink.write(record({ level: "ERROR" }));
    sink.write(record({ level: "CRITICAL" }));
    expect(calls.map((c) => c.method)).toEqual(["log", "log", "warn", "error", "error"]);
    expect(JSON.parse(calls[1].args[0] as string).event).toBe("TASK_CREATE_SUCCESS");
    expect(calls.every((c) => c.args.length === 1 && typeof c.args[0] === "string")).toBe(true);
  });

  it("hands the object itself to a browser console, using debug/info for the low levels", () => {
    const { calls, target } = fakeConsole();
    const sink = new ConsoleSink({ format: "object", console: () => target });
    const debug = record({ level: "DEBUG" });
    sink.write(debug);
    sink.write(record({ level: "INFO" }));
    sink.write(record({ level: "ERROR" }));
    expect(calls.map((c) => c.method)).toEqual(["debug", "info", "error"]);
    expect(calls[0].args).toEqual(["TASK_CREATE_SUCCESS", debug]);
  });

  it("can print a readable line for local development", () => {
    const { calls, target } = fakeConsole();
    new ConsoleSink({ format: "pretty", console: () => target }).write(
      record({ level: "WARN", event: "SYNC_FAILED", entity_type: "task", entity_id: "t1", duration_ms: 12, error_code: "SYNC-002", metadata: { attempt: 2 }, error: { type: "TypeError", message: "Failed to fetch" } })
    );
    const line = calls[0].args[0] as string;
    expect(line).toContain("12:44:23.000");
    expect(line).toContain("WARN");
    expect(line).toContain("SYNC_FAILED");
    expect(line).toContain("[task#t1 12ms SYNC-002]");
    expect(line).toContain('{"attempt":2}');
    expect(line).toContain("!! TypeError: Failed to fetch");
    expect(calls[0].method).toBe("warn");
  });

  it("resolves console at write time, so a spy installed later still sees the record", () => {
    const sink = new ConsoleSink({ format: "json" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    sink.write(record({ level: "ERROR" }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("MemorySink / NullSink", () => {
  it("keeps the most recent records up to its bound and finds them by event", () => {
    const sink = new MemorySink(3);
    for (let i = 0; i < 5; i++) sink.write(record({ event: i % 2 ? "SYNC_FAILED" : "SYNC_STARTED", message: `m${i}` }));
    expect(sink.records.map((r) => r.message)).toEqual(["m2", "m3", "m4"]);
    expect(sink.find("SYNC_FAILED")).toHaveLength(1);
    expect(sink.events()).toEqual(["SYNC_STARTED", "SYNC_FAILED", "SYNC_STARTED"]);
    expect(sink.last()?.message).toBe("m4");
    sink.clear();
    expect(sink.records).toEqual([]);
    expect(new NullSink().write()).toBeUndefined();
  });
});

describe("FilteredSink", () => {
  it("lets through only the records at or above its threshold, and passes flush and close on", async () => {
    const seen: string[] = [];
    let flushed = 0;
    let closed = 0;
    const inner: LogSink = { name: "inner", write: (r) => void seen.push(r.level), flush: async () => void flushed++, close: async () => void closed++ };
    const sink = new FilteredSink(inner, "WARN");
    for (const level of ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"] as const) sink.write(record({ level }));
    expect(seen).toEqual(["WARN", "ERROR", "CRITICAL"]);
    await sink.flush();
    await sink.close();
    expect([flushed, closed]).toEqual([1, 1]);
    expect(sink.name).toBe("filtered(inner, WARN)");
  });

  it("copes with an inner sink that has no flush or close", async () => {
    const sink = new FilteredSink({ name: "plain", write: () => {} }, "INFO");
    await expect(sink.flush()).resolves.toBeUndefined();
    await expect(sink.close()).resolves.toBeUndefined();
  });
});

describe("BatchingSink", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  class RecordingSink implements LogSink {
    readonly name = "recording";
    written: LogRecord[] = [];
    batches: number[] = [];
    failNext = 0;
    async write(r: LogRecord): Promise<void> {
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error("disk full");
      }
      this.written.push(r);
    }
  }

  it("delivers records asynchronously, in order, after the flush interval", async () => {
    const inner = new RecordingSink();
    const sink = new BatchingSink(inner, { flushIntervalMs: 500 });
    for (let i = 0; i < 5; i++) sink.write(record({ message: `m${i}` }));
    expect(inner.written).toHaveLength(0); // write() never blocks on I/O
    await vi.advanceTimersByTimeAsync(499);
    expect(inner.written).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(inner.written.map((r) => r.message)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(sink.stats()).toMatchObject({ queued: 0, written: 5, failures: 0, dropped: 0 });
  });

  it("flushes immediately when asked, and uses the bulk path when the sink has one", async () => {
    const batches: number[][] = [];
    const inner: LogSink = { name: "bulk", write: () => {}, writeBatch: (records) => void batches.push(records.map((r) => Number(r.message))) };
    const sink = new BatchingSink(inner, { maxBatch: 3, flushIntervalMs: 10_000 });
    for (let i = 0; i < 7; i++) sink.write(record({ message: String(i) }));
    await sink.flush();
    expect(batches).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it("drops the least important records first when the queue is full, and never a protected one for a lesser one", async () => {
    const events: BatchingEvent[] = [];
    const inner = new RecordingSink();
    const sink = new BatchingSink(inner, { capacity: 5, flushIntervalMs: 10_000, reportIntervalMs: 0, onEvent: (e) => events.push(e) });
    sink.write(record({ level: "ERROR", message: "error-1" }));
    sink.write(record({ level: "DEBUG", message: "debug-1" }));
    sink.write(record({ level: "INFO", message: "info-1" }));
    sink.write(record({ level: "DEBUG", message: "debug-2" }));
    sink.write(record({ level: "ERROR", message: "error-2" }));
    // full: an INFO arrives → the oldest DEBUG goes, not an ERROR
    sink.write(record({ level: "INFO", message: "info-2" }));
    // full again: another INFO evicts the remaining DEBUG
    sink.write(record({ level: "INFO", message: "info-3" }));
    // full of ERROR/INFO: a DEBUG has nothing lesser to evict, so IT is dropped
    sink.write(record({ level: "DEBUG", message: "debug-3" }));
    await sink.flush();
    expect(inner.written.map((r) => r.message)).toEqual(["error-1", "info-1", "error-2", "info-2", "info-3"]);
    expect(sink.stats().dropped).toBe(3);
    expect(sink.stats().droppedProtected).toBe(0);
    expect(events.some((e) => e.type === "overflow")).toBe(true);
  });

  it("sacrifices the oldest protected record only when the queue holds nothing but protected ones, and says so", async () => {
    const events: BatchingEvent[] = [];
    const sink = new BatchingSink(new RecordingSink(), { capacity: 2, flushIntervalMs: 10_000, reportIntervalMs: 0, onEvent: (e) => events.push(e) });
    for (let i = 0; i < 4; i++) sink.write(record({ level: "ERROR", message: `e${i}` }));
    expect(sink.stats().droppedProtected).toBe(2);
    const overflow = events.filter((e): e is Extract<BatchingEvent, { type: "overflow" }> => e.type === "overflow");
    expect(overflow.some((e) => e.droppedProtected > 0)).toBe(true);
  });

  it("keeps records when the sink fails, retries, and never throws into the caller", async () => {
    const inner = new RecordingSink();
    inner.failNext = 2;
    const events: BatchingEvent[] = [];
    const sink = new BatchingSink(inner, { flushIntervalMs: 100, failureThreshold: 10, onEvent: (e) => events.push(e) });
    sink.write(record({ message: "keep-me" }));
    await vi.advanceTimersByTimeAsync(100); // fails
    expect(inner.written).toHaveLength(0);
    expect(sink.stats().queued).toBe(1);
    await vi.advanceTimersByTimeAsync(100); // fails again
    await vi.advanceTimersByTimeAsync(100); // succeeds
    expect(inner.written.map((r) => r.message)).toEqual(["keep-me"]);
    expect(sink.stats().failures).toBe(2);
    expect(events.filter((e) => e.type === "sink_failed")).toHaveLength(2);
  });

  it("opens a circuit after repeated failures, backs off, and closes it when the sink recovers", async () => {
    let now = 0;
    const inner = new RecordingSink();
    inner.failNext = 100;
    const events: BatchingEvent[] = [];
    const sink = new BatchingSink(inner, { flushIntervalMs: 10, failureThreshold: 3, baseBackoffMs: 1000, maxBackoffMs: 4000, now: () => now, onEvent: (e) => events.push(e) });

    sink.write(record({ message: "a" }));
    for (let i = 0; i < 3; i++) {
      await sink.flush();
      now += 1;
    }
    expect(events.some((e) => e.type === "circuit_open")).toBe(true);
    expect(sink.stats().circuit).toBe("open");

    const failuresBefore = sink.stats().failures;
    await sink.flush(); // still inside the backoff window: no attempt is made
    expect(sink.stats().failures).toBe(failuresBefore);

    inner.failNext = 0;
    now += 1000; // window over → half-open → one attempt → success
    expect(sink.stats().circuit).toBe("half-open");
    await sink.flush();
    expect(inner.written.map((r) => r.message)).toEqual(["a"]);
    expect(sink.stats().circuit).toBe("closed");
    expect(events.some((e) => e.type === "circuit_closed")).toBe(true);
  });

  it("doubles the backoff each time the circuit re-opens, up to a limit", async () => {
    let now = 0;
    const inner = new RecordingSink();
    inner.failNext = 1000;
    const opens: number[] = [];
    const sink = new BatchingSink(inner, {
      flushIntervalMs: 10, failureThreshold: 1, baseBackoffMs: 1000, maxBackoffMs: 3000, now: () => now,
      onEvent: (e) => { if (e.type === "circuit_open") opens.push(e.retryAt - now); },
    });
    sink.write(record());
    for (let i = 0; i < 4; i++) {
      await sink.flush();
      now += 10_000;
    }
    expect(opens.slice(0, 4)).toEqual([1000, 2000, 3000, 3000]);
  });

  it("shows protected records to the fallback immediately while the circuit is open", async () => {
    let now = 0;
    const inner = new RecordingSink();
    inner.failNext = 100;
    const fallback = new MemorySink();
    const sink = new BatchingSink(inner, { flushIntervalMs: 10, failureThreshold: 1, baseBackoffMs: 60_000, fallback, now: () => now });
    sink.write(record({ message: "first" }));
    await sink.flush(); // fails → circuit opens
    sink.write(record({ level: "ERROR", message: "important" }));
    sink.write(record({ level: "INFO", message: "routine" }));
    expect(fallback.records.map((r) => r.message)).toEqual(["important"]);
  });

  it("survives a sink that throws synchronously and one whose fallback throws", async () => {
    const inner: LogSink = { name: "bad", write: () => { throw new Error("sync boom"); } };
    const fallback: LogSink = { name: "worse", write: () => { throw new Error("fallback boom"); } };
    const sink = new BatchingSink(inner, { flushIntervalMs: 10, failureThreshold: 1, fallback });
    sink.write(record({ level: "ERROR" }));
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(() => sink.write(record({ level: "ERROR" }))).not.toThrow();
  });

  it("does not keep the process alive for a pending flush (timers are unref'd)", () => {
    vi.useRealTimers();
    const sink = new BatchingSink(new NullSink(), { flushIntervalMs: 60_000 });
    sink.write(record());
    // If the timer were ref'd, Vitest's worker would hang at exit; reaching this line is the check.
    expect(sink.stats().queued).toBe(1);
    return sink.close();
  });

  describe("a full batch does not wait for the interval", () => {
    it("brings the flush forward as soon as maxBatch records are waiting, though the timer was set for later when the queue was empty", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 5_000, maxBatch: 3 });
      sink.write(record({ message: "a" })); // an interval timer, 5 s away
      sink.write(record({ message: "b" }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(inner.written).toHaveLength(0); // not a full batch yet: it waits for the interval
      sink.write(record({ message: "c" }));
      await vi.advanceTimersByTimeAsync(1);
      expect(inner.written.map((r) => r.message)).toEqual(["a", "b", "c"]);
    });

    it("keeps up with a steady stream, and does not let the queue fill up waiting for a timer", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 5_000, maxBatch: 100, capacity: 500 });
      for (let tick = 0; tick < 50; tick++) {
        for (let i = 0; i < 100; i++) sink.write(record());
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(sink.stats()).toMatchObject({ dropped: 0, written: 5_000, queued: 0 });
    });

    it("sends full batches at a steady rate, not a stream of tiny ones", async () => {
      const sizes: number[] = [];
      const inner: LogSink = {
        name: "slow",
        write: () => {},
        writeBatch: async (records) => {
          sizes.push(records.length);
          await new Promise((resolve) => setTimeout(resolve, 5)); // a request takes a moment
        },
      };
      const sink = new BatchingSink(inner, { flushIntervalMs: 5_000, maxBatch: 100, capacity: 5_000 });
      for (let tick = 0; tick < 300; tick++) {
        for (let i = 0; i < 10; i++) sink.write(record()); // 1 000 records a second for three seconds
        await vi.advanceTimersByTimeAsync(10);
      }
      await sink.flush();
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(3_000);
      expect(sizes.length).toBeLessThanOrEqual(35); // about thirty full batches, not three hundred small ones
      expect(sizes.filter((size) => size === 100).length).toBeGreaterThanOrEqual(25);
      expect(sink.stats()).toMatchObject({ dropped: 0, queued: 0 });
    });

    it("still writes everything queued before an explicit flush, even while a flush the timer started is in progress", async () => {
      const written: number[] = [];
      let release: () => void = () => {};
      const inner: LogSink = {
        name: "gated",
        write: () => {},
        writeBatch: async (records) => {
          await new Promise<void>((resolve) => (release = resolve));
          written.push(...records.map((r) => Number(r.message)));
        },
      };
      const sink = new BatchingSink(inner, { flushIntervalMs: 1_000, maxBatch: 3 });
      for (let i = 0; i < 3; i++) sink.write(record({ message: String(i) }));
      await vi.advanceTimersByTimeAsync(1); // the timer's flush starts and waits at the gate
      for (let i = 3; i < 5; i++) sink.write(record({ message: String(i) })); // arrives during it
      const explicit = sink.flush();
      release();
      await vi.advanceTimersByTimeAsync(1);
      release();
      await explicit;
      expect(written).toEqual([0, 1, 2, 3, 4]);
      expect(sink.stats().queued).toBe(0);
    });

    it("writes everything when a protected record is waiting, not only the full batches", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 30_000, maxBatch: 100, urgentFlushMs: 200 });
      for (let i = 0; i < 130; i++) sink.write(record({ message: `m${i}` })); // one full batch is sent at once, thirty are left
      await vi.advanceTimersByTimeAsync(1);
      expect(inner.written).toHaveLength(100);
      sink.write(record({ level: "ERROR", message: "boom" }));
      await vi.advanceTimersByTimeAsync(250);
      expect(inner.written).toHaveLength(131); // the leftover records went with the error
      expect(inner.written.at(-1)?.message).toBe("boom");
    });

    it("does not retry sooner than the retry spacing, however many records arrive while the destination is down", async () => {
      let attempts = 0;
      const down: LogSink = { name: "down", write: async () => { attempts++; throw new Error("down"); } };
      const sink = new BatchingSink(down, { flushIntervalMs: 1_000, maxBatch: 3, failureThreshold: 100 });
      for (let i = 0; i < 3; i++) sink.write(record());
      await vi.advanceTimersByTimeAsync(1); // the full batch is tried at once, and fails
      expect(attempts).toBe(1);
      for (let tick = 0; tick < 40; tick++) {
        for (let i = 0; i < 10; i++) sink.write(record()); // a busy server keeps logging
        await vi.advanceTimersByTimeAsync(20);
      }
      expect(attempts).toBe(1); // 800 ms later: still waiting out the spacing
      await vi.advanceTimersByTimeAsync(300);
      expect(attempts).toBe(2);
    });

    it("does not pull a retry ahead of the circuit's back-off either", async () => {
      let attempts = 0;
      let now = 0;
      const down: LogSink = { name: "down", write: async () => { attempts++; throw new Error("down"); } };
      const sink = new BatchingSink(down, { flushIntervalMs: 10, maxBatch: 3, failureThreshold: 1, baseBackoffMs: 60_000, now: () => now });
      for (let i = 0; i < 3; i++) sink.write(record());
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(1);
      expect(sink.stats().circuit).toBe("open");
      for (let tick = 0; tick < 100; tick++) {
        for (let i = 0; i < 10; i++) sink.write(record());
        now += 100;
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(attempts).toBe(1); // ten seconds of traffic, and the destination was left alone
    });
  });

  describe("takeQueued: what a process that is exiting writes down itself", () => {
    it("hands over everything still waiting, oldest first across the priorities, and empties the queue", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 30_000, maxBatch: 2 });
      sink.write(record({ level: "INFO", message: "a" }));
      sink.write(record({ level: "ERROR", message: "b" }));
      sink.write(record({ level: "DEBUG", message: "c" }));
      sink.write(record({ level: "WARN", message: "d" }));
      sink.write(record({ level: "INFO", message: "e" }));
      expect(sink.takeQueued().map((r) => r.message)).toEqual(["a", "b", "c", "d", "e"]); // more than one batch's worth
      expect(sink.stats().queued).toBe(0);
      expect(sink.takeQueued()).toEqual([]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(inner.written).toEqual([]); // nothing is written twice
    });
  });

  describe("urgentFlushMs: an error should be written down soon, not at the next interval", () => {
    it("is off by default: an error waits for the interval like anything else", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 5_000 });
      sink.write(record({ level: "ERROR" }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(inner.written).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(4_100);
      expect(inner.written).toHaveLength(1);
    });

    it("brings the flush forward for a protected record, and takes the records that were waiting with it", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 30_000, urgentFlushMs: 500 });
      sink.write(record({ message: "routine" }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(inner.written).toHaveLength(0); // an ordinary record waits

      sink.write(record({ level: "ERROR", message: "boom" }));
      await vi.advanceTimersByTimeAsync(499);
      expect(inner.written).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2);
      expect(inner.written.map((r) => r.message)).toEqual(["routine", "boom"]);
    });

    it("is not triggered by an ordinary record", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 30_000, urgentFlushMs: 100 });
      sink.write(record({ level: "WARN" }));
      sink.write(record({ level: "INFO" }));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(inner.written).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(25_100);
      expect(inner.written).toHaveLength(2);
    });

    it("never pushes back a flush that is already due sooner", async () => {
      const inner = new RecordingSink();
      const sink = new BatchingSink(inner, { flushIntervalMs: 200, urgentFlushMs: 500 });
      sink.write(record()); // due in 200 ms
      sink.write(record({ level: "ERROR" })); // an urgent flush would be 500 ms away: the earlier one stays
      await vi.advanceTimersByTimeAsync(210);
      expect(inner.written).toHaveLength(2);
    });

    it("leaves the timing to the back-off while the circuit is open: an error does not bring the retry forward", async () => {
      const inner = new RecordingSink();
      inner.failNext = 100;
      const sink = new BatchingSink(inner, { flushIntervalMs: 10, failureThreshold: 1, baseBackoffMs: 60_000, urgentFlushMs: 100, now: () => 0 });
      sink.write(record({ message: "first" }));
      await sink.flush(); // fails: the circuit opens for a minute
      inner.failNext = 0;
      sink.write(record({ level: "ERROR", message: "important" }));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(inner.written).toHaveLength(0); // still backing off
    });
  });

  it("drains on close and closes the inner sink once", async () => {
    let closed = 0;
    const inner: LogSink = { name: "inner", write: () => {}, close: async () => void closed++ };
    const sink = new BatchingSink(inner, { flushIntervalMs: 10_000 });
    sink.write(record());
    await sink.close();
    expect(sink.stats().written).toBe(1);
    expect(closed).toBe(1);
  });
});
