// Thresholds the server-side instrumentation reads from the environment. Read on every use (a
// process.env lookup is cheap) so a test, or an operator restarting with a new value, needs no
// module reload.
function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface ServerSettings {
  /** A request slower than this also writes API_SLOW_REQUEST (LOG_SLOW_REQUEST_MS, default 1000). */
  slowRequestMs: number;
  /** A database operation slower than this writes DB_SLOW_QUERY (LOG_SLOW_QUERY_MS, default 300). */
  slowQueryMs: number;
}

export function serverSettings(): ServerSettings {
  return {
    slowRequestMs: numberEnv("LOG_SLOW_REQUEST_MS", 1000),
    slowQueryMs: numberEnv("LOG_SLOW_QUERY_MS", 300),
  };
}
