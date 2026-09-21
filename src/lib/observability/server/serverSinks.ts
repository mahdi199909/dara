// Where the server's records go besides stdout (stdout, and so Docker's own log, always gets every record):
//
//   a rotated file      LOG_FILE_DIR — durable and searchable by the support timeline, kept LOG_RETENTION_DAYS days
//   a central collector LOG_REMOTE_URL — records at LOG_REMOTE_MIN_LEVEL and above, over HTTP
//
// Both sit behind a BatchingSink: a bounded in-memory queue (the least important records are dropped first when it
// is full, errors last), written a batch at a time off the request path, retried with back-off, and cut off by a
// circuit breaker while the destination is down. When one fails the application does not notice, the other sinks
// carry on, and the fact is reported on the console, at most once a minute.
//
// Started once from startServerObservability(); configuration is documented in logConfig.ts and doc/logging/operations.md.
import type { LoggerCore } from "../core/logger";
import type { Level } from "../core/levels";
import type { LogFileStore } from "../core/logFileStore";
import { RotatingFileSink, type RotatingFileStats } from "../core/rotatingFileSink";
import { BatchingSink, FilteredSink, type BatchingEvent } from "../core/sink";
import { getRootCore } from "../root";
import { HttpLogSink } from "./httpLogSink";
import { resolveServerLogConfig, type ServerLogConfig } from "./logConfig";
import { createNodeLogFileStore } from "./nodeLogFileStore";

const MB = 1024 * 1024;
const HOLDER = Symbol.for("parva.observability.serverSinks.v1");

type Env = Record<string, string | undefined>;
type QueueStats = ReturnType<BatchingSink["stats"]>;

export interface ServerLogSinks {
  config: ServerLogConfig;
  file?: { sink: RotatingFileSink; batching: BatchingSink; directory: string };
  remote?: { batching: BatchingSink; host: string; minLevel: Level };
  /** What the sinks are doing right now, for the admin health view. No paths beyond the folder name, no credentials. */
  stats(): { file?: { directory: string; retentionDays: number | null; files: RotatingFileStats; queue: QueueStats }; remote?: { host: string; minLevel: Level; queue: QueueStats } };
  /** Writes out what is queued. */
  flush(): Promise<void>;
  /**
   * For the 'exit' event, which cannot wait for anything asynchronous: writes what the file's queue still holds, right
   * now, and returns how many records that was. Best effort by nature (the collector cannot be reached synchronously,
   * so its queue is left; stdout, and Docker's own log, always had every record).
   */
  flushSync(): number;
  /** Takes the sinks out again (tests). */
  dispose(): void;
}

export interface ServerSinksOptions {
  core?: LoggerCore;
  env?: Env;
  store?: LogFileStore;
  fetch?: typeof fetch;
  /** The clock the file sink's rotation and retention follow (tests). */
  now?: () => number;
  /** Where problems with the sinks themselves are reported (default: console.warn, at most once a minute per kind). */
  onInternalProblem?: (message: string, detail?: unknown) => void;
}

function defaultInternalProblem(message: string, detail?: unknown): void {
  // console-ok: it is the log sink itself that failed, so this cannot go through the logger without going through that sink
  globalThis.console?.warn?.(`[parva-log] ${message}`, detail instanceof Error ? detail.message : detail);
}

export function startServerLogSinks(options: ServerSinksOptions = {}): ServerLogSinks {
  const holder = globalThis as unknown as Record<symbol, ServerLogSinks | undefined>;
  const existing = holder[HOLDER];
  if (existing) return existing; // a hot reload or a second bundle must not double the sinks

  const core = options.core ?? getRootCore();
  const config = resolveServerLogConfig(options.env ?? process.env);
  for (const warning of config.warnings) core.emit("WARN", "LOG_INTERNAL_ERROR", { message: warning }, { context: {} });

  const internal = options.onInternalProblem ?? defaultInternalProblem;
  const lastReported = new Map<string, number>();
  const reportOnce = (key: string, message: string, detail?: unknown) => {
    const at = Date.now();
    if (at - (lastReported.get(key) ?? 0) < 60_000) return;
    lastReported.set(key, at);
    internal(message, detail);
  };
  const watch = (label: string) => (event: BatchingEvent) => {
    if (event.type === "overflow") reportOnce(`${label}:overflow`, `${label}: the log queue was full and ${event.dropped} records were dropped (${event.droppedProtected} of them errors)`);
    else if (event.type === "sink_failed") reportOnce(`${label}:failed`, `${label}: could not be written; logging continues without it for now`, event.error);
    else if (event.type === "circuit_open") reportOnce(`${label}:circuit`, `${label}: paused after repeated failures; it is tried again after a back-off`);
    else if (event.type === "circuit_closed") reportOnce(`${label}:recovered`, `${label}: is working again`);
  };

  const added: string[] = [];
  const sinks: ServerLogSinks = {
    config,
    stats() {
      return {
        file: sinks.file
          ? { directory: sinks.file.directory, retentionDays: config.file?.retentionDays ?? null, files: sinks.file.sink.stats(), queue: sinks.file.batching.stats() }
          : undefined,
        remote: sinks.remote ? { host: sinks.remote.host, minLevel: sinks.remote.minLevel, queue: sinks.remote.batching.stats() } : undefined,
      };
    },
    async flush() {
      await core.flush();
    },
    flushSync() {
      try {
        return sinks.file ? sinks.file.sink.appendSync(sinks.file.batching.takeQueued()) : 0;
      } catch {
        return 0; // on the way out there is nothing left to tell
      }
    },
    dispose() {
      for (const name of added.splice(0)) core.removeSink(name);
      delete holder[HOLDER];
    },
  };

  if (config.file) {
    const retentionMs = config.file.retentionDays === null ? Number.POSITIVE_INFINITY : config.file.retentionDays * 24 * 60 * 60 * 1000;
    const sink = new RotatingFileSink({
      name: "server-file",
      now: options.now,
      store: options.store ?? createNodeLogFileStore(config.file.directory),
      maxFileBytes: 20 * MB,
      maxTotalBytes: config.file.maxTotalBytes,
      retentionMs,
      maxArchives: 1_000,
      maxLineBytes: 64 * 1024,
      onProblem: (problem) => reportOnce(`file:${problem.kind}`, `log file ${problem.kind} problem${problem.file ? ` (${problem.file})` : ""}`, problem.error),
    });
    const batching = new BatchingSink(sink, { capacity: 20_000, maxBatch: 500, flushIntervalMs: 1_000, urgentFlushMs: 250, failureThreshold: 3, onEvent: watch("log file") });
    core.addSink(batching);
    added.push(batching.name);
    sinks.file = { sink, batching, directory: config.file.directory };
  }

  if (config.remote) {
    const http = new HttpLogSink({ url: config.remote.url, token: config.remote.token, timeoutMs: config.remote.timeoutMs, fetch: options.fetch });
    const batching = new BatchingSink(http, {
      capacity: 5_000,
      maxBatch: 200,
      flushIntervalMs: 5_000,
      urgentFlushMs: 1_000,
      failureThreshold: 5,
      baseBackoffMs: 5_000,
      maxBackoffMs: 300_000,
      onEvent: watch("log collector"),
    });
    const filtered = new FilteredSink(batching, config.remote.minLevel);
    core.addSink(filtered);
    added.push(filtered.name);
    sinks.remote = { batching, host: new URL(config.remote.url).host, minLevel: config.remote.minLevel };
  }

  holder[HOLDER] = sinks;
  return sinks;
}

/** The running sinks, or undefined before startServerLogSinks (and in a process that never started them). */
export function getServerLogSinks(): ServerLogSinks | undefined {
  return (globalThis as unknown as Record<symbol, ServerLogSinks | undefined>)[HOLDER];
}
