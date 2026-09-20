// Database observability for the server: how long each Prisma operation took, which ones were slow,
// which ones failed and why — without ever recording what was in them.
//
// Deliberately absent: the SQL text, the query arguments, Prisma's own "query" log. Both would put
// task titles, e-mails and money amounts into the logs. What a record carries is the model, the
// operation ("findMany"), the duration and — for a failure — the error code and Prisma's error class.
//
// Why a client extension and not `log: ["query"]`: it wraps every operation with a start and an end,
// so it can time them, count them per request (the request's completion record reports queries and
// database time) and classify failures, and it costs one extra function call per query.
import type { PrismaClient } from "@prisma/client";
import { classifyError, type ErrorCode } from "../core/errorCodes";
import type { EventName } from "../core/events";
import type { Level } from "../core/levels";
import { metrics } from "../core/metrics";
import { isPrismaInvocationMessage, scrubString } from "../core/redact";
import { getLogger } from "../root";
import { recordDbQuery } from "./requestContext";
import { serverSettings } from "./settings";

const log = getLogger(null, "prisma");

const queriesTotal = metrics.counter("db_queries_total", "Database operations, by outcome.");
const queryDuration = metrics.histogram("db_query_duration_ms", "Database operation duration in milliseconds, by operation.");
const slowQueriesTotal = metrics.counter("db_slow_queries_total", "Database operations slower than the slow-query threshold.");

export interface DbFailureClass {
  event: EventName;
  level: Level;
  code: ErrorCode;
}

/**
 * Which log event, level and code a failed database call deserves. A constraint violation or a
 * missing row is often something the caller expects and turns into a 4xx, so it is a WARN; a broken
 * connection, an exhausted pool or a query Prisma could not run is an ERROR.
 */
export function classifyDbFailure(err: unknown): DbFailureClass {
  const code = classifyError(err) ?? "DB-002";
  switch (code) {
    case "DB-001":
      return { event: "DB_CONNECTION_ERROR", level: "ERROR", code };
    case "DB-004":
      return { event: "DB_CONNECTION_POOL_EXHAUSTED", level: "ERROR", code };
    case "DB-005":
    case "DB-006":
    case "DB-007":
      return { event: "DB_QUERY_ERROR", level: "WARN", code };
    default:
      return { event: "DB_QUERY_ERROR", level: "ERROR", code: code === "DB-003" ? code : "DB-002" };
  }
}

/** Records one finished database operation: timing, the request's tally, a slow-query line, a failure line. Never throws. */
export function reportDbOperation(model: string | undefined, operation: string, durationMs: number, error?: unknown): void {
  try {
    const failed = error !== undefined;
    recordDbQuery(durationMs);
    queriesTotal.inc({ outcome: failed ? "error" : "ok" });
    queryDuration.observe(durationMs, { operation });

    const { slowQueryMs } = serverSettings();
    const rounded = Math.round(durationMs * 100) / 100;
    if (durationMs >= slowQueryMs) {
      slowQueriesTotal.inc();
      log.warn("DB_SLOW_QUERY", { entityType: model, operation, durationMs: rounded, thresholdMs: slowQueryMs, failed });
    }
    if (failed) {
      const { event, level, code } = classifyDbFailure(error);
      log.log(level, event, { entityType: model, operation, durationMs: rounded, error, errorCode: code });
    }
  } catch {
    // observability must not take a query down with it
  }
}

/** The client with every operation timed and classified. The result type is the client's own, extended. */
export function withPrismaObservability(client: PrismaClient) {
  return client.$extends({
    name: "parva-observability",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const started = performance.now();
          try {
            const result = await query(args);
            reportDbOperation(model, operation, performance.now() - started);
            return result;
          } catch (error) {
            reportDbOperation(model, operation, performance.now() - started, error);
            throw error;
          }
        },
      },
    },
  });
}

/**
 * Prisma's engine reports problems that are not tied to one call (a dropped connection, a pool
 * warning) as log events. Unlike its built-in stderr output, the message here is scrubbed first: a
 * PostgreSQL "detail" line can quote the offending value ("Key (email)=(…) already exists").
 */
export function sanitizeEngineMessage(message: string): string {
  return scrubString(String(message))
    .replace(/\bKey \([^)]*\)=\([^)]*\)/g, "Key (…)=(…)")
    .replace(/detail: Some\("(?:[^"\\]|\\.)*"\)/g, 'detail: Some("…")')
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

const CONNECTION_TROUBLE = /can't reach|connection|closed|timed out|timeout|refused|unreachable/i;

interface PrismaEventSource {
  $on(event: "error" | "warn", listener: (event: { message: string; target?: string }) => void): void;
}

/**
 * Subscribes to the engine's `error` and `warn` events (the client must have been created with
 * `emit: "event"` for both).
 *
 * The engine also raises an `error` event for every failed query, carrying the same text as the
 * thrown error — the call with its arguments. Those are dropped here: the extension above already
 * records that failure once, classified, with a message that has the arguments removed.
 */
export function attachPrismaEvents(client: unknown): void {
  const source = client as PrismaEventSource;
  source.$on("error", (event) => {
    try {
      if (isPrismaInvocationMessage(String(event?.message ?? ""))) return;
      const message = sanitizeEngineMessage(event.message);
      const connection = CONNECTION_TROUBLE.test(message);
      log.error(connection ? "DB_CONNECTION_ERROR" : "DB_QUERY_ERROR", { errorCode: connection ? "DB-001" : "DB-002", engineMessage: message, target: event.target });
    } catch {
      // ignore
    }
  });
  source.$on("warn", (event) => {
    try {
      if (isPrismaInvocationMessage(String(event?.message ?? ""))) return;
      log.warn("DB_QUERY_ERROR", { errorCode: "DB-002", engineMessage: sanitizeEngineMessage(event.message), target: event.target, severity: "warning" });
    } catch {
      // ignore
    }
  });
}
