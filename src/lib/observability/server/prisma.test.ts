import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metrics } from "../core/metrics";
import { installMemoryLogger } from "../testing";
import { beginRequest, runWithRequestContext } from "./requestContext";
import { attachPrismaEvents, classifyDbFailure, reportDbOperation, sanitizeEngineMessage, withPrismaObservability } from "./prisma";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  memory.restore();
  delete process.env.LOG_SLOW_QUERY_MS;
});

function prismaError(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name, clientVersion: "5.19.1", ...extra });
}

/** What Prisma would put in a query error: the call and its arguments, then the explanation. */
const LEAKY_MESSAGE = ['\nInvalid `prisma.user.create()` invocation in', "/app/route.js:1:1", "", "  40   data: {", '→ 41     email: "ali@example.com",', '         title: "Secret plan for Sara"', "       }", "", "Unique constraint failed on the fields: (`email`)"].join("\n");

/** The hook Prisma calls, extracted from `client.$extends(...)` so it can be driven without a database. */
function extractHook() {
  const definition = withPrismaObservability({ $extends: (extension: unknown) => extension } as never) as unknown as {
    query: { $allModels: { $allOperations: (input: { model: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) => Promise<unknown> } };
  };
  return definition.query.$allModels.$allOperations;
}

describe("classifyDbFailure", () => {
  it("makes a broken connection or pool an ERROR with its own event", () => {
    expect(classifyDbFailure(prismaError("PrismaClientKnownRequestError", "x", { code: "P1001" }))).toEqual({ event: "DB_CONNECTION_ERROR", level: "ERROR", code: "DB-001" });
    expect(classifyDbFailure(prismaError("PrismaClientInitializationError", "Can't reach database server"))).toEqual({ event: "DB_CONNECTION_ERROR", level: "ERROR", code: "DB-001" });
    expect(classifyDbFailure(prismaError("PrismaClientKnownRequestError", "x", { code: "P2024" }))).toEqual({ event: "DB_CONNECTION_POOL_EXHAUSTED", level: "ERROR", code: "DB-004" });
  });

  it("makes a constraint violation or a missing row a WARN — callers often expect those", () => {
    expect(classifyDbFailure(prismaError("PrismaClientKnownRequestError", "x", { code: "P2002" }))).toEqual({ event: "DB_QUERY_ERROR", level: "WARN", code: "DB-005" });
    expect(classifyDbFailure(prismaError("PrismaClientKnownRequestError", "x", { code: "P2003" }))).toEqual({ event: "DB_QUERY_ERROR", level: "WARN", code: "DB-006" });
    expect(classifyDbFailure(prismaError("PrismaClientKnownRequestError", "x", { code: "P2025" }))).toEqual({ event: "DB_QUERY_ERROR", level: "WARN", code: "DB-007" });
  });

  it("treats anything else as a plain query error", () => {
    expect(classifyDbFailure(new Error("who knows"))).toEqual({ event: "DB_QUERY_ERROR", level: "ERROR", code: "DB-002" });
    expect(classifyDbFailure(prismaError("PrismaClientKnownRequestError", "x", { code: "P2010" }))).toEqual({ event: "DB_QUERY_ERROR", level: "ERROR", code: "DB-002" });
    expect(classifyDbFailure("a string")).toEqual({ event: "DB_QUERY_ERROR", level: "ERROR", code: "DB-002" });
  });
});

describe("reportDbOperation", () => {
  it("records nothing loud for a fast, successful operation", () => {
    reportDbOperation("Task", "findMany", 3);
    expect(memory.sink.records).toEqual([]);
  });

  it("warns about a slow one, naming the model and operation but nothing they carried", () => {
    process.env.LOG_SLOW_QUERY_MS = "50";
    reportDbOperation("Task", "findMany", 120.456);
    const [record] = memory.sink.find("DB_SLOW_QUERY");
    expect(record).toMatchObject({ level: "WARN", module: "database", entity_type: "Task", operation: "findMany", duration_ms: 120.46, metadata: { thresholdMs: 50, failed: false } });
  });

  it("reports a failure with its class and code, and never the error's own text about the data", () => {
    reportDbOperation("User", "create", 4, prismaError("PrismaClientKnownRequestError", LEAKY_MESSAGE, { code: "P2002", meta: { target: ["email"] } }));
    const [record] = memory.sink.find("DB_QUERY_ERROR");
    expect(record).toMatchObject({ level: "WARN", entity_type: "User", operation: "create", error_code: "DB-005", error: { type: "PrismaClientKnownRequestError", code: "P2002" } });
    const written = JSON.stringify(record);
    expect(written).not.toContain("ali@example.com");
    expect(written).not.toContain("Secret plan");
    expect(written).not.toContain("Sara");
    expect(record.error?.message).toContain("Unique constraint failed on the fields");
  });

  it("does not put a stack on a WARN, but does on a real error", () => {
    reportDbOperation("User", "create", 4, prismaError("PrismaClientKnownRequestError", LEAKY_MESSAGE, { code: "P2002" }));
    reportDbOperation("User", "findMany", 4, prismaError("PrismaClientKnownRequestError", "boom", { code: "P2010" }));
    const [warned, errored] = memory.sink.records;
    expect(warned.error?.stack).toBeUndefined();
    expect(errored.error?.stack).toBeDefined();
    expect(JSON.stringify(errored)).not.toContain("ali@example.com");
  });

  it("logs a lost connection as DB_CONNECTION_ERROR", () => {
    reportDbOperation("Task", "findMany", 30_000, prismaError("PrismaClientInitializationError", "Can't reach database server at `postgres`:`5432`"));
    expect(memory.sink.find("DB_CONNECTION_ERROR")[0]).toMatchObject({ level: "ERROR", error_code: "DB-001" });
  });

  it("counts operations and failures for /metrics", () => {
    const ok = metrics.counter("db_queries_total").value({ outcome: "ok" });
    const failed = metrics.counter("db_queries_total").value({ outcome: "error" });
    reportDbOperation("Task", "create", 1);
    reportDbOperation("Task", "create", 1, new Error("x"));
    expect(metrics.counter("db_queries_total").value({ outcome: "ok" })).toBe(ok + 1);
    expect(metrics.counter("db_queries_total").value({ outcome: "error" })).toBe(failed + 1);
    expect(metrics.toPrometheus()).toContain('db_query_duration_ms_count{operation="create"}');
  });

  it("adds the operation to the current request's tally", () => {
    const context = beginRequest(new Request("http://localhost/api/x"), "GET", "/api/x");
    runWithRequestContext(context, () => {
      reportDbOperation("Task", "findMany", 6);
      reportDbOperation("Task", "count", 2);
    });
    expect(context.db).toEqual({ queries: 2, totalMs: 8, slowestMs: 6 });
  });

  it("never throws", () => {
    const hostile = {
      get name(): string {
        throw new Error("no");
      },
      message: "x",
      stack: "x",
    };
    expect(() => reportDbOperation("Task", "create", 1, hostile)).not.toThrow();
  });
});

describe("withPrismaObservability", () => {
  it("returns the result unchanged and times the call", async () => {
    const hook = extractHook();
    const result = await hook({ model: "Task", operation: "findMany", args: { where: { title: "private" } }, query: async () => [{ id: "t1" }] });
    expect(result).toEqual([{ id: "t1" }]);
    expect(memory.sink.records).toEqual([]);
  });

  it("rethrows the very same error after logging it", async () => {
    const hook = extractHook();
    const failure = prismaError("PrismaClientKnownRequestError", LEAKY_MESSAGE, { code: "P2002" });
    await expect(hook({ model: "User", operation: "create", args: { data: { email: "ali@example.com" } }, query: async () => Promise.reject(failure) })).rejects.toBe(failure);
    expect(memory.sink.find("DB_QUERY_ERROR")).toHaveLength(1);
  });

  it("never records the arguments, even in a slow-query line", async () => {
    process.env.LOG_SLOW_QUERY_MS = "0";
    const hook = extractHook();
    await hook({ model: "Task", operation: "create", args: { data: { title: "Secret plan for Sara", amount: 123456789 } }, query: async () => ({ id: "t1" }) });
    const written = JSON.stringify(memory.sink.records);
    expect(written).toContain("DB_SLOW_QUERY");
    expect(written).not.toContain("Secret plan");
    expect(written).not.toContain("123456789");
  });
});

describe("engine events", () => {
  it("scrubs the quoted value out of a PostgreSQL detail line", () => {
    const message = 'Error occurred during query execution: PostgresError { code: "23505", detail: Some("Key (email)=(ali@example.com) already exists."), severity: "ERROR" }';
    const cleaned = sanitizeEngineMessage(message);
    expect(cleaned).not.toContain("ali@example.com");
    expect(cleaned).toContain("23505");
  });

  it("caps the length and collapses whitespace", () => {
    const cleaned = sanitizeEngineMessage(`line one\n\n   line two ${"x".repeat(1000)}`);
    expect(cleaned.length).toBeLessThanOrEqual(240);
    expect(cleaned).not.toContain("\n");
  });

  it("logs the engine's error and warn events through the logger", () => {
    const listeners: Record<string, (event: { message: string; target?: string }) => void> = {};
    attachPrismaEvents({ $on: (name: string, listener: (event: { message: string; target?: string }) => void) => (listeners[name] = listener) });
    listeners.error({ message: "Error in PostgreSQL connection: Error { kind: Closed, cause: None }", target: "quaint::connector::postgres" });
    listeners.error({ message: "something else broke", target: "query_engine" });
    listeners.warn({ message: "There are already 10 instances of Prisma Client actively running." });

    const [connection, other] = memory.sink.find("DB_CONNECTION_ERROR").concat(memory.sink.find("DB_QUERY_ERROR"));
    expect(connection).toMatchObject({ level: "ERROR", error_code: "DB-001", metadata: { target: "quaint::connector::postgres" } });
    expect(other).toMatchObject({ error_code: "DB-002" });
    expect(memory.sink.find("DB_QUERY_ERROR").map((r) => r.level)).toEqual(["ERROR", "WARN"]);
  });

  it("drops the engine's copy of a failed query — it carries the call's arguments, and the extension logs the failure once", () => {
    const listeners: Record<string, (event: { message: string; target?: string }) => void> = {};
    attachPrismaEvents({ $on: (name: string, listener: (event: { message: string; target?: string }) => void) => (listeners[name] = listener) });
    listeners.error({ message: LEAKY_MESSAGE, target: "user.create" });
    listeners.warn({ message: LEAKY_MESSAGE, target: "user.create" });
    expect(memory.sink.records).toEqual([]);
  });

  it("does not throw when the engine sends something odd", () => {
    const listeners: Record<string, (event: never) => void> = {};
    attachPrismaEvents({ $on: (name: string, listener: (event: never) => void) => (listeners[name] = listener) });
    expect(() => listeners.error(null as never)).not.toThrow();
    expect(() => listeners.warn({ message: undefined } as never)).not.toThrow();
  });
});
