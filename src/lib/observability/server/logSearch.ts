// The support timeline: given a person, a request, a sync or an entity, the records that tell what happened — read from
// the rotated log files (LOG_FILE_DIR) and cut down to what a developer needs, with nothing sensitive in it.
//
// The records were redacted when they were written (see doc/logging/security.md); they are passed through the same
// redaction once more on the way out, so a record written before a rule was tightened is still safe to show. A stack
// trace is left out unless asked for.
import { LEVEL_VALUE, parseLevel, type Level } from "../core/levels";
import { redactRecord } from "../core/redact";
import type { LogRecord, SerializedError } from "../core/schema";

export interface LogFilters {
  /** The person: their records, plus the sign-in failures that carry only a pseudonym of their address. */
  userId?: string;
  emailHash?: string;
  requestId?: string;
  traceId?: string;
  syncId?: string;
  entityId?: string;
  /** This level and above. */
  minLevel?: Level;
  /** One or more event names, comma separated; a trailing * matches a prefix (SYNC_*). */
  event?: string;
  module?: string;
  platform?: string;
  version?: string;
  errorCode?: string;
  sinceMs?: number;
  untilMs?: number;
}

const same = (actual: string | undefined | null, wanted: string | undefined): boolean => wanted === undefined || (actual ?? "").toLowerCase() === wanted.toLowerCase();

function eventMatcher(spec: string | undefined): ((event: string) => boolean) | null {
  const wanted = (spec ?? "")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  if (wanted.length === 0) return null;
  return (event) => {
    const name = event.toUpperCase();
    return wanted.some((pattern) => (pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern));
  };
}

/** True when the record passes every filter that was given. */
export function buildLogMatcher(filters: LogFilters): (record: LogRecord) => boolean {
  const event = eventMatcher(filters.event);
  const min = filters.minLevel ? LEVEL_VALUE[filters.minLevel] : 0;
  return (record) => {
    if (min && LEVEL_VALUE[record.level] < min) return false;
    if (filters.userId !== undefined || filters.emailHash !== undefined) {
      const byUser = filters.userId !== undefined && record.user_id === filters.userId;
      const byAddress = filters.emailHash !== undefined && (record.metadata as { emailHash?: unknown } | undefined)?.emailHash === filters.emailHash;
      if (!byUser && !byAddress) return false;
    }
    if (filters.requestId !== undefined && record.request_id !== filters.requestId) return false;
    if (filters.traceId !== undefined && record.trace_id !== filters.traceId) return false;
    if (filters.syncId !== undefined && record.sync_id !== filters.syncId) return false;
    if (filters.entityId !== undefined && record.entity_id !== filters.entityId) return false;
    if (event && !event(record.event)) return false;
    if (!same(record.module, filters.module)) return false;
    if (!same(record.platform, filters.platform)) return false;
    if (!same(record.app_version, filters.version)) return false;
    if (!same(record.error_code === null ? undefined : record.error_code, filters.errorCode)) return false;
    if (filters.sinceMs !== undefined || filters.untilMs !== undefined) {
      const at = Date.parse(record.timestamp);
      if (filters.sinceMs !== undefined && at < filters.sinceMs) return false;
      if (filters.untilMs !== undefined && at > filters.untilMs) return false;
    }
    return true;
  };
}

/** "2026-09-21T10:00:00Z", or "15m" / "2h" / "3d" meaning that long before `now`. Anything else is undefined. */
export function parseTimeInput(text: string | null | undefined, now: number): number | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  const relative = /^(\d{1,4})([mhd])$/i.exec(value);
  if (relative) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2].toLowerCase() as "m" | "h" | "d"];
    return now - Number(relative[1]) * unit;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The level a filter value names, or undefined. */
export function levelFilter(text: string | null | undefined): Level | undefined {
  return parseLevel(text) ?? undefined;
}

export interface TimelineEntry {
  timestamp: string;
  level: Level;
  event: string;
  message: string;
  module?: string;
  platform?: string;
  layer?: string;
  requestId?: string;
  traceId?: string;
  syncId?: string;
  userId?: string | null;
  deviceId?: string;
  appVersion?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  errorCode?: string | null;
  entityType?: string;
  entityId?: string;
  error?: Pick<SerializedError, "type" | "message" | "code" | "status"> & { stack?: string };
  metadata: Record<string, unknown>;
}

/** One record as the timeline shows it: the identifying fields, the redacted metadata, and the error without its stack unless asked. */
export function toTimelineEntry(record: LogRecord, options: { stack?: boolean } = {}): TimelineEntry {
  const entry: TimelineEntry = {
    timestamp: record.timestamp,
    level: record.level,
    event: record.event,
    message: record.message,
    module: record.module,
    platform: record.platform,
    layer: record.layer,
    requestId: record.request_id,
    traceId: record.trace_id,
    syncId: record.sync_id,
    userId: record.user_id,
    deviceId: record.device_id,
    appVersion: record.app_version,
    method: record.method,
    path: record.path,
    statusCode: record.status_code,
    durationMs: record.duration_ms,
    errorCode: record.error_code,
    entityType: record.entity_type,
    entityId: record.entity_id,
    metadata: redactRecord(record.metadata ?? {}),
  };
  if (record.error) {
    const { type, message, code, status, stack } = record.error;
    entry.error = { type, message, ...(code !== undefined ? { code } : {}), ...(status !== undefined ? { status } : {}), ...(options.stack && stack ? { stack } : {}) };
  }
  for (const key of Object.keys(entry) as Array<keyof TimelineEntry>) if (entry[key] === undefined) delete entry[key];
  return entry;
}
