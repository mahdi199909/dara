// Parva's logging subsystem. Application code imports from here and only needs:
//
//   import { getLogger } from "@/lib/observability";
//   const log = getLogger("sync", "runner");
//   log.error("SYNC_FAILED", { errorCode: "SYNC-002", error });
//
// See doc/logging/architecture.md for the design, events.md / error-codes.md for the catalogue.
export { getLogger, addContextProvider, getRootCore } from "./root";
export { resolveLoggingConfig, detectRuntime } from "./config";
export type { LoggingConfig, RuntimeInfo, LogEnv } from "./config";

export { Logger, LoggerCore, createLogger, createLoggerCore } from "./core/logger";
export type { LoggerOptions, ChildBindings, ContextProvider, LogTimer } from "./core/logger";

export { LEVELS, LEVEL_VALUE, parseLevel, parseLevelSpec, isLevelEnabled } from "./core/levels";
export type { Level, LevelSpec } from "./core/levels";
export { LevelController } from "./core/levelControl";

export { DOMAINS, MODULE_OF_DOMAIN, OPERATIONS, OPERATION_RESULTS, EVENTS, EVENT_NAMES, eventMeta, isEventName, domainOf, humanizeEvent, validateEventName } from "./core/events";
export type { Domain, EventName, EventMeta, OperationBase, OperationEvent } from "./core/events";

export { ERROR_CODES, isErrorCode, errorCodeMeta, classifyError, codeForHttpStatus, syncErrorCode } from "./core/errorCodes";
export type { ErrorCode, ErrorCodeMeta, SyncErrorKind } from "./core/errorCodes";

export { newId, isId, ulid, newTraceId, newSpanId } from "./core/ids";
export type { IdPrefix } from "./core/ids";
export { parseTraceparent, formatTraceparent, newTraceContext, startSpan } from "./core/trace";
export type { TraceContext, Span } from "./core/trace";

export { redactValue, redactRecord, serializeError, scrubString, maskEmail, classifyKey, REDACTED, REDACTED_MONEY, REDACTED_CONTENT } from "./core/redact";
export type { RedactOptions, ErrorSerializeOptions, KeyClass } from "./core/redact";

export { shouldKeep, hashToUnit, DEFAULT_SAMPLING } from "./core/sampling";
export type { SamplingConfig } from "./core/sampling";

export { ConsoleSink, MemorySink, NullSink, BatchingSink } from "./core/sink";
export type { LogSink, ConsoleFormat, ConsoleLike, BatchingOptions, BatchingEvent } from "./core/sink";

export { MetricsRegistry, Counter, Histogram, metrics, DURATION_BUCKETS_MS } from "./core/metrics";
export { computeChanges, valuesEqual } from "./core/diff";
export type { Changes, FieldChange, FieldPolicy, MoneyMode } from "./core/diff";

export type { LogRecord, LogContext, LogFields, Platform, Environment, Layer, SyncStatus, SerializedError } from "./core/schema";
