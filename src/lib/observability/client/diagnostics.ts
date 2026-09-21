// The diagnostic report: a file a person can send to whoever is helping them (Settings → گزارش تشخیصی). It holds what
// the phone wrote down about itself — recent log records, the app's counters, the state of the log and of the last
// sync — and nothing that was ever typed into the app: no titles, notes, amounts, e-mail addresses or tokens (they are
// never written to the log; the records are cleaned once more here anyway, as a second line of defence).
//
// It is made only when the person asks for it, and only leaves the phone through the share sheet, where the person
// chooses where it goes. Nothing about it is uploaded automatically.
import type { MetricsSnapshot } from "../core/metrics";
import { redactRecord, scrubString } from "../core/redact";
import type { LogRecord } from "../core/schema";
import { utf8Bytes } from "./bytes";
import type { DeviceLogStats } from "./fileSink";

export const DIAGNOSTIC_FORMAT = "parva-diagnostics";
export const DIAGNOSTIC_VERSION = 1;
/** The report stays small enough to send over any messenger. */
export const DIAGNOSTIC_MAX_BYTES = 1_500_000;

export interface DiagnosticInput {
  now?: Date;
  app: { version?: string; build?: string; environment?: string; platform?: string };
  device: { deviceId?: string; osVersion?: string; tz?: string; sessionId?: string; userId?: string | null };
  logging: { level?: string; file?: DeviceLogStats; queue?: Record<string, unknown> };
  /** The last sync's outcome, as counts and a kind — never rows. */
  sync?: { ok?: boolean; syncId?: string; finishedAt?: string; kind?: string; status?: number; pushedCount?: number; pulledCount?: number; rejectedCount?: number; durationMs?: number };
  metrics?: MetricsSnapshot;
  records: LogRecord[];
  maxBytes?: number;
}

export interface DiagnosticReport {
  fileName: string;
  json: string;
  bytes: number;
  recordCount: number;
  /** Older records left out to keep the file within its size limit. */
  omittedForSize: number;
}

/** A record with everything a person could have typed removed or masked, whatever the logger let through. */
export function cleanRecord(record: LogRecord): LogRecord {
  const cleaned: LogRecord = { ...record, message: scrubString(String(record.message ?? "")), metadata: redactRecord(record.metadata ?? {}) };
  if (record.error) {
    cleaned.error = { ...record.error, message: scrubString(String(record.error.message ?? "")) };
    if (record.error.stack) cleaned.error.stack = scrubString(record.error.stack);
  }
  return cleaned;
}

function fileNameFor(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `parva-diagnostics-${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}.json`;
}

function counts(records: LogRecord[]): { byLevel: Record<string, number>; byEvent: Record<string, number> } {
  const byLevel: Record<string, number> = {};
  const byEvent: Record<string, number> = {};
  for (const record of records) {
    byLevel[record.level] = (byLevel[record.level] ?? 0) + 1;
    if (record.level === "WARN" || record.level === "ERROR" || record.level === "CRITICAL") byEvent[record.event] = (byEvent[record.event] ?? 0) + 1;
  }
  return { byLevel, byEvent };
}

export function buildDiagnosticReport(input: DiagnosticInput): DiagnosticReport {
  const now = input.now ?? new Date();
  const maxBytes = input.maxBytes ?? DIAGNOSTIC_MAX_BYTES;

  const cleaned = input.records.map(cleanRecord);
  const lines = cleaned.map((record) => JSON.stringify(record));

  const summaryOf = (records: LogRecord[]) => ({
    format: DIAGNOSTIC_FORMAT,
    version: DIAGNOSTIC_VERSION,
    createdAt: now.toISOString(),
    // What this file is, in plain words, for whoever opens it.
    note: "A technical report made by the app at the person's request. It contains events, counts and ids — no titles, notes, amounts, e-mail addresses or passwords.",
    app: input.app,
    device: input.device,
    logging: input.logging,
    sync: input.sync ?? null,
    counts: { records: records.length, ...counts(records) },
    metrics: input.metrics ?? null,
  });

  // The header first, so the room left for records is known; then the newest records that fit, listed oldest first as a log reads.
  let keptFrom = cleaned.length;
  let used = utf8Bytes(JSON.stringify(summaryOf(cleaned), null, 1)).length + 32;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const size = utf8Bytes(lines[i]).length + 2;
    if (used + size > maxBytes) break;
    used += size;
    keptFrom = i;
  }
  const kept = cleaned.slice(keptFrom);

  // One record per line inside the JSON, so the file reads like the log it is.
  const head = JSON.stringify(summaryOf(kept), null, 1);
  const json = `${head.slice(0, head.lastIndexOf("}")).trimEnd()},\n "records": [\n${lines.slice(keptFrom).join(",\n")}\n ]\n}\n`;
  return { fileName: fileNameFor(now), json, bytes: utf8Bytes(json).length, recordCount: kept.length, omittedForSize: keptFrom };
}
