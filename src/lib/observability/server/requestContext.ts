// The context of one API request on the server: who is asking, which request this is, which trace it
// belongs to, and how much database work it caused. It rides an AsyncLocalStorage, so every log line
// written anywhere below a route handler — the Prisma hook, the audit writer, a helper three calls
// deep — carries the same request_id / trace_id / user_id without anyone passing a logger around.
//
// Server-only (node:async_hooks): the phone and the browser have no equivalent; their launch-scoped
// context is registered in the client adapter instead.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ErrorCode } from "../core/errorCodes";
import { isId, newId } from "../core/ids";
import type { LogContext } from "../core/schema";
import { newTraceContext, parseTraceparent } from "../core/trace";
import { addContextProvider } from "../root";

export interface RequestContext {
  /** Ours: unique per HTTP request, echoed to the caller in the `X-Request-Id` header and error body. */
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  method: string;
  /** Path only — never the query string, which can carry search text. */
  path: string;
  /** The route pattern ("/api/tasks/[id]"): what metrics group by, since real paths carry ids. */
  route: string;
  /** Known once the handler authenticates (see setRequestUser). */
  userId?: string;
  /** From the app's `X-Parva-Device-Id` / `X-Parva-Sync-Id` headers (validated), when present. */
  deviceId?: string;
  syncId?: string;
  /** The caller's own `X-Request-Id`, kept only as a hint — the id we trust is `requestId`. */
  clientRequestId?: string;
  /** performance.now() at the start. */
  startedAt: number;
  /** The error code the response carried, once handleApiError has chosen it. */
  errorCode?: ErrorCode;
  /** What the request cost the database (filled in by the Prisma hook). */
  db: { queries: number; totalMs: number; slowestMs: number };
}

const STORAGE_KEY = Symbol.for("parva.observability.requestContext.v1");
const PROVIDER_ID = "server.request-context";
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_.:-]{6,64}$/;

/** One storage per process even when this module is bundled twice (see root.ts for why). */
function storage(): AsyncLocalStorage<RequestContext> {
  const holder = globalThis as unknown as Record<symbol, AsyncLocalStorage<RequestContext> | undefined>;
  let current = holder[STORAGE_KEY];
  if (!current) {
    current = new AsyncLocalStorage<RequestContext>();
    holder[STORAGE_KEY] = current;
  }
  return current;
}

function requestProvider(): LogContext | undefined {
  const context = storage().getStore();
  if (!context) return undefined;
  return {
    requestId: context.requestId,
    traceId: context.traceId,
    spanId: context.spanId,
    userId: context.userId,
    deviceId: context.deviceId,
    syncId: context.syncId,
    layer: "server",
  };
}

/** Makes every log record inside a request carry its context. Idempotent; safe to call per request. */
export function ensureRequestContextProvider(): void {
  addContextProvider(requestProvider, PROVIDER_ID);
}
ensureRequestContextProvider();

function pathOf(request: Request | undefined): string {
  try {
    return request?.url ? new URL(request.url).pathname : "";
  } catch {
    return "";
  }
}

function header(request: Request | undefined, name: string): string | undefined {
  try {
    return request?.headers?.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the context for an incoming request. Anything the caller supplies (traceparent, device and
 * sync ids, its own request id) is validated and dropped when malformed: a bad header must never
 * break a request, and a hostile one must never reach a log line as free text.
 */
export function beginRequest(request: Request | undefined, method: string, route: string): RequestContext {
  // parseTraceparent already makes a fresh span of ours whose parent is the caller's span.
  const trace = parseTraceparent(header(request, "traceparent")) ?? newTraceContext();
  const deviceId = header(request, "x-parva-device-id");
  const syncId = header(request, "x-parva-sync-id");
  const clientRequestId = header(request, "x-request-id");
  const context: RequestContext = {
    requestId: newId("req"),
    traceId: trace.traceId,
    spanId: trace.spanId,
    method,
    path: pathOf(request),
    route,
    startedAt: typeof performance !== "undefined" ? performance.now() : Date.now(),
    db: { queries: 0, totalMs: 0, slowestMs: 0 },
  };
  if (trace.parentSpanId) context.parentSpanId = trace.parentSpanId;
  if (isId(deviceId, "dev")) context.deviceId = deviceId;
  if (isId(syncId, "sync")) context.syncId = syncId;
  if (clientRequestId && CLIENT_REQUEST_ID.test(clientRequestId)) context.clientRequestId = clientRequestId;
  return context;
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  ensureRequestContextProvider();
  return storage().run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage().getStore();
}

/** Called once a handler knows who is calling, so later log lines of the request carry `user_id`. */
export function setRequestUser(userId: string): void {
  const context = storage().getStore();
  if (context) context.userId = userId;
}

/** Remembers the error code of the response so the request's completion record can carry it. */
export function setRequestErrorCode(code: ErrorCode): void {
  const context = storage().getStore();
  if (context) context.errorCode = code;
}

/** Adds one database round trip to the current request's tally. */
export function recordDbQuery(durationMs: number): void {
  const context = storage().getStore();
  if (!context) return;
  context.db.queries += 1;
  context.db.totalMs += durationMs;
  if (durationMs > context.db.slowestMs) context.db.slowestMs = durationMs;
}
