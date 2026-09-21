// Thresholds the server-side instrumentation reads from the environment. Read on every use (a
// process.env lookup is cheap) so a test, or an operator restarting with a new value, needs no
// module reload.
//
// The names are the ones the logging specification gives (SLOW_API_THRESHOLD_MS …); the older LOG_SLOW_REQUEST_MS and
// LOG_SLOW_QUERY_MS keep working, and the specification's name wins when both are set.
function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface ServerSettings {
  /** A request slower than this also writes API_SLOW_REQUEST (SLOW_API_THRESHOLD_MS, or LOG_SLOW_REQUEST_MS; default 1000). */
  slowRequestMs: number;
  /** A database operation slower than this writes DB_SLOW_QUERY (SLOW_DB_THRESHOLD_MS, or LOG_SLOW_QUERY_MS; default 300). */
  slowQueryMs: number;
  /** A sync request slower than this writes SYNC_SLOW instead (SLOW_SYNC_THRESHOLD_MS, default 3000: a push can carry a whole backup). */
  slowSyncMs: number;
  /** A report slower than this also writes REPORT_SLOW (SLOW_REPORT_THRESHOLD_MS, default 2000). */
  slowReportMs: number;
}

export function serverSettings(): ServerSettings {
  return {
    slowRequestMs: numberEnv("SLOW_API_THRESHOLD_MS", numberEnv("LOG_SLOW_REQUEST_MS", 1000)),
    slowQueryMs: numberEnv("SLOW_DB_THRESHOLD_MS", numberEnv("LOG_SLOW_QUERY_MS", 300)),
    slowSyncMs: numberEnv("SLOW_SYNC_THRESHOLD_MS", 3000),
    slowReportMs: numberEnv("SLOW_REPORT_THRESHOLD_MS", 2000),
  };
}
