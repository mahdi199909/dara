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
// The phone's own log file (src/lib/observability/client/fileSink.ts): what a record costs to keep.
// The store here is in memory, so this is the sink's own work — serialising, grouping, rotating,
// gzip — not the flash storage's; and it is off the calling path (the BatchingSink queues, a timer writes).
// ---------------------------------------------------------------------------------------------
async function deviceFileSection(): Promise<void> {
  const { DeviceLogFileSink, DEVICE_LOG_DEFAULTS } = await import("../../src/lib/observability/client/fileSink");
  const { MemoryLogFileStore } = await import("../../src/lib/observability/client/logFileStore");
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
  const sink = new DeviceLogFileSink({ store });
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
  console.log(`| disk in use afterwards (ceiling ${(DEVICE_LOG_DEFAULTS.maxTotalBytes / 1024 / 1024).toFixed(0)} MB) | ${(store.totalBytes() / 1024).toFixed(0)} KB |`);
  const archive = [...store.files.entries()].find(([name]) => name.endsWith(".gz"));
  if (archive) console.log(`| a compressed 256 KB archive | ${(archive[1].data.length / 1024).toFixed(1)} KB (${(archive[1].data.length / (DEVICE_LOG_DEFAULTS.maxFileBytes) * 100).toFixed(0)} % of its plain size) |`);
  const uncompressed = Math.floor(DEVICE_LOG_DEFAULTS.maxTotalBytes / plainBytes);
  console.log(`| records that fit in the ceiling, uncompressed | ~${uncompressed.toLocaleString("en-US")} |`);
  const ratio = archive ? archive[1].data.length / DEVICE_LOG_DEFAULTS.maxFileBytes : 1;
  const compressed = Math.floor(uncompressed / Math.max(ratio, 0.01));
  console.log(`| …and compressed (rotated files, at that ratio) | ~${compressed.toLocaleString("en-US")} (about ${Math.floor(compressed / (DEVICE_LOG_DEFAULTS.retentionMs / 86_400_000)).toLocaleString("en-US")} a day for the whole retention period) |`);
  console.log(`| in-memory queue worst case (2 000 records) | ~${((2000 * plainBytes) / 1024 / 1024).toFixed(1)} MB |`);
  console.log(`| retention | ${DEVICE_LOG_DEFAULTS.retentionMs / 86_400_000} days, a file per day at most |`);
  console.log("\nBattery and CPU on a real phone are not measured here; the writes are batched (at most one append every 3 s, a flush on background), so the radio-free cost is a handful of small file appends per minute.");
}
void deviceFileSection();
