// Where log records go. The logger knows only the LogSink interface, never a provider: the console
// today; a rotated file, a remote collector (Loki, Elasticsearch, an OpenTelemetry exporter) or the
// phone's on-device file tomorrow — each one just another implementation.
//
// The rule every sink and the machinery around it follows: LOGGING FAILURE MUST NOT BECOME
// APPLICATION FAILURE. A sink may throw, reject, hang or fill a disk; the application carries on.
import type { LogRecord } from "./schema";
import { LEVEL_VALUE } from "./levels";

export interface LogSink {
  readonly name: string;
  /** Must not block the caller. A sink that does slow I/O is wrapped in a BatchingSink. */
  write(record: LogRecord): void | Promise<void>;
  /** Optional bulk path (one file append for many lines). */
  writeBatch?(records: LogRecord[]): void | Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------------------------

export interface ConsoleLike {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 *  - "json":   one JSON line per record (what a server writes to stdout for Docker / a log shipper);
 *  - "object": the record itself, so browser devtools and Android's Chrome inspector can expand it;
 *  - "pretty": a compact human-readable line for local development.
 */
export type ConsoleFormat = "json" | "object" | "pretty";

function consoleMethod(level: LogRecord["level"], format: ConsoleFormat): keyof ConsoleLike {
  const value = LEVEL_VALUE[level];
  if (value >= LEVEL_VALUE.ERROR) return "error";
  if (value >= LEVEL_VALUE.WARN) return "warn";
  if (format === "object") return value <= LEVEL_VALUE.DEBUG ? "debug" : "info";
  return "log";
}

function pretty(record: LogRecord): string {
  const { timestamp, level, event, message, service, metadata, error, duration_ms, entity_type, entity_id, error_code } = record;
  const extras: string[] = [];
  if (entity_type) extras.push(`${entity_type}${entity_id ? `#${entity_id}` : ""}`);
  if (duration_ms !== undefined) extras.push(`${duration_ms}ms`);
  if (error_code) extras.push(String(error_code));
  const tail = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : "";
  const err = error ? ` !! ${error.type}: ${error.message}` : "";
  return `${timestamp.slice(11, 23)} ${level.padEnd(8)} ${service} ${event}${extras.length ? ` [${extras.join(" ")}]` : ""} — ${message}${tail}${err}`;
}

export class ConsoleSink implements LogSink {
  readonly name = "console";
  private readonly format: ConsoleFormat;
  private readonly target: () => ConsoleLike;

  /** `target` is resolved on every write, so a test's `vi.spyOn(console, "error")` still sees the call. */
  constructor(options: { format?: ConsoleFormat; console?: () => ConsoleLike } = {}) {
    this.format = options.format ?? "json";
    this.target = options.console ?? (() => globalThis.console as ConsoleLike);
  }

  write(record: LogRecord): void {
    const target = this.target();
    const method = consoleMethod(record.level, this.format);
    if (this.format === "object") {
      target[method](record.event, record);
    } else if (this.format === "pretty") {
      target[method](pretty(record));
    } else {
      target[method](JSON.stringify(record));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Memory (tests, and the "recent events" ring buffer a diagnostics screen can read)
// ---------------------------------------------------------------------------------------------

export class MemorySink implements LogSink {
  readonly name = "memory";
  readonly records: LogRecord[] = [];

  constructor(private readonly max = 1000) {}

  write(record: LogRecord): void {
    this.records.push(record);
    if (this.records.length > this.max) this.records.splice(0, this.records.length - this.max);
  }

  clear(): void {
    this.records.length = 0;
  }

  events(): string[] {
    return this.records.map((record) => record.event);
  }

  find(event: string): LogRecord[] {
    return this.records.filter((record) => record.event === event);
  }

  last(): LogRecord | undefined {
    return this.records[this.records.length - 1];
  }
}

/** Discards everything — for benchmarks and for switching a sink off cleanly. */
export class NullSink implements LogSink {
  readonly name = "null";
  write(): void {}
}

// ---------------------------------------------------------------------------------------------
// Batching: the asynchronous, bounded, failure-tolerant wrapper for any sink that does real I/O
// ---------------------------------------------------------------------------------------------

export type BatchingEvent =
  | { type: "overflow"; dropped: number; droppedProtected: number }
  | { type: "sink_failed"; error: unknown; consecutiveFailures: number }
  | { type: "circuit_open"; retryAt: number }
  | { type: "circuit_closed" };

export interface BatchingOptions {
  /** Most records held in memory; beyond it the least important are dropped. Default 10 000. */
  capacity?: number;
  /** Most records handed to the inner sink at once. Default 200. */
  maxBatch?: number;
  /** How long a record may wait before a flush. Default 1000 ms. */
  flushIntervalMs?: number;
  /** Consecutive failed writes before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** First and largest wait before the circuit tries the inner sink again. Defaults 1 s / 60 s. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Seconds between "records were dropped" reports. Default 60. */
  reportIntervalMs?: number;
  /** Sees ERROR-and-above records immediately while the circuit is open (typically the console). */
  fallback?: LogSink | null;
  /**
   * When set, a protected record (ERROR and above by default) brings the next flush forward to at most this many
   * milliseconds away: a phone that is about to be killed after a crash should have written the error down.
   * Default: no such urgency.
   */
  urgentFlushMs?: number;
  /** Which records may never be sacrificed; default: ERROR and above. */
  isProtected?: (record: LogRecord) => boolean;
  now?: () => number;
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
  onEvent?: (event: BatchingEvent) => void;
}

interface Queued {
  seq: number;
  record: LogRecord;
}

/** A FIFO with O(1) push/shift (an array with a moving head, compacted occasionally). */
class Fifo {
  private items: Queued[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }
  push(item: Queued): void {
    this.items.push(item);
  }
  shift(): Queued | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head++];
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
  peek(): Queued | undefined {
    return this.items[this.head];
  }
  unshiftAll(batch: Queued[]): void {
    this.items = batch.concat(this.items.slice(this.head));
    this.head = 0;
  }
}

const defaultTimers = {
  set(callback: () => void, ms: number): unknown {
    const handle = setTimeout(callback, ms);
    (handle as { unref?: () => void }).unref?.(); // never keep a Node process alive just to flush logs
    return handle;
  },
  clear(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type CircuitState = "closed" | "open" | "half-open";

export class BatchingSink implements LogSink {
  readonly name: string;
  private readonly capacity: number;
  private readonly maxBatch: number;
  private readonly flushIntervalMs: number;
  private readonly failureThreshold: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly reportIntervalMs: number;
  private readonly fallback: LogSink | null;
  private readonly urgentFlushMs: number | undefined;
  private readonly isProtected: (record: LogRecord) => boolean;
  private readonly now: () => number;
  private readonly timers: NonNullable<BatchingOptions["timers"]>;
  private readonly onEvent?: (event: BatchingEvent) => void;

  // priority buckets: 0 = TRACE/DEBUG, 1 = INFO/WARN, 2 = protected
  private readonly queues = [new Fifo(), new Fifo(), new Fifo()];
  private size = 0;
  private seq = 0;

  private timer: unknown = null;
  private timerDueAt = 0;
  private flushing: Promise<void> | null = null;

  private state: CircuitState = "closed";
  private retryAt = 0;
  private backoffMs: number;
  private consecutiveFailures = 0;

  private written = 0;
  private failures = 0;
  private droppedOverflow = 0;
  private droppedProtected = 0;
  private droppedSinceReport = 0;
  private droppedProtectedSinceReport = 0;
  private lastReportAt = 0;

  constructor(private readonly inner: LogSink, options: BatchingOptions = {}) {
    this.name = `batching(${inner.name})`;
    this.capacity = Math.max(1, options.capacity ?? 10_000);
    this.maxBatch = Math.max(1, options.maxBatch ?? 200);
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.reportIntervalMs = options.reportIntervalMs ?? 60_000;
    this.fallback = options.fallback ?? null;
    this.urgentFlushMs = options.urgentFlushMs;
    this.isProtected = options.isProtected ?? ((record) => LEVEL_VALUE[record.level] >= LEVEL_VALUE.ERROR);
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? defaultTimers;
    this.onEvent = options.onEvent;
    this.backoffMs = this.baseBackoffMs;
  }

  write(record: LogRecord): void {
    const priority = this.priorityOf(record);

    if (this.state === "open" && priority === 2 && this.fallback) this.safeFallback(record);

    if (this.size >= this.capacity && !this.makeRoom(priority)) {
      this.noteDrop(priority);
      return;
    }
    this.queues[priority].push({ seq: ++this.seq, record });
    this.size++;
    this.schedule(this.size >= this.maxBatch ? 0 : this.flushIntervalMs);
    if (priority === 2) this.scheduleUrgent();
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      return;
    }
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    await this.flush();
    try {
      await this.inner.close?.();
    } catch {
      // closing must never throw into a shutdown path
    }
  }

  stats(): { queued: number; written: number; failures: number; dropped: number; droppedProtected: number; circuit: CircuitState } {
    return {
      queued: this.size,
      written: this.written,
      failures: this.failures,
      dropped: this.droppedOverflow,
      droppedProtected: this.droppedProtected,
      circuit: this.currentCircuit(),
    };
  }

  // ------------------------------------------------------------------------------------------

  private priorityOf(record: LogRecord): 0 | 1 | 2 {
    if (this.isProtected(record)) return 2;
    return LEVEL_VALUE[record.level] <= LEVEL_VALUE.DEBUG ? 0 : 1;
  }

  /** Evicts the oldest record that is no more important than the incoming one. */
  private makeRoom(incoming: 0 | 1 | 2): boolean {
    for (let bucket = 0; bucket <= incoming; bucket++) {
      if (this.queues[bucket].length > 0) {
        this.queues[bucket].shift();
        this.size--;
        this.noteDrop(bucket as 0 | 1 | 2);
        return true;
      }
    }
    return false;
  }

  private noteDrop(priority: 0 | 1 | 2): void {
    this.droppedOverflow++;
    this.droppedSinceReport++;
    if (priority === 2) {
      this.droppedProtected++;
      this.droppedProtectedSinceReport++;
    }
    const at = this.now();
    if (at - this.lastReportAt >= this.reportIntervalMs) {
      this.lastReportAt = at;
      const event: BatchingEvent = { type: "overflow", dropped: this.droppedSinceReport, droppedProtected: this.droppedProtectedSinceReport };
      this.droppedSinceReport = 0;
      this.droppedProtectedSinceReport = 0;
      this.emit(event);
    }
  }

  private currentCircuit(): CircuitState {
    if (this.state === "open" && this.now() >= this.retryAt) return "half-open";
    return this.state;
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) return;
    this.timerDueAt = this.now() + delayMs;
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }

  /** Brings a pending flush forward (see urgentFlushMs); while the circuit is open the back-off decides instead. */
  private scheduleUrgent(): void {
    if (this.urgentFlushMs === undefined || this.state === "open") return;
    const dueAt = this.now() + this.urgentFlushMs;
    if (this.timer !== null) {
      if (this.timerDueAt <= dueAt) return;
      this.timers.clear(this.timer);
    }
    this.timerDueAt = dueAt;
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.flush();
    }, this.urgentFlushMs);
  }

  /** Takes up to maxBatch records in their original order across the three priority buckets. */
  private takeBatch(): Queued[] {
    const batch: Queued[] = [];
    while (batch.length < this.maxBatch) {
      let pick: Fifo | null = null;
      let pickSeq = Infinity;
      for (const queue of this.queues) {
        const head = queue.peek();
        if (head && head.seq < pickSeq) {
          pick = queue;
          pickSeq = head.seq;
        }
      }
      if (!pick) break;
      batch.push(pick.shift()!);
    }
    this.size -= batch.length;
    return batch;
  }

  private restore(batch: Queued[]): void {
    for (const bucket of [0, 1, 2] as const) {
      const mine = batch.filter((item) => this.priorityOf(item.record) === bucket);
      if (mine.length > 0) this.queues[bucket].unshiftAll(mine);
    }
    this.size += batch.length;
  }

  private async drain(): Promise<void> {
    while (this.size > 0) {
      if (this.state === "open") {
        if (this.now() < this.retryAt) {
          this.schedule(Math.max(1, this.retryAt - this.now()));
          return;
        }
        this.state = "half-open";
      }

      const batch = this.takeBatch();
      try {
        const records = batch.map((item) => item.record);
        if (this.inner.writeBatch) await this.inner.writeBatch(records);
        else for (const record of records) await this.inner.write(record);
        this.written += records.length;
        this.consecutiveFailures = 0;
        this.backoffMs = this.baseBackoffMs;
        if (this.state !== "closed") {
          this.state = "closed";
          this.emit({ type: "circuit_closed" });
        }
      } catch (error) {
        this.failures++;
        this.consecutiveFailures++;
        this.restore(batch); // keep them: the sink may come back
        this.emit({ type: "sink_failed", error, consecutiveFailures: this.consecutiveFailures });
        if (this.state === "half-open" || this.consecutiveFailures >= this.failureThreshold) {
          this.state = "open";
          this.retryAt = this.now() + this.backoffMs;
          this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
          this.emit({ type: "circuit_open", retryAt: this.retryAt });
        }
        this.schedule(this.state === "open" ? Math.max(1, this.retryAt - this.now()) : this.flushIntervalMs);
        return; // do not spin on a failing sink
      }
    }
  }

  private safeFallback(record: LogRecord): void {
    try {
      const result = this.fallback?.write(record);
      if (result && typeof (result as Promise<void>).catch === "function") (result as Promise<void>).catch(() => {});
    } catch {
      // the fallback is best effort by definition
    }
  }

  private emit(event: BatchingEvent): void {
    try {
      this.onEvent?.(event);
    } catch {
      // a broken observer must not break the sink
    }
  }
}
