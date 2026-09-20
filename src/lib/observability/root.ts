// The process-wide logger: built lazily from the environment on first use, and shared by every
// getLogger() handle. Handles resolve the core at call time (not at creation), so a module that
// creates `const log = getLogger("sync", "runner")` at import time still follows a test's swap or a
// later configuration change.
import { detectRuntime, resolveLoggingConfig, type LogEnv } from "./config";
import { createLoggerCore, Logger, type ContextProvider, type LoggerCore } from "./core/logger";
import { newId } from "./core/ids";
import { ConsoleSink } from "./core/sink";

/**
 * Every variable is read as a literal `process.env.NAME` on purpose: a Next.js browser bundle only
 * inlines NEXT_PUBLIC_* accesses spelled out like this — passing the whole `process.env` object
 * would read nothing on the phone.
 */
function readEnv(): LogEnv {
  return {
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_LEVEL_OVERRIDES: process.env.LOG_LEVEL_OVERRIDES,
    LOG_FORMAT: process.env.LOG_FORMAT,
    LOG_STACK_TRACES: process.env.LOG_STACK_TRACES,
    LOG_SAMPLE_DEBUG: process.env.LOG_SAMPLE_DEBUG,
    APP_ENV: process.env.APP_ENV,
    GIT_COMMIT: process.env.GIT_COMMIT,
    BUILD_NUMBER: process.env.BUILD_NUMBER,
    NEXT_PUBLIC_LOG_LEVEL: process.env.NEXT_PUBLIC_LOG_LEVEL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_GIT_COMMIT: process.env.NEXT_PUBLIC_GIT_COMMIT,
    NEXT_PUBLIC_BUILD_NUMBER: process.env.NEXT_PUBLIC_BUILD_NUMBER,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
  };
}

/**
 * The shared state lives on globalThis under a registered symbol, not in module variables: a Next.js
 * server build can hold this module more than once (the instrumentation bundle, a route bundle, the
 * dev server after a hot reload), and every copy must see the same root logger and the same
 * registered context providers.
 */
interface RootState {
  core: LoggerCore | null;
  override: LoggerCore | null;
  providers: Map<string, ContextProvider>;
}

const STATE_KEY = Symbol.for("parva.observability.root.v1");

function state(): RootState {
  const holder = globalThis as unknown as Record<symbol, RootState | undefined>;
  let current = holder[STATE_KEY];
  if (!current) {
    current = { core: null, override: null, providers: new Map() };
    holder[STATE_KEY] = current;
  }
  return current;
}

function buildRootCore(): LoggerCore {
  const runtime = detectRuntime();
  const config = resolveLoggingConfig(readEnv(), runtime);
  const core = createLoggerCore({
    service: config.service,
    platform: config.platform,
    environment: config.environment,
    appVersion: config.appVersion,
    buildNumber: config.buildNumber,
    gitCommit: config.gitCommit,
    level: config.level,
    overrides: config.overrides,
    includeStack: config.includeStack,
    sampling: config.sampling,
    sinks: [new ConsoleSink({ format: config.format })],
    // A browser/WebView session is one launch; the server has no session until a request gives it one.
    staticContext: runtime.isServer ? undefined : { sessionId: newId("sess") },
    contextProviders: [...state().providers.values()],
  });
  for (const warning of config.warnings) core.emit("WARN", "LOG_INTERNAL_ERROR", { message: warning }, { context: {} });
  return core;
}

export function getRootCore(): LoggerCore {
  const current = state();
  if (current.override) return current.override;
  if (!current.core) current.core = buildRootCore();
  return current.core;
}

/**
 * The logger every module uses: `const log = getLogger("audit", "writer")`. Pass `null` as the module
 * for a component that logs across several domains: each event then takes the module of its own
 * domain (so LOG_LEVEL_OVERRIDES like SYNC=debug still reach it).
 */
export function getLogger(module: string | null, component?: string): Logger {
  return new Logger(getRootCore, { module: module ?? undefined, component, context: {} });
}

/**
 * Adds request/launch-scoped context to every record (the server's AsyncLocalStorage provider, a
 * phone's device id). A provider registered under an id that is already taken is ignored, so a second
 * copy of the registering module (see RootState) cannot double the context.
 */
export function addContextProvider(provider: ContextProvider, id?: string): void {
  const current = state();
  const key = id ?? `provider-${current.providers.size}`;
  if (current.providers.has(key)) return;
  current.providers.set(key, provider);
  current.core?.addContextProvider(provider);
  current.override?.addContextProvider(provider);
}

/** Tests: route every getLogger() handle to `core` until it is called again with null. */
export function setRootCoreOverride(core: LoggerCore | null): void {
  const current = state();
  current.override = core;
  // A test logger is built without the process's providers; give it the registered ones so request
  // context (request_id, user_id …) shows up in what the test reads back.
  if (core) for (const provider of current.providers.values()) core.addContextProvider(provider);
}

/** Tests: forget the lazily built root so the next log call reads the environment again. */
export function resetRootCore(): void {
  const current = state();
  current.core = null;
  current.override = null;
  current.providers.clear();
}
