// Where the server's application log is kept besides stdout, read from the environment. Pure (the environment is passed
// in), so it is testable; a bad value is reported as a warning and replaced by the default — never fatal, and never a
// reason for logging to stop.
//
//   LOG_FILE_DIR            a folder for rotated log files (unset: no file; docker-compose mounts a volume at /app/logs)
//   LOG_RETENTION_DAYS      how long they are kept; default 14 (7, 14, 30 and 90 are the usual choices);
//                           0 / off / never / forever keeps them until the size ceiling
//   LOG_FILE_MAX_MB         the most all log files may occupy together; default 300
//
//   LOG_REMOTE_URL          a collector that accepts newline-delimited JSON over HTTP POST (Vector, Fluent Bit, Logstash,
//                           OpenObserve, …); unset: nothing is sent anywhere
//   LOG_REMOTE_TOKEN        sent as "Authorization: Bearer <token>"
//   LOG_REMOTE_MIN_LEVEL    the lowest level sent there; default WARN (stdout and the files keep everything)
//   LOG_REMOTE_TIMEOUT_MS   how long one delivery may take; default 5000
import { parseLevel, type Level } from "../core/levels";

export const DEFAULT_LOG_RETENTION_DAYS = 14;
export const DEFAULT_LOG_FILE_MAX_MB = 300;
const MIN_LOG_FILE_MAX_MB = 20;
const DEFAULT_REMOTE_TIMEOUT_MS = 5_000;

export interface ServerLogConfig {
  file: null | {
    directory: string;
    /** null: keep until the size ceiling. */
    retentionDays: number | null;
    maxTotalBytes: number;
  };
  remote: null | {
    url: string;
    token?: string;
    minLevel: Level;
    timeoutMs: number;
  };
  /** Things in the environment that were ignored or replaced (reported once at startup). */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Days, or null for "keep until the size ceiling"; anything unusable becomes the default (with a warning). */
export function parseRetentionDays(raw: string | undefined, warnings: string[] = []): number | null {
  const text = raw?.trim().toLowerCase();
  if (!text) return DEFAULT_LOG_RETENTION_DAYS;
  if (text === "0" || text === "off" || text === "never" || text === "forever") return null;
  const days = Number(text);
  if (Number.isFinite(days) && days >= 1) return Math.floor(days);
  warnings.push(`LOG_RETENTION_DAYS="${raw}" is not a number of days; using ${DEFAULT_LOG_RETENTION_DAYS}`);
  return DEFAULT_LOG_RETENTION_DAYS;
}

export function resolveServerLogConfig(env: Env = process.env): ServerLogConfig {
  const warnings: string[] = [];

  let file: ServerLogConfig["file"] = null;
  const directory = env.LOG_FILE_DIR?.trim();
  if (directory) {
    const rawMb = env.LOG_FILE_MAX_MB?.trim();
    let maxMb = DEFAULT_LOG_FILE_MAX_MB;
    if (rawMb) {
      const parsed = Number(rawMb);
      if (Number.isFinite(parsed) && parsed >= MIN_LOG_FILE_MAX_MB) maxMb = Math.floor(parsed);
      else warnings.push(`LOG_FILE_MAX_MB="${rawMb}" is below ${MIN_LOG_FILE_MAX_MB} or not a number; using ${DEFAULT_LOG_FILE_MAX_MB}`);
    }
    file = { directory, retentionDays: parseRetentionDays(env.LOG_RETENTION_DAYS, warnings), maxTotalBytes: maxMb * 1024 * 1024 };
  }

  let remote: ServerLogConfig["remote"] = null;
  const rawUrl = env.LOG_REMOTE_URL?.trim();
  if (rawUrl) {
    let url: URL | null = null;
    try {
      url = new URL(rawUrl);
    } catch {
      // handled below
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      warnings.push("LOG_REMOTE_URL is not an http(s) address; nothing will be sent");
    } else {
      if (url.protocol === "http:" && !isLocalHost(url.hostname)) warnings.push("LOG_REMOTE_URL is not https: log records (which hold no personal data) will travel unencrypted");
      const requested = env.LOG_REMOTE_MIN_LEVEL?.trim();
      const minLevel = requested ? parseLevel(requested) : null;
      if (requested && !minLevel) warnings.push(`LOG_REMOTE_MIN_LEVEL="${requested}" is not a log level; using WARN`);
      const rawTimeout = env.LOG_REMOTE_TIMEOUT_MS?.trim();
      let timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS;
      if (rawTimeout) {
        const parsed = Number(rawTimeout);
        if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 60_000) timeoutMs = Math.floor(parsed);
        else warnings.push(`LOG_REMOTE_TIMEOUT_MS="${rawTimeout}" is outside 500–60000; using ${DEFAULT_REMOTE_TIMEOUT_MS}`);
      }
      remote = { url: url.toString(), token: env.LOG_REMOTE_TOKEN?.trim() || undefined, minLevel: minLevel ?? "WARN", timeoutMs };
    }
  }

  return { file, remote, warnings };
}
