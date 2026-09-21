// How much does a log call cost? Run:  npm run logs:bench
//
// Measures the logger's own overhead (record building, context, redaction, dispatch to a sink that
// does nothing) — i.e. what the application pays on the calling thread — and translates it into the
// CPU share at 100 / 1 000 / 10 000 records per second. The console/file/network cost is a sink's and,
// behind a BatchingSink, is off the calling path. On-device battery/CPU/storage impact can only be
// measured on a real phone (see doc/logging/android.md).
import { performance } from "node:perf_hooks";
import { createLoggerCore, Logger } from "../../src/lib/observability/core/logger";
import { MetricsRegistry } from "../../src/lib/observability/core/metrics";
import { BatchingSink, ConsoleSink, NullSink, type ConsoleLike, type LogSink } from "../../src/lib/observability/core/sink";

const noop = () => {};
const silentConsole: ConsoleLike = { debug: noop, info: noop, log: noop, warn: noop, error: noop };

function makeLogger(sink: LogSink, level: "INFO" | "TRACE" = "INFO"): Logger {
  const core = createLoggerCore({
    service: "parva-bench",
    environment: "production",
    platform: "server",
    level,
    sinks: [sink],
    metrics: new MetricsRegistry(),
    contextProviders: [() => ({ requestId: "req_01J0000000000000000000000", userId: "usr_bench", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" })],
    reportInternal: noop,
  });
  return new Logger(() => core);
}

interface Result {
  name: string;
  nsPerCall: number;
}

function measure(name: string, calls: number, fn: (i: number) => void): Result {
  for (let i = 0; i < Math.min(20_000, calls); i++) fn(i); // warm up the JIT
  const started = performance.now();
  for (let i = 0; i < calls; i++) fn(i);
  const elapsedMs = performance.now() - started;
  return { name, nsPerCall: (elapsedMs * 1e6) / calls };
}

const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");
const results: Result[] = [];

{
  const log = makeLogger(new NullSink());
  results.push(measure("disabled DEBUG call (level INFO)", 5_000_000, () => log.debug("SYNC_PULL_STARTED", { table: "Task" })));
  results.push(measure("INFO, no fields → null sink", 500_000, () => log.info("SYNC_STARTED")));
  results.push(measure("INFO, 4 fields (money masked) → null sink", 300_000, (i) => log.info("EXPENSE_CREATE_SUCCESS", { expenseId: `exp_${i}`, amount: 250000, accountId: "acc_1", categoryId: "cat_1" })));
  results.push(measure("ERROR with an Error + stack → null sink", 100_000, () => log.error("SYNC_FAILED", { error, errorCode: "SYNC-002", syncId: "sync_1" })));
}
{
  const batching = new BatchingSink(new NullSink(), { capacity: 50_000, flushIntervalMs: 50 });
  const log = makeLogger(batching);
  results.push(measure("INFO, 4 fields → BatchingSink(null)", 300_000, (i) => log.info("TASK_CREATE_SUCCESS", { taskId: `t_${i}`, projectId: "p_1", categoryId: "c_1", operation: "create" })));
  void batching.close();
}
{
  const log = makeLogger(new ConsoleSink({ format: "json", console: () => silentConsole }));
  results.push(measure("INFO, 4 fields → console JSON (no-op console)", 200_000, (i) => log.info("TASK_CREATE_SUCCESS", { taskId: `t_${i}`, projectId: "p_1", categoryId: "c_1", operation: "create" })));
}

const before = process.memoryUsage().heapUsed;
{
  const log = makeLogger(new NullSink());
  for (let i = 0; i < 1_000_000; i++) log.info("TASK_CREATE_SUCCESS", { taskId: `t_${i}` });
}
const heapGrowthMb = Math.max(0, (process.memoryUsage().heapUsed - before) / 1e6);

const pct = (rate: number, ns: number) => `${((rate * ns) / 1e9 * 100).toFixed(3)} %`;
console.log("| Scenario | ns / call | max calls / s | CPU @ 100/s | CPU @ 1 000/s | CPU @ 10 000/s |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const r of results) {
  console.log(`| ${r.name} | ${r.nsPerCall.toFixed(0)} | ${Math.round(1e9 / r.nsPerCall).toLocaleString("en-US")} | ${pct(100, r.nsPerCall)} | ${pct(1000, r.nsPerCall)} | ${pct(10_000, r.nsPerCall)} |`);
}
console.log(`\nHeap after 1 000 000 records to a null sink: +${heapGrowthMb.toFixed(1)} MB (records are not retained).`);

// ---------------------------------------------------------------------------------------------
// The rotating log file (src/lib/observability/core/rotatingFileSink.ts — the phone's own log, and the server's): what a record costs to keep.
// The store here is in memory, so this is the sink's own work — serialising, grouping, rotating,
// gzip — not the flash storage's; and it is off the calling path (the BatchingSink queues, a timer writes).
// ---------------------------------------------------------------------------------------------
async function deviceFileSection(): Promise<void> {
  const { RotatingFileSink, ROTATION_DEFAULTS } = await import("../../src/lib/observability/core/rotatingFileSink");
  const { MemoryLogFileStore } = await import("../../src/lib/observability/core/logFileStore");
  const { newId, newTraceId } = await import("../../src/lib/observability/core/ids");

  // Every record carries fresh ids and timings, as real ones do — identical lines would compress to almost nothing and flatter the numbers.
  const typical = (i: number) => ({
    timestamp: new Date(Date.UTC(2026, 8, 21, 4, 0, 0) + i * 100).toISOString(),
    level: "INFO" as const,
    event: "SYNC_PUSH_SUCCESS",
    message: "Local changes were sent and accepted.",
    service: "parva-android",
    module: "sync",
    component: "wire",
    environment: "production" as const,
    app_version: "1.2.0",
    user_id: "cmuaqrrll00004c75p5cp5r7a",
    session_id: "sess_01J8ZQ2M3N4P5R6S7T8V9W0X1Y",
    trace_id: newTraceId(),
    platform: "android" as const,
    device_id: "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y",
    os_version: "Android 14",
    tz: "Asia/Tehran",
    layer: "local" as const,
    sync_id: newId("sync"),
    duration_ms: Math.round(Math.random() * 50_000) / 100,
    metadata: { batches: 1, recordCount: 3, pushed: 3, skipped: 0, rejected: 0, sentIds: { Task: [crypto.randomUUID()] }, serverRequestIds: [newId("req")] },
  });

  const store = new MemoryLogFileStore();
  const sink = new RotatingFileSink({ store });
  const batches = 200;
  const perBatch = 100;
  const started = performance.now();
  for (let b = 0; b < batches; b++) await sink.writeBatch(Array.from({ length: perBatch }, (_, i) => typical(b * perBatch + i)));
  const elapsedMs = performance.now() - started;
  const records = batches * perBatch;
  const stats = sink.stats();
  const plainBytes = new TextEncoder().encode(JSON.stringify(typical(0))).length + 1;

  console.log("\n### The phone's own log file");
  console.log("| Measure | Value |");
  console.log("| --- | ---: |");
  console.log(`| a typical INFO record on disk (JSON line) | ${plainBytes} bytes |`);
  console.log(`| ${records.toLocaleString("en-US")} records written through the file sink | ${elapsedMs.toFixed(0)} ms (${Math.round(records / (elapsedMs / 1000)).toLocaleString("en-US")} records/s) |`);
  console.log(`| rotations / compressed archives in that run | ${stats.rotations} / ${stats.compressed} |`);
  console.log(`| disk in use afterwards (ceiling ${(ROTATION_DEFAULTS.maxTotalBytes / 1024 / 1024).toFixed(0)} MB) | ${(store.totalBytes() / 1024).toFixed(0)} KB |`);
  const archive = [...store.files.entries()].find(([name]) => name.endsWith(".gz"));
  if (archive) console.log(`| a compressed 256 KB archive | ${(archive[1].data.length / 1024).toFixed(1)} KB (${(archive[1].data.length / (ROTATION_DEFAULTS.maxFileBytes) * 100).toFixed(0)} % of its plain size) |`);
  const uncompressed = Math.floor(ROTATION_DEFAULTS.maxTotalBytes / plainBytes);
  console.log(`| records that fit in the ceiling, uncompressed | ~${uncompressed.toLocaleString("en-US")} |`);
  const ratio = archive ? archive[1].data.length / ROTATION_DEFAULTS.maxFileBytes : 1;
  const compressed = Math.floor(uncompressed / Math.max(ratio, 0.01));
  console.log(`| …and compressed (rotated files, at that ratio) | ~${compressed.toLocaleString("en-US")} (about ${Math.floor(compressed / (ROTATION_DEFAULTS.retentionMs / 86_400_000)).toLocaleString("en-US")} a day for the whole retention period) |`);
  console.log(`| in-memory queue worst case (2 000 records) | ~${((2000 * plainBytes) / 1024 / 1024).toFixed(1)} MB |`);
  console.log(`| retention | ${ROTATION_DEFAULTS.retentionMs / 86_400_000} days, a file per day at most |`);
  console.log("\nBattery and CPU on a real phone are not measured here; the writes are batched (at most one append every 3 s, a flush on background), so the radio-free cost is a handful of small file appends per minute.");
}

// ---------------------------------------------------------------------------------------------
// The server's own destinations (src/lib/observability/server/serverSinks.ts): the rotated file on a real disk and the
// central collector over real HTTP, built by the same startServerLogSinks() the server uses, and driven at a steady
// 100 / 1 000 / 10 000 records a second. What is measured is what the application would feel: the event loop's worst stall,
// the CPU the process spends in total, how deep the queues got, and whether anything had to be dropped — plus the
// case that matters most, a collector that is down.
// ---------------------------------------------------------------------------------------------
async function serverSection(): Promise<void> {
  const { mkdtempSync, readdirSync, rmSync, statSync } = await import("node:fs");
  const { createServer } = await import("node:http");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { monitorEventLoopDelay } = await import("node:perf_hooks");
  const { startServerLogSinks } = await import("../../src/lib/observability/server/serverSinks");
  const { newId, newTraceId } = await import("../../src/lib/observability/core/ids");
  type LogSinks = ReturnType<typeof startServerLogSinks>;

  const SECONDS = 3;
  const RATES = [100, 1_000, 10_000];

  interface Run {
    rate: number;
    emitted: number;
    wallMs: number;
    maxLagMs: number;
    cpuPercent: number;
    queuePeak: number;
    heapGrowthMb: number;
  }

  function loggerFor(start: (core: ReturnType<typeof createLoggerCore>) => LogSinks) {
    let current = { requestId: newId("req"), traceId: newTraceId() };
    const core = createLoggerCore({
      service: "parva-api",
      environment: "production",
      platform: "server",
      level: "INFO",
      sinks: [new NullSink()],
      metrics: new MetricsRegistry(),
      contextProviders: [() => ({ requestId: current.requestId, traceId: current.traceId, userId: "cmuaqrrll00004c75p5cp5r7a" })],
      reportInternal: noop,
    });
    const started = start(core);
    const log = new Logger(() => core);
    const emit = (i: number) => {
      current = { requestId: newId("req"), traceId: newTraceId() };
      log.info("HTTP_REQUEST_COMPLETED", { httpMethod: "POST", httpPath: "/api/tasks", statusCode: 201, durationMs: 5 + (i % 40) + Math.random(), responseSize: 512, route: "/api/tasks", dbQueries: 3, dbMs: 2.5 });
    };
    return { started, emit };
  }

  /** Emits at a steady `rate` for SECONDS, in ticks, while watching the event loop, the CPU and how deep the queues get. */
  async function paced(rate: number, emit: (i: number) => void, queued: () => number): Promise<Run> {
    const lag = monitorEventLoopDelay({ resolution: 5 });
    lag.enable();
    const heapBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    let emitted = 0;
    let queuePeak = 0;
    while (performance.now() - started < SECONDS * 1000) {
      const due = Math.floor(((performance.now() - started) / 1000) * rate);
      while (emitted < due) emit(emitted++);
      queuePeak = Math.max(queuePeak, queued());
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    lag.disable();
    return {
      rate,
      emitted,
      wallMs,
      maxLagMs: lag.max / 1e6,
      cpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100,
      queuePeak,
      heapGrowthMb: Math.max(0, (process.memoryUsage().heapUsed - heapBefore) / 1e6),
    };
  }

  const dirSize = (dir: string) => readdirSync(dir).reduce((sum, name) => sum + statSync(path.join(dir, name)).size, 0);

  // ---- the rotated file, on this machine's disk
  console.log("\n### The server's log file (real disk, LOG_FILE_DIR)");
  console.log("| Records/s | emitted | written | dropped | queue peak | disk | per record | event-loop stall (max) | process CPU | rotations |");
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const rate of RATES) {
    const dir = mkdtempSync(path.join(tmpdir(), "parva-bench-"));
    const { started, emit } = loggerFor((core) => startServerLogSinks({ core, env: { LOG_FILE_DIR: dir }, onInternalProblem: noop }));
    const run = await paced(rate, emit, () => started.stats().file?.queue.queued ?? 0);
    await started.flush();
    const stats = started.stats().file!;
    const bytes = dirSize(dir);
    console.log(
      `| ${rate.toLocaleString("en-US")} | ${run.emitted.toLocaleString("en-US")} | ${stats.queue.written.toLocaleString("en-US")} | ${stats.queue.dropped} | ${run.queuePeak.toLocaleString("en-US")} | ${(bytes / 1024 / 1024).toFixed(1)} MB | ${Math.round(bytes / Math.max(1, stats.queue.written))} B | ${run.maxLagMs.toFixed(1)} ms | ${run.cpuPercent.toFixed(1)} % | ${stats.files.rotations} |`
    );
    started.dispose();
    rmSync(dir, { recursive: true, force: true });
  }

  // ---- the central collector, over HTTP (an in-process server that reads and discards the body, so its own work is in the CPU column too)
  console.log("\n### The central collector (LOG_REMOTE_URL, INFO and above: the heaviest setting)");
  console.log("| Records/s | emitted | delivered | dropped | requests | records per request | wire bytes per record | queue peak | event-loop stall (max) | process CPU |");
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const rate of RATES) {
    let requests = 0;
    let wireBytes = 0;
    const collector = createServer((req, res) => {
      req.on("data", (chunk: Buffer) => (wireBytes += chunk.length));
      req.on("end", () => {
        requests++;
        res.end();
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve));
    const port = (collector.address() as { port: number }).port;
    const { started, emit } = loggerFor((core) => startServerLogSinks({ core, env: { LOG_REMOTE_URL: `http://127.0.0.1:${port}/ingest`, LOG_REMOTE_MIN_LEVEL: "INFO" }, onInternalProblem: noop }));
    const run = await paced(rate, emit, () => started.stats().remote?.queue.queued ?? 0);
    await started.flush();
    const stats = started.stats().remote!;
    console.log(
      `| ${rate.toLocaleString("en-US")} | ${run.emitted.toLocaleString("en-US")} | ${stats.queue.written.toLocaleString("en-US")} | ${stats.queue.dropped} | ${requests} | ${Math.round(stats.queue.written / Math.max(1, requests))} | ${Math.round(wireBytes / Math.max(1, stats.queue.written))} B | ${run.queuePeak.toLocaleString("en-US")} | ${run.maxLagMs.toFixed(1)} ms | ${run.cpuPercent.toFixed(1)} % |`
    );
    started.dispose();
    collector.closeAllConnections?.();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }

  // ---- a collector that is not there: logging must not become an application problem
  console.log("\n### A collector that is down (nothing listens on the address)");
  console.log("| Records/s | emitted | delivered | dropped | queue peak (cap 5 000) | circuit | event-loop stall (max) | process CPU | heap growth |");
  console.log("| ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |");
  for (const rate of RATES) {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const port = (dead.address() as { port: number }).port;
    await new Promise<void>((resolve) => dead.close(() => resolve())); // the port is now closed
    const { started, emit } = loggerFor((core) => startServerLogSinks({ core, env: { LOG_REMOTE_URL: `http://127.0.0.1:${port}/ingest`, LOG_REMOTE_MIN_LEVEL: "INFO", LOG_REMOTE_TIMEOUT_MS: "1000" }, onInternalProblem: noop }));
    const run = await paced(rate, emit, () => started.stats().remote?.queue.queued ?? 0);
    const stats = started.stats().remote!;
    console.log(
      `| ${rate.toLocaleString("en-US")} | ${run.emitted.toLocaleString("en-US")} | ${stats.queue.written} | ${stats.queue.dropped.toLocaleString("en-US")} | ${run.queuePeak.toLocaleString("en-US")} | ${stats.queue.circuit} | ${run.maxLagMs.toFixed(1)} ms | ${run.cpuPercent.toFixed(1)} % | +${run.heapGrowthMb.toFixed(1)} MB |`
    );
    started.dispose();
  }
  console.log(`\nEach row is ${SECONDS} seconds at a steady rate. The application's own cost of a log call is in the first table above; these rows are what the destinations add.`);
}

void (async () => {
  await deviceFileSection();
  await serverSection();
})();
