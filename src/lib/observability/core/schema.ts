// The shape of one application log record and of the context that is filled in automatically.
// Field names in the emitted JSON are snake_case (they are what a log store indexes on); the code
// side of the API (LogFields / LogContext) is camelCase like the rest of the codebase.
import type { ErrorCode } from "./errorCodes";
import type { Level } from "./levels";

export type Platform = "web" | "android" | "server";
export type Environment = "development" | "staging" | "production";
/** Where the operation happened: on the device's own database, or against the server. */
export type Layer = "local" | "server";
/** Derived, not stored per row: a local write is PENDING until a later sync pushes it. */
export type SyncStatus = "PENDING" | "SYNCED" | "REJECTED" | "UNKNOWN";

export interface SerializedError {
  type: string;
  message: string;
  code?: string | number;
  status?: number;
  stack?: string;
  cause?: SerializedError;
  /** AggregateError members (capped). */
  errors?: SerializedError[];
}

/**
 * One log line. Optional fields are omitted when unknown, so "absent" means null. `metadata` is
 * always present and holds everything the caller passed that has no dedicated field — after
 * redaction and truncation (see redact.ts), never raw.
 */
export interface LogRecord {
  timestamp: string; // ISO-8601, always UTC
  level: Level;
  event: string;
  message: string;

  service: string;
  module?: string;
  component?: string;

  environment: Environment;
  app_version?: string;
  build_number?: string;
  git_commit?: string;

  user_id?: string | null;
  session_id?: string;
  request_id?: string;
  trace_id?: string;
  span_id?: string;

  platform: Platform;
  device_id?: string;
  os_version?: string;
  /** The person's IANA time zone, for debugging "today"/reminder/habit-day questions. */
  tz?: string;

  entity_type?: string;
  entity_id?: string;
  operation?: string;
  layer?: Layer;
  sync_id?: string;
  local_event_id?: string;
  sync_status?: SyncStatus;

  duration_ms?: number;
  error_code?: ErrorCode | string | null;
  error?: SerializedError;

  metadata: Record<string, unknown>;
}

/** What context providers (request scope on the server, launch/device scope on a phone) can supply. */
export interface LogContext {
  userId?: string | null;
  sessionId?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  deviceId?: string;
  osVersion?: string;
  tz?: string;
  platform?: Platform;
  layer?: Layer;
  syncId?: string;
  localEventId?: string;
}

/**
 * The second argument of logger.info(EVENT, fields). The named keys have a dedicated place in the
 * record; every other key becomes `metadata` — so `logger.info("TASK_CREATE_SUCCESS", { taskId })`
 * just works, and nothing needs to be spelled out per call.
 */
export interface LogFields extends LogContext {
  /** Human-readable English. Optional: the event registry supplies a default. */
  message?: string;
  /** Any thrown value; becomes a structured `error` block (stack only when the level and config allow). */
  error?: unknown;
  errorCode?: ErrorCode;
  entityType?: string;
  entityId?: string;
  operation?: string;
  syncStatus?: SyncStatus;
  durationMs?: number;
  module?: string;
  component?: string;
  [key: string]: unknown;
}
