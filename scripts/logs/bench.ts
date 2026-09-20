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
