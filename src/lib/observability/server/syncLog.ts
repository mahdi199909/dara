// What the server tells its log about a sync request — the counts an operator needs to answer "did my
// phone's data arrive?" without ever seeing the data: rows per table, how many were written, skipped
// or refused, and *why* refused, as categories. A refused row's own reason text quotes the value that
// failed ("amount: not a number (\"abc\")"), so it is reduced to its field name and kind of failure
// and never logged as written.
import type { Level } from "../core/levels";
import { getLogger } from "../root";

const log = getLogger("sync", "server");

export interface PushTableResult {
  upserted: number;
  skipped: number;
  rejected: number;
  rejectedRows?: Array<{ id: string; reason: string }>;
}

const KNOWN_REASONS = new Set(["missing id", "parent row not found for this account", "id belongs to a different account"]);
const FIELD_FAILURE = /^([A-Za-z0-9_]+): (required value is missing|not a boolean|not a valid date|not an integer|not a number|-?\d+ is larger than the server allows)/;
/** How many distinct (table, category) groups one record lists; the rest are counted, not named. */
const MAX_GROUPS = 20;

/**
 * The kind of refusal, with the value stripped: "title: required value is missing",
 * "amount: value is larger than the server allows", "missing parent row", "other". Field names are
 * schema identifiers, so they are safe to keep.
 */
export function categorizeRejection(reason: string): string {
  const text = String(reason ?? "").trim();
  if (KNOWN_REASONS.has(text)) return text;
  const field = FIELD_FAILURE.exec(text);
  if (field) return `${field[1]}: ${field[2].replace(/^-?\d+ is larger/, "value is larger")}`;
  if (text.startsWith("missing parent row")) return "missing parent row";
  if (text.startsWith("duplicate of an existing row")) return "duplicate of an existing row";
  return "other";
}

export interface PushSummary {
  totals: { upserted: number; skipped: number; rejected: number };
  /** Only tables that had rows in the request. */
  tables: Record<string, { upserted: number; skipped: number; rejected: number }>;
  /** "Table: category" → how many rows. */
  rejections: Record<string, number>;
}

export function summarizePush(results: Record<string, PushTableResult>): PushSummary {
  const summary: PushSummary = { totals: { upserted: 0, skipped: 0, rejected: 0 }, tables: {}, rejections: {} };
  for (const [table, result] of Object.entries(results)) {
    summary.totals.upserted += result.upserted;
    summary.totals.skipped += result.skipped;
    summary.totals.rejected += result.rejected;
    summary.tables[table] = { upserted: result.upserted, skipped: result.skipped, rejected: result.rejected };

    // The response lists at most a few dozen refused rows per table; the categories cover those, and
    // whatever was refused beyond them is counted under "unlisted".
    const listed = result.rejectedRows ?? [];
    for (const row of listed) {
      const key = `${table}: ${categorizeRejection(row.reason)}`;
      if (key in summary.rejections || Object.keys(summary.rejections).length < MAX_GROUPS) summary.rejections[key] = (summary.rejections[key] ?? 0) + 1;
    }
    const unlisted = result.rejected - listed.length;
    if (unlisted > 0) summary.rejections[`${table}: unlisted`] = unlisted;
  }
  return summary;
}

/**
 * One record per push: DEBUG when nothing changed (an idempotent re-send), INFO when rows were
 * written, WARN with the reasons when any were refused. Never throws.
 */
export function logSyncPush(results: Record<string, PushTableResult>, tombstones: { applied: number; ignored: number }, hasProfile: boolean): void {
  try {
    const summary = summarizePush(results);
    const refused = summary.totals.rejected > 0;
    const changed = summary.totals.upserted > 0 || tombstones.applied > 0 || hasProfile;
    const level: Level = refused ? "WARN" : changed ? "INFO" : "DEBUG";
    log.log(level, refused ? "SYNC_PARTIAL_SUCCESS" : "SYNC_PUSH_SUCCESS", {
      direction: "push",
      counts: summary.totals,
      tables: summary.tables,
      tombstones,
      profile: hasProfile,
      ...(refused ? { rejections: summary.rejections } : {}),
    });
  } catch {
    // a summary that cannot be built must not fail the push it describes
  }
}

/** One record per pull: INFO when rows or deletions went out, DEBUG when the device was already up to date. */
export function logSyncPull(tables: Record<string, unknown[]>, tombstoneCount: number, incremental: boolean): void {
  try {
    const counts: Record<string, number> = {};
    let rows = 0;
    for (const [table, list] of Object.entries(tables)) {
      if (Array.isArray(list) && list.length > 0) {
        counts[table] = list.length;
        rows += list.length;
      }
    }
    log.log(rows > 0 || tombstoneCount > 0 ? "INFO" : "DEBUG", "SYNC_PULL_SUCCESS", { direction: "pull", rows, tables: counts, tombstones: tombstoneCount, incremental });
  } catch {
    // ignore
  }
}
