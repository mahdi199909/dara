// The wrapper every API route handler goes through:
//
//   async function GET(req: Request) { … }                       // the handler, unchanged
//   const loggedGET = withApiLogging("GET", "/api/tasks", GET);
//   export { loggedGET as GET };                                  // what Next.js calls
//
// It gives the request an id and a trace (see requestContext.ts), runs the handler inside that
// context, and writes one completion record: method, path, status, duration, how much database work
// it caused, and — for a failure — the error code. Nothing about the request body, headers or query
// string is ever logged. If anything in here fails, the handler's own result still goes out: logging
// is never allowed to break a request.
import { classifyError } from "../core/errorCodes";
import type { Level } from "../core/levels";
import { metrics } from "../core/metrics";
import { getLogger } from "../root";
import { beginRequest, runWithRequestContext, setRequestErrorCode, type RequestContext } from "./requestContext";
import { isErrorReported } from "./transactionContext";
import { serverSettings } from "./settings";

const log = getLogger(null, "route");

const requestsTotal = metrics.counter("http_requests_total", "HTTP requests handled, by method, route and status class.");
const requestDuration = metrics.histogram("http_request_duration_ms", "HTTP request duration in milliseconds, by method and route.");
const slowRequestsTotal = metrics.counter("http_slow_requests_total", "HTTP requests slower than their slow threshold, by route.");

type Handler<Args extends unknown[]> = (...args: Args) => Response | Promise<Response>;

/**
 * `next build` calls every GET handler once to learn whether it could be prerendered (the ones that
 * read the session cookie cannot). Those calls are not requests: no context, no log line, no metric.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** A successful read is routine (DEBUG); a successful write is worth a line (INFO); failures always are. */
export function completionLevel(method: string, status: number): Level {
  if (status >= 500) return "ERROR";
  if (status >= 400) return "WARN";
  return method === "GET" || method === "HEAD" ? "DEBUG" : "INFO";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Logging must never change what a request does: whatever `fn` throws stays inside the wrapper. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // ignore: a failed log line is not an application failure
  }
}

function contentLength(response: Response | undefined): number | undefined {
  const raw = response?.headers?.get("content-length");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finish(context: RequestContext, response: Response | undefined, thrown: unknown, threw: boolean): void {
  const status = threw ? 500 : response?.status ?? 200;
  const durationMs = round2((typeof performance !== "undefined" ? performance.now() : Date.now()) - context.startedAt);

  if (threw) {
    const code = classifyError(thrown) ?? "SYS-001";
    setRequestErrorCode(code);
    if (!isErrorReported(thrown)) log.error("API_UNHANDLED_ERROR", { error: thrown, errorCode: code, httpMethod: context.method, httpPath: context.path, route: context.route });
  }

  const statusClass = `${Math.floor(status / 100)}xx`;
  requestsTotal.inc({ method: context.method, route: context.route, status: statusClass });
  requestDuration.observe(durationMs, { method: context.method, route: context.route });

  const fields = {
    httpMethod: context.method,
    httpPath: context.path,
    statusCode: status,
    durationMs,
    responseSize: contentLength(response),
    errorCode: status >= 400 ? context.errorCode : undefined,
    route: context.route,
    dbQueries: context.db.queries,
    dbMs: round2(context.db.totalMs),
    clientRequestId: context.clientRequestId,
    parentSpanId: context.parentSpanId,
  };
  log.log(completionLevel(context.method, status), "HTTP_REQUEST_COMPLETED", fields);

  // A sync request can carry a whole backup, so it has its own, more patient threshold and its own event.
  const settings = serverSettings();
  const isSync = context.route.startsWith("/api/sync/");
  const thresholdMs = isSync ? settings.slowSyncMs : settings.slowRequestMs;
  if (durationMs >= thresholdMs) {
    slowRequestsTotal.inc({ route: context.route });
    log.warn(isSync ? "SYNC_SLOW" : "API_SLOW_REQUEST", {
      httpMethod: context.method,
      httpPath: context.path,
      statusCode: status,
      durationMs,
      thresholdMs,
      route: context.route,
      dbQueries: context.db.queries,
      dbMs: round2(context.db.totalMs),
      dbSlowestMs: round2(context.db.slowestMs),
    });
  }
}

/** Tells the caller which request this was, so a bug report can quote it. */
function stamp(context: RequestContext, response: Response | undefined): void {
  try {
    response?.headers?.set("X-Request-Id", context.requestId);
  } catch {
    // immutable headers (a redirect or a proxied fetch response): the id is still in the logs
  }
}

async function execute<Args extends unknown[]>(context: RequestContext, handler: Handler<Args>, args: Args): Promise<Response> {
  safely(() => log.debug("HTTP_REQUEST_STARTED", { httpMethod: context.method, httpPath: context.path, route: context.route }));

  let response: Response;
  try {
    response = await handler(...args);
  } catch (error) {
    safely(() => finish(context, undefined, error, true));
    throw error; // Next.js turns it into its own 500, exactly as it did before the wrapper existed
  }

  safely(() => {
    stamp(context, response);
    finish(context, response, undefined, false);
  });
  return response;
}

export function withApiLogging<Args extends unknown[]>(method: string, route: string, handler: Handler<Args>): (...args: Args) => Promise<Response> {
  return function loggedRoute(...args: Args): Promise<Response> {
    if (isBuildPhase()) return Promise.resolve(handler(...args));
    let context: RequestContext;
    try {
      context = beginRequest(args[0] as Request | undefined, method, route);
    } catch {
      // Could not even read the request: run the handler bare rather than fail the request.
      return Promise.resolve(handler(...args));
    }
    return runWithRequestContext(context, () => execute(context, handler, args));
  };
}
