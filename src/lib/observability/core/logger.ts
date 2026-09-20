// The logger itself. Call sites stay this small:
//
//   log.info("TASK_CREATE_SUCCESS", { taskId });
//   log.warn("SYNC_RETRY", { syncId, attempt });
//   log.error("SYNC_FAILED", { syncId, errorCode: "SYNC-002", error });
//
// and everything else is the logger's job: level filtering (global, per domain/module/component,
// per user), context injection (user, session, request, trace, device, platform, version …),
// redaction and size limits, sampling that never touches errors or security events, delivery to
// the sinks — and never throwing. Whatever goes wrong inside logging is contained here.
import { LevelController } from "./levelControl";
import { LEVEL_VALUE, type Level } from "./levels";
import { classifyError, type ErrorCode } from "./errorCodes";
import { domainOf, eventMeta, humanizeEvent, moduleOfDomain, type EventName, type OperationBase } from "./events";
import { metrics as defaultMetrics, type Counter, type MetricsRegistry } from "./metrics";
import { redactRecord, scrubString, serializeError, type RedactOptions } from "./redact";
import { DEFAULT_SAMPLING, shouldKeep, type SamplingConfig } from "./sampling";
import type { Environment, LogContext, LogFields, LogRecord, Platform } from "./schema";
import type { LogSink } from "./sink";

export type ContextProvider = () => LogContext | undefined;

export interface ChildBindings extends LogContext {
  module?: string;
  component?: string;
  /** Fields attached to every record this child writes. */
  metadata?: Record<string, unknown>;
}

interface Bound {
  module?: string;
  component?: string;
  context: LogContext;
  metadata?: Record<string, unknown>;
}

export interface LoggerOptions {
  service: string;
  environment: Environment;
  platform: Platform;
  appVersion?: string;
  buildNumber?: string;
  gitCommit?: string;
  /** The threshold everything uses unless an override says otherwise. Default INFO. */
  level?: Level;
  /** DOMAIN / module / component → level, e.g. { SYNC: "DEBUG", FINANCE: "INFO" }. */
  overrides?: Record<string, Level>;
  sinks: LogSink[];
  /** Fixed context for the whole runtime (a phone's session id, a server's instance id). */
  staticContext?: LogContext;
  /** Called for every record: request scope on the server, launch scope on a phone. */
  contextProviders?: ContextProvider[];
  sampling?: Partial<SamplingConfig>;
  redact?: RedactOptions;
  /** Keep stack traces on ERROR and above. Default true (never shown to a person; see docs/security). */
  includeStack?: boolean;
  /** A record whose metadata would exceed this many bytes is replaced by a short summary. Default 8192. */
  maxMetadataBytes?: number;
  now?: () => Date;
  random?: () => number;
  /** Monotonic milliseconds for durations. Default performance.now(). */
  clock?: () => number;
  metrics?: MetricsRegistry;
  /** Where problems INSIDE logging are reported (rate-limited). Default: console.error. */
  reportInternal?: (message: string, error?: unknown) => void;
}

const CONTEXT_KEYS = ["userId", "sessionId", "requestId", "traceId", "spanId", "deviceId", "osVersion", "tz", "platform", "layer", "syncId", "localEventId"] as const;
const RESERVED_KEYS = new Set<string>([...CONTEXT_KEYS, "message", "error", "errorCode", "entityType", "entityId", "operation", "syncStatus", "durationMs", "httpMethod", "httpPath", "statusCode", "responseSize", "module", "component", "metadata"]);
const LEVEL_ORDER: readonly Level[] = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"];
const MAX_MESSAGE_CHARS = 500;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultClock(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** The state behind one or many Logger handles: sinks, levels, context providers, metrics. */
export class LoggerCore {
  readonly levels: LevelController;
  private readonly sinks: LogSink[];
  private readonly providers: ContextProvider[];
  private staticContext: LogContext;
  private readonly sampling: SamplingConfig;
  private readonly samplingActive: boolean;
  private readonly redact: RedactOptions;
  private readonly includeStack: boolean;
  private readonly maxMetadataBytes: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly clock: () => number;
  private readonly reportInternalFn: (message: string, error?: unknown) => void;
  private readonly emittedByLevel: Record<Level, { inc(by?: number): void }>;
  private readonly sampledOut: Counter;
  private readonly sinkErrors: Counter;
  private readonly internalErrors: Counter;
  private readonly lastReport = new Map<string, number>();
  private inInternalError = false;

  constructor(private readonly options: LoggerOptions) {
    this.levels = new LevelController(options.level ?? "INFO", options.overrides);
    this.sinks = [...options.sinks];
    this.providers = [...(options.contextProviders ?? [])];
    this.staticContext = { ...options.staticContext };
    this.sampling = { ...DEFAULT_SAMPLING, ...options.sampling };
    this.samplingActive = this.sampling.debug < 1 || this.sampling.trace < 1 || this.sampling.highVolumeInfo < 1;
    this.redact = options.redact ?? {};
    this.includeStack = options.includeStack ?? true;
    this.maxMetadataBytes = options.maxMetadataBytes ?? 8192;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? defaultClock;
    this.reportInternalFn = options.reportInternal ?? ((message, error) => (globalThis.console as Console).error(message, error)); // console-ok: last-resort channel for failures inside logging itself

    const registry = options.metrics ?? defaultMetrics;
    const emitted = registry.counter("logs_emitted_total", "Log records handed to the sinks, by level.");
    this.emittedByLevel = Object.fromEntries(LEVEL_ORDER.map((level) => [level, emitted.bind({ level })])) as LoggerCore["emittedByLevel"];
    this.sampledOut = registry.counter("logs_sampled_out_total", "Log records dropped by sampling.");
    this.sinkErrors = registry.counter("log_sink_errors_total", "Failed writes to a log sink, by sink.");
    this.internalErrors = registry.counter("log_internal_errors_total", "Log records that could not be built.");
  }

  now_(): number {
    return this.clock();
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  removeSink(name: string): void {
    const index = this.sinks.findIndex((sink) => sink.name === name);
    if (index !== -1) this.sinks.splice(index, 1);
  }

  sinkNames(): string[] {
    return this.sinks.map((sink) => sink.name);
  }

  addContextProvider(provider: ContextProvider): void {
    if (!this.providers.includes(provider)) this.providers.push(provider);
  }

  /** Merges into the fixed context (e.g. a phone learns its device id after startup). */
  setStaticContext(context: LogContext): void {
    this.staticContext = { ...this.staticContext, ...context };
  }

  /** The context a record written right now would carry (static + providers) — how an error response learns its request id. */
  currentContext(): LogContext {
    return this.buildContext({ context: {} }, undefined);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((sink) => sink.flush?.()));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.sinks.map((sink) => (sink.close ? sink.close() : sink.flush?.())));
  }

  /** Same decision emit() makes, without building anything — for guarding expensive log arguments. */
  wouldEmit(level: Level, event: string | undefined, bound: Bound): boolean {
    if (LEVEL_VALUE[level] < this.levels.minValue) return false;
    const domain = event ? domainOf(event) : undefined;
    const context = this.buildContext(bound, undefined);
    const effective = this.levels.effectiveLevel({
      component: bound.component,
      module: bound.module ?? moduleOfDomain(domain),
      domain,
      userId: context.userId,
    });
    return LEVEL_VALUE[level] >= LEVEL_VALUE[effective];
  }

  emit(level: Level, event: string, rawFields: LogFields | undefined, bound: Bound): void {
    try {
      const value = LEVEL_VALUE[level];
      if (value < this.levels.minValue) return; // fast path: nothing anywhere would accept this

      const fields: LogFields | undefined = rawFields !== undefined && (typeof rawFields !== "object" || rawFields === null) ? { message: String(rawFields) } : rawFields;

      const meta = eventMeta(event);
      const domain = meta?.domain ?? domainOf(event);
      const moduleName = fields?.module ?? bound.module ?? moduleOfDomain(domain);
      const component = fields?.component ?? bound.component;
      const context = this.buildContext(bound, fields);

      const effective = this.levels.effectiveLevel({ component, module: moduleName, domain, userId: context.userId });
      if (value < LEVEL_VALUE[effective]) return;

      // Sampling is off unless a rate below 1 was configured — the common case pays nothing for it.
      if (this.samplingActive) {
        const isProtected = value >= LEVEL_VALUE.ERROR || meta?.protected === true;
        const kept = shouldKeep(
          { level, protected: isProtected, highVolume: meta?.highVolume === true, correlationKey: context.requestId ?? context.traceId ?? context.syncId },
          this.sampling,
          this.random
        );
        if (!kept) {
          this.sampledOut.inc();
          return;
        }
      }

      const record = this.buildRecord(level, event, meta?.description, fields, bound, context, moduleName, component);
      this.emittedByLevel[level].inc();
      this.dispatch(record);
    } catch (err) {
      this.internalError(err, level, event);
    }
  }

  // ------------------------------------------------------------------------------------------

  private buildContext(bound: Bound, fields: LogFields | undefined): LogContext {
    const context: LogContext = { ...this.staticContext };
    for (const provider of this.providers) {
      try {
        assignDefined(context, provider());
      } catch (err) {
        this.reportOnce("context-provider", "a log context provider threw; its context is skipped", err);
      }
    }
    assignDefined(context, bound.context);
    if (fields) for (const key of CONTEXT_KEYS) if (fields[key] !== undefined) (context as Record<string, unknown>)[key] = fields[key];
    return context;
  }

  private buildRecord(
    level: Level,
    event: string,
    defaultMessage: string | undefined,
    fields: LogFields | undefined,
    bound: Bound,
    context: LogContext,
    moduleName: string | undefined,
    component: string | undefined
  ): LogRecord {
    const value = LEVEL_VALUE[level];
    // The registry's descriptions are fixed text and need no scrubbing; only a caller's own message does.
    const custom = fields?.message;
    const message = truncateMessage(custom !== undefined && custom !== null ? scrubString(String(custom)) : defaultMessage ?? humanizeEvent(event));

    let errorBlock: LogRecord["error"];
    let errorCode: ErrorCode | string | undefined = fields?.errorCode;
    if (fields?.error !== undefined && fields.error !== null) {
      errorBlock = serializeError(fields.error, { includeStack: this.includeStack && value >= LEVEL_VALUE.ERROR });
      errorCode ??= classifyError(fields.error) ?? undefined;
    }

    // `metadata` is added last so it is the last key of the JSON line, where a reader expects it.
    const record = {
      timestamp: this.now().toISOString(),
      level,
      event,
      message,
      service: this.options.service,
      environment: this.options.environment,
      platform: context.platform ?? this.options.platform,
    } as LogRecord;
    if (moduleName) record.module = moduleName;
    if (component) record.component = component;
    if (this.options.appVersion) record.app_version = this.options.appVersion;
    if (this.options.buildNumber) record.build_number = this.options.buildNumber;
    if (this.options.gitCommit) record.git_commit = this.options.gitCommit;

    if (context.userId !== undefined) record.user_id = context.userId;
    if (context.sessionId) record.session_id = context.sessionId;
    if (context.requestId) record.request_id = context.requestId;
    if (context.traceId) record.trace_id = context.traceId;
    if (context.spanId) record.span_id = context.spanId;
    if (context.deviceId) record.device_id = context.deviceId;
    if (context.osVersion) record.os_version = context.osVersion;
    if (context.tz) record.tz = context.tz;
    if (context.layer) record.layer = context.layer;
    if (context.syncId) record.sync_id = context.syncId;
    if (context.localEventId) record.local_event_id = context.localEventId;

    if (fields?.entityType) record.entity_type = String(fields.entityType);
    if (fields?.entityId !== undefined && fields.entityId !== null) record.entity_id = String(fields.entityId);
    if (fields?.operation) record.operation = String(fields.operation);
    if (fields?.syncStatus) record.sync_status = fields.syncStatus;
    if (fields?.httpMethod) record.method = String(fields.httpMethod);
    if (fields?.httpPath) record.path = truncateMessage(scrubString(String(fields.httpPath)));
    if (typeof fields?.statusCode === "number" && Number.isFinite(fields.statusCode)) record.status_code = fields.statusCode;
    if (typeof fields?.responseSize === "number" && Number.isFinite(fields.responseSize)) record.response_size = fields.responseSize;
    if (typeof fields?.durationMs === "number" && Number.isFinite(fields.durationMs)) record.duration_ms = round2(fields.durationMs);
    if (errorCode) record.error_code = errorCode;
    if (errorBlock) record.error = errorBlock;

    record.metadata = this.buildMetadata(fields, bound);
    return record;
  }

  private buildMetadata(fields: LogFields | undefined, bound: Bound): Record<string, unknown> {
    const raw: Record<string, unknown> = { ...bound.metadata };
    if (fields) {
      const explicit = fields.metadata;
      if (explicit && typeof explicit === "object") Object.assign(raw, explicit);
      for (const key of Object.keys(fields)) if (!RESERVED_KEYS.has(key)) raw[key] = fields[key];
    }
    const keys = Object.keys(raw);
    if (keys.length === 0) return {};

    const metadata = redactRecord(raw, this.redact);
    let bytes = 0;
    try {
      bytes = JSON.stringify(metadata).length;
    } catch {
      return { _truncated: true, _reason: "unserializable" };
    }
    if (bytes > this.maxMetadataBytes) return { _truncated: true, _bytes: bytes, _keys: Object.keys(metadata).slice(0, 20) };
    return metadata;
  }

  private dispatch(record: LogRecord): void {
    for (const sink of this.sinks) {
      try {
        const result = sink.write(record);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).then(undefined, (err) => this.sinkFailed(sink, err));
        }
      } catch (err) {
        this.sinkFailed(sink, err);
      }
    }
  }

  private sinkFailed(sink: LogSink, err: unknown): void {
    try {
      this.sinkErrors.inc({ sink: sink.name });
      this.reportOnce(`sink:${sink.name}`, `log sink "${sink.name}" failed (LOG-001); logging continues without it`, err);
    } catch {
      // nothing left to do
    }
  }

  private internalError(err: unknown, level: Level, event: string): void {
    if (this.inInternalError) return;
    this.inInternalError = true;
    try {
      this.internalErrors.inc();
      this.reportOnce("internal", "a log record could not be built", err);
      this.dispatch({
        timestamp: this.now().toISOString(),
        level: "ERROR",
        event: "LOG_INTERNAL_ERROR",
        message: "A log record could not be built; a reduced record was written instead.",
        service: this.options.service,
        environment: this.options.environment,
        platform: this.options.platform,
        error_code: "LOG-001",
        metadata: { failed_event: event, failed_level: level, reason: truncateMessage(scrubString(err instanceof Error ? err.message : String(err))) },
      });
    } catch {
      // logging must never take the application down
    } finally {
      this.inInternalError = false;
    }
  }

  /** At most one report per key per minute, so a broken sink cannot flood the fallback channel. */
  private reportOnce(key: string, message: string, err: unknown): void {
    const at = this.clock();
    const last = this.lastReport.get(key);
    if (last !== undefined && at - last < 60_000) return;
    this.lastReport.set(key, at);
    try {
      this.reportInternalFn(`[observability] ${message}`, err instanceof Error ? err.message : err);
    } catch {
      // ignore
    }
  }
}

function definedOnly<T extends object>(source: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(source) as Array<keyof T>) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Copies the defined values of `source` onto `target` without allocating an intermediate object. */
function assignDefined(target: LogContext, source: LogContext | undefined): void {
  if (!source) return;
  for (const key in source) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  }
}

function truncateMessage(text: string): string {
  return text.length <= MAX_MESSAGE_CHARS ? text : `${text.slice(0, MAX_MESSAGE_CHARS)}…`;
}

export interface LogTimer {
  /** Writes the record with `durationMs` filled in and returns the duration. */
  end(level?: Level, extra?: LogFields): number;
}

/** The handle application code holds. Cheap to create: child() only remembers what to bind. */
export class Logger {
  constructor(private readonly coreOf: () => LoggerCore, private readonly bound: Bound = { context: {} }) {}

  /** A logger that always writes with these module/component names, context and metadata. */
  child(bindings: ChildBindings = {}): Logger {
    const { module: moduleName, component, metadata, ...context } = bindings;
    return new Logger(this.coreOf, {
      module: moduleName ?? this.bound.module,
      component: component ?? this.bound.component,
      context: { ...this.bound.context, ...definedOnly(context) },
      metadata: metadata ? { ...this.bound.metadata, ...metadata } : this.bound.metadata,
    });
  }

  trace(event: EventName, fields?: LogFields): void {
    this.coreOf().emit("TRACE", event, fields, this.bound);
  }
  debug(event: EventName, fields?: LogFields): void {
    this.coreOf().emit("DEBUG", event, fields, this.bound);
  }
  info(event: EventName, fields?: LogFields): void {
    this.coreOf().emit("INFO", event, fields, this.bound);
  }
  warn(event: EventName, fields?: LogFields): void {
    this.coreOf().emit("WARN", event, fields, this.bound);
  }
  error(event: EventName, fields?: LogFields): void {
    this.coreOf().emit("ERROR", event, fields, this.bound);
  }
  critical(event: EventName, fields?: LogFields): void {
    this.coreOf().emit("CRITICAL", event, fields, this.bound);
  }
  log(level: Level, event: EventName, fields?: LogFields): void {
    this.coreOf().emit(level, event, fields, this.bound);
  }

  /** Would a record at this level (for this event) be written? Use it to skip building expensive fields. */
  isEnabled(level: Level, event?: EventName): boolean {
    return this.coreOf().wouldEmit(level, event, this.bound);
  }

  /** Starts a stopwatch; end() writes `event` with its duration. */
  time(event: EventName, fields?: LogFields): LogTimer {
    const core = this.coreOf();
    const started = core.now_();
    return {
      end: (level: Level = "INFO", extra?: LogFields): number => {
        const durationMs = round2(core.now_() - started);
        this.log(level, event, { ...fields, ...extra, durationMs });
        return durationMs;
      },
    };
  }

  /**
   * Runs `fn` between BASE_STARTED (DEBUG), BASE_SUCCESS (INFO, with duration) and BASE_FAILED
   * (ERROR, with the error and duration; the error is rethrown). SUCCESS is written only after `fn`
   * has returned — so when `fn` includes the commit, it can never be logged as done before it is.
   */
  async operation<T>(base: OperationBase, fields: LogFields | undefined, fn: () => Promise<T> | T): Promise<T> {
    const core = this.coreOf();
    const started = core.now_();
    this.debug(`${base}_STARTED` as EventName, fields);
    try {
      const result = await fn();
      this.info(`${base}_SUCCESS` as EventName, { ...fields, durationMs: round2(core.now_() - started) });
      return result;
    } catch (error) {
      this.error(`${base}_FAILED` as EventName, { ...fields, error, durationMs: round2(core.now_() - started) });
      throw error;
    }
  }

  // ---- runtime control (the admin endpoint in a later phase drives these)

  setLevel(level: Level): void {
    const core = this.coreOf();
    core.levels.setBase(level);
    this.info("LOG_LEVEL_CHANGED", { scope: "base", level });
  }

  setOverride(key: string, level: Level, ttlMs?: number): void {
    const core = this.coreOf();
    core.levels.setOverride(key, level, ttlMs);
    this.info("LOG_LEVEL_CHANGED", { scope: key.toUpperCase(), level, ttlMs });
  }

  clearOverride(key: string): void {
    this.coreOf().levels.clearOverride(key);
    this.info("LOG_LEVEL_CHANGED", { scope: key.toUpperCase(), level: "default" });
  }

  flush(): Promise<void> {
    return this.coreOf().flush();
  }
}

export function createLoggerCore(options: LoggerOptions): LoggerCore {
  return new LoggerCore(options);
}

export function createLogger(options: LoggerOptions): Logger {
  const core = new LoggerCore(options);
  return new Logger(() => core);
}
