// The last few warnings and errors the server wrote, kept in memory for the admin health view: "what went wrong just
// now?" answered without opening a file or a log viewer. It is a view of the same records the other sinks get — already
// redacted — cut down to the facts one scans a list for (when, what, which request, which code). Never metadata, never
// a stack. Lost on restart by design; the log file is the durable record.
import type { LoggerCore } from "../core/logger";
import type { LogRecord } from "../core/schema";
import { FilteredSink, MemorySink } from "../core/sink";
import { getRootCore } from "../root";

const HOLDER = Symbol.for("parva.observability.recentProblems.v1");
const CAPACITY = 100;

export interface RecentProblem {
  timestamp: string;
  level: string;
  event: string;
  message: string;
  module?: string;
  requestId?: string;
  errorCode?: string | null;
  /** "POST /api/tasks" for a request record. */
  request?: string;
  statusCode?: number;
  errorType?: string;
}

interface Installed {
  core: LoggerCore;
  memory: MemorySink;
  sink: FilteredSink;
}

function installed(): Installed | undefined {
  return (globalThis as unknown as Record<symbol, Installed | undefined>)[HOLDER];
}

/** Starts collecting WARN-and-above records from `core`. Idempotent: a second call for the same logger does nothing. */
export function installRecentProblems(core: LoggerCore = getRootCore()): void {
  const existing = installed();
  if (existing?.core === core) return;
  existing?.core.removeSink(existing.sink.name);
  const memory = new MemorySink(CAPACITY);
  const sink = new FilteredSink(memory, "WARN");
  core.addSink(sink);
  (globalThis as unknown as Record<symbol, Installed>)[HOLDER] = { core, memory, sink };
}

/** Stops collecting and forgets what was collected (tests). */
export function resetRecentProblems(): void {
  const existing = installed();
  existing?.core.removeSink(existing.sink.name);
  delete (globalThis as unknown as Record<symbol, Installed | undefined>)[HOLDER];
}

function summarize(record: LogRecord): RecentProblem {
  return {
    timestamp: record.timestamp,
    level: record.level,
    event: record.event,
    message: record.message,
    module: record.module,
    requestId: record.request_id,
    errorCode: record.error_code,
    request: record.method && record.path ? `${record.method} ${record.path}` : undefined,
    statusCode: record.status_code,
    errorType: record.error?.type,
  };
}

/** The newest first, at most `limit`. */
export function recentProblems(limit = 20): RecentProblem[] {
  const current = installed();
  if (!current) return [];
  return current.memory.records.slice(-Math.max(1, limit)).reverse().map(summarize);
}
