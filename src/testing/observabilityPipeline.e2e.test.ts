// End-to-end check of the server logging pipeline: the real route handlers (each wrapped by
// withApiLogging), the real Prisma client with its observability extension, a real SQLite database,
// and the shared logger routed into memory. It asserts what an operator would rely on at 3 a.m.:
// every request is traceable by one id from its first line to its last, failures carry a stable
// code, the response tells the caller which request it was — and nothing a person typed ends up in
// the log.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { newId, newSpanId, newTraceId } from "@/lib/observability/core/ids";
import { installMemoryLogger } from "@/lib/observability/testing";
import { emailPseudonym } from "@/lib/observability/server/authEvents";
import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;
let memory: ReturnType<typeof installMemoryLogger>;

beforeAll(async () => {
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  memory.restore();
});

/** The request completion lines, in order, as [method, path, status]. */
function completions() {
  return memory.sink.find("HTTP_REQUEST_COMPLETED").map((r) => [r.method, r.path, r.status_code]);
}

describe("a successful request", () => {
  it("is one story under one request id, with the database work counted", async () => {
    const { email } = await server.registerUser();
    memory.sink.clear();

    const created = await server.web("POST", "/api/tasks", { title: "یک کار کاملاً محرمانه", priority: "HIGH" });
    expect(created.status).toBe(201);
    const listed = await server.web("GET", "/api/tasks");
    expect(listed.status).toBe(200);

    const [post, get] = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(post).toMatchObject({ level: "INFO", method: "POST", path: "/api/tasks", status_code: 201, layer: "server", metadata: { route: "/api/tasks" } });
    expect(get).toMatchObject({ level: "DEBUG", method: "GET", path: "/api/tasks", status_code: 200 });
    expect(post.request_id).toMatch(/^req_/);
    expect(post.request_id).not.toBe(get.request_id);
    expect(post.user_id).toBeTruthy();
    expect(post.user_id).toBe(get.user_id);
    expect((post.metadata.dbQueries as number) >= 2).toBe(true); // at least the create and the audit row
    expect(post.trace_id).toMatch(/^[0-9a-f]{32}$/);

    // Nothing the person typed, and not their address, reached the log.
    const everything = JSON.stringify(memory.sink.records);
    expect(everything).not.toContain("محرمانه");
    expect(everything).not.toContain(email);
  });

  it("keeps two simultaneous requests apart", async () => {
    await server.registerUser();
    memory.sink.clear();
    await Promise.all([server.web("GET", "/api/tasks"), server.web("GET", "/api/accounts"), server.web("GET", "/api/projects")]);
    const done = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(done).toHaveLength(3);
    expect(new Set(done.map((r) => r.request_id)).size).toBe(3);
    expect(done.map((r) => r.metadata.route).sort()).toEqual(["/api/accounts", "/api/projects", "/api/tasks"]);
  });

  it("writes only the meaningful lines at the production level: writes and failures, not routine reads", async () => {
    memory.restore();
    memory = installMemoryLogger({ level: "INFO" });
    await server.registerUser();
    await server.web("POST", "/api/tasks", { title: "x" });
    await server.web("GET", "/api/tasks");
    await server.web("GET", "/api/accounts");
    expect(completions()).toEqual([
      ["POST", "/api/auth/register", 200],
      ["POST", "/api/tasks", 201],
    ]);
  });
});

describe("failures", () => {
  it("a wrong password: AUTH-001 in the body, the same request id in the log, and no address anywhere", async () => {
    const { email } = await server.registerUser();
    server.setWebSession(undefined);
    memory.sink.clear();

    const res = await server.web("POST", "/api/auth/login", { email, password: "definitely-wrong" });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: "ایمیل یا رمز عبور اشتباه است.", code: "AUTH-001" });
    expect(res.json.requestId).toMatch(/^req_/);

    const [failed] = memory.sink.find("AUTH_LOGIN_FAILED");
    expect(failed).toMatchObject({ level: "WARN", error_code: "AUTH-001", request_id: res.json.requestId, metadata: { reason: "wrong_password", emailHash: emailPseudonym(email) } });
    const done = memory.sink.find("HTTP_REQUEST_COMPLETED")[0];
    expect(done).toMatchObject({ level: "WARN", status_code: 401, error_code: "AUTH-001", request_id: res.json.requestId });
    expect(JSON.stringify(memory.sink.records)).not.toContain(email);
    expect(JSON.stringify(memory.sink.records)).not.toContain("definitely-wrong");
  });

  it("an unknown account is told the same thing as a wrong password, but the log knows the difference", async () => {
    server.setWebSession(undefined);
    memory.sink.clear();
    const res = await server.web("POST", "/api/auth/login", { email: "nobody@example.test", password: "whatever1" });
    expect(res.json).toMatchObject({ error: "ایمیل یا رمز عبور اشتباه است.", code: "AUTH-001" });
    expect(memory.sink.find("AUTH_LOGIN_FAILED")[0].metadata.reason).toBe("no_such_user");
  });

  it("too many attempts: AUTH-002 and a throttling record", async () => {
    const email = `throttle-${Math.random().toString(36).slice(2)}@example.test`;
    server.setWebSession(undefined);
    let last = { status: 0, json: null as { code?: string } | null };
    for (let attempt = 0; attempt < 12; attempt++) last = await server.web("POST", "/api/auth/login", { email, password: "nope-nope" });
    expect(last.status).toBe(429);
    expect(last.json?.code).toBe("AUTH-002");
    expect(memory.sink.find("AUTH_RATE_LIMITED").length).toBeGreaterThan(0);
    expect(memory.sink.find("AUTH_RATE_LIMITED")[0]).toMatchObject({ level: "WARN", error_code: "AUTH-002" });
  });

  it("registering an address that exists: AUTH-005 and a security record", async () => {
    const { email } = await server.registerUser();
    server.setWebSession(undefined);
    memory.sink.clear();
    const res = await server.web("POST", "/api/auth/register", { name: "دوباره", email, password: "secret123" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("AUTH-005");
    expect(memory.sink.find("AUTH_REGISTER_FAILED")[0]).toMatchObject({ level: "WARN", error_code: "AUTH-005" });
    expect(JSON.stringify(memory.sink.records)).not.toContain(email);
  });

  it("a protected route without a session: 401 / AUTH-003, logged once as an invalid session", async () => {
    server.setWebSession(undefined);
    memory.sink.clear();
    const res = await server.web("GET", "/api/tasks");
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ code: "AUTH-003" });
    expect(memory.sink.find("AUTH_SESSION_INVALID")).toHaveLength(1);
    expect(memory.sink.find("AUTH_SESSION_INVALID")[0].metadata.reason).toBe("missing");
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ level: "WARN", status_code: 401, error_code: "AUTH-003" });
  });

  it("invalid input: 400 / VAL-001, the field details still reach the caller, nothing is logged as an error", async () => {
    await server.registerUser();
    memory.sink.clear();
    const res = await server.web("POST", "/api/tasks", { title: "" });
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("VAL-001");
    expect(res.json.details).toBeDefined();
    expect(memory.sink.records.filter((r) => r.level === "ERROR")).toEqual([]);
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ level: "WARN", status_code: 400, error_code: "VAL-001" });
  });

  it("a missing record: 404 with the code for a missing row", async () => {
    await server.registerUser();
    memory.sink.clear();
    const res = await server.web("PATCH", "/api/tasks/does-not-exist", { title: "x" });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("DB-007");
    expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ status_code: 404, error_code: "DB-007", metadata: { route: "/api/tasks/[id]" } });
  });
});

describe("the database layer", () => {
  it("classifies a real unique-constraint failure without leaking the values it was given", async () => {
    const { email } = await server.registerUser();
    memory.sink.clear();

    await expect(server.prisma.user.create({ data: { name: "کاربر تکراری", email, passwordHash: "x" } })).rejects.toThrow();

    const [failure] = memory.sink.find("DB_QUERY_ERROR");
    expect(failure).toMatchObject({ level: "WARN", error_code: "DB-005", entity_type: "User", operation: "create", error: { code: "P2002" } });
    const written = JSON.stringify(memory.sink.records);
    expect(written).not.toContain(email);
    expect(written).not.toContain("کاربر تکراری");
    expect(failure.error?.message).toContain("Unique constraint failed");
  });

  it("times operations and reports one that crosses the slow threshold, by model and operation only", async () => {
    await server.registerUser();
    memory.sink.clear();
    process.env.LOG_SLOW_QUERY_MS = "0";
    try {
      await server.web("GET", "/api/tasks");
    } finally {
      delete process.env.LOG_SLOW_QUERY_MS;
    }
    const slow = memory.sink.find("DB_SLOW_QUERY");
    expect(slow.length).toBeGreaterThan(0);
    expect(slow[0].entity_type).toBeTruthy();
    expect(slow[0].operation).toBeTruthy();
    expect(slow[0].request_id).toMatch(/^req_/);
  });

  it("never lets a Prisma error escape into a response body or a log line as a query dump", async () => {
    await server.registerUser();
    memory.sink.clear();
    // A malformed sync payload makes a real route hit a real Prisma validation error.
    const res = await server.web("POST", "/api/sync/push", { protocol: 2, tables: { Task: [{ id: "t1", title: "بسیار محرمانه", userId: "someone-else", createdAt: "not-a-date" }] } });
    const body = JSON.stringify(res.json);
    expect(body).not.toContain("prisma.");
    expect(body).not.toContain("Invalid `");
    const written = JSON.stringify(memory.sink.records);
    expect(written).not.toContain("بسیار محرمانه");
    expect(written).not.toContain("Invalid `prisma");
  });
});

describe("reports", () => {
  afterEach(() => {
    delete process.env.SLOW_REPORT_THRESHOLD_MS;
  });

  it("tells the log how long a report took, over which period and how many rows — under the request's own id, and never a figure or a name", async () => {
    await server.registerUser();
    await server.mustWeb("POST", "/api/categories", { name: "دستهٔ کاملاً محرمانه" });
    await server.mustWeb("POST", "/api/tasks", { title: "کار محرمانهٔ گزارش" });
    memory.sink.clear();

    const res = await server.web("GET", "/api/reports?preset=month");
    expect(res.status).toBe(200);

    const [started] = memory.sink.find("REPORT_GENERATION_STARTED");
    const [completed] = memory.sink.find("REPORT_GENERATION_COMPLETED");
    const [request] = memory.sink.find("HTTP_REQUEST_COMPLETED");
    expect(started).toMatchObject({ level: "DEBUG", module: "reports", layer: "server", metadata: { report: "time_and_money" } });
    expect(completed).toMatchObject({ level: "INFO", module: "reports", metadata: { report: "time_and_money" } });
    expect(typeof completed.duration_ms).toBe("number");
    expect(typeof completed.metadata.recordCount).toBe("number");
    const range = completed.metadata.dateRange as { from: string; to: string };
    expect(Date.parse(range.from)).toBeLessThan(Date.parse(range.to));
    expect(completed.request_id).toBe(request.request_id);
    expect(completed.user_id).toBe(request.user_id);
    expect(memory.sink.find("REPORT_SLOW")).toEqual([]);

    // The response holds the report's figures; the log holds none of them, and none of what the person wrote.
    const written = JSON.stringify(memory.sink.records);
    for (const secret of ["محرمانه", "hourlyValue", "netWorth", "hiddenCost", "timeByCategory", "totalDurationMin"]) expect(written).not.toContain(secret);
  });

  it("adds REPORT_SLOW when the report takes at least SLOW_REPORT_THRESHOLD_MS", async () => {
    await server.registerUser();
    process.env.SLOW_REPORT_THRESHOLD_MS = "0";
    memory.sink.clear();
    expect((await server.web("GET", "/api/reports?preset=week")).status).toBe(200);
    expect(memory.sink.find("REPORT_SLOW")[0]).toMatchObject({ level: "WARN", metadata: { report: "time_and_money", thresholdMs: 0 } });
    expect((await server.web("GET", "/api/reports/category-calendar")).status).toBe(200);
    expect(memory.sink.find("REPORT_SLOW").map((r) => r.metadata.report)).toEqual(["time_and_money", "category_calendar"]);
  });

  it("a refused range is a validation problem, not a report failure", async () => {
    await server.registerUser();
    memory.sink.clear();
    const res = await server.web("GET", "/api/reports?from=2026-09-10T00:00:00.000Z&to=2026-09-01T00:00:00.000Z");
    expect(res.status).toBe(400);
    expect(memory.sink.find("REPORT_GENERATION_FAILED")).toEqual([]);
    expect(memory.sink.find("REPORT_GENERATION_STARTED")).toEqual([]);
  });
});

describe("backups", () => {
  it("writes how long the browser says a backup or restore took, and refuses a duration that makes no sense", async () => {
    await server.registerUser();
    memory.sink.clear();
    expect((await server.web("POST", "/api/backup/record", { kind: "export", rows: 5, tables: { Task: 5 }, durationMs: 812 })).status).toBe(200);
    expect((await server.web("POST", "/api/backup/record", { kind: "import", rows: 4, tables: { Task: 4 }, unchanged: 0, rejected: 0, durationMs: 40 })).status).toBe(200);
    expect(memory.sink.find("BACKUP_COMPLETED")[0]).toMatchObject({ level: "INFO", duration_ms: 812, metadata: { rows: 5 } });
    expect(memory.sink.find("RESTORE_COMPLETED")[0]).toMatchObject({ duration_ms: 40 });
    expect((await server.web("POST", "/api/backup/record", { kind: "export", rows: 1, tables: {}, durationMs: -1 })).status).toBe(400);
    expect((await server.web("POST", "/api/backup/record", { kind: "export", rows: 1, tables: {}, durationMs: 99_999_999 })).status).toBe(400);
  });
});

describe("sync", () => {
  it("logs what a push did as counts and kinds of refusal — never the rows or the refused values", async () => {
    await server.registerUser();
    memory.sink.clear();
    const now = new Date().toISOString();
    const good = { id: "sync-ok-1", title: "کار همگام‌شدهٔ محرمانه", status: "TODO", valueType: "EXPENSE", directCost: 0, incomeAmount: 0, createdAt: now, updatedAt: now };
    const badDate = { id: "sync-bad-1", title: "دیگری", status: "TODO", valueType: "EXPENSE", directCost: 0, incomeAmount: 0, createdAt: "تاریخ-محرمانه", updatedAt: now };
    const noId = { title: "بدون شناسه" };

    const res = await server.web("POST", "/api/sync/push", { tables: { Task: [good, badDate, noId] } });
    expect(res.status).toBe(200);
    expect(res.json.results.Task).toMatchObject({ upserted: 1, rejected: 2 });

    const [partial] = memory.sink.find("SYNC_PARTIAL_SUCCESS");
    expect(partial).toMatchObject({ level: "WARN", module: "sync", metadata: { counts: { upserted: 1, rejected: 2 }, tables: { Task: { upserted: 1, skipped: 0, rejected: 2 } } } });
    expect(Object.keys(partial.metadata.rejections as object)).toEqual(expect.arrayContaining(["Task: createdAt: not a valid date", "Task: missing id"]));
    const written = JSON.stringify(memory.sink.records);
    for (const secret of ["محرمانه", "sync-ok-1", "sync-bad-1", "بدون شناسه", "تاریخ"]) expect(written).not.toContain(secret);
  });

  it("logs a pull as counts per table", async () => {
    await server.registerUser();
    await server.web("POST", "/api/tasks", { title: "برای همگام‌سازی" });
    memory.sink.clear();
    const res = await server.web("GET", "/api/sync/pull");
    expect(res.status).toBe(200);
    const [pulled] = memory.sink.find("SYNC_PULL_SUCCESS");
    expect(pulled).toMatchObject({ level: "INFO", metadata: { direction: "pull", incremental: false, tables: { Task: 1 } } });
    expect(JSON.stringify(memory.sink.records)).not.toContain("برای همگام");
  });

  it("ties the server's records to the phone's own ids when the phone sends them", async () => {
    const { token } = await server.registerUser();
    const sync = newId("sync");
    const device = newId("dev");
    const traceId = newTraceId();
    memory.sink.clear();

    const res = await fetch("http://server.local/api/sync/pull", {
      headers: { authorization: `Bearer ${token}`, "x-parva-sync-id": sync, "x-parva-device-id": device, traceparent: `00-${traceId}-${newSpanId()}-01` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toMatch(/^req_/);

    expect(memory.sink.records.length).toBeGreaterThan(0);
    for (const record of memory.sink.records) {
      expect(record.sync_id).toBe(sync);
      expect(record.device_id).toBe(device);
      expect(record.trace_id).toBe(traceId);
    }
    expect(memory.sink.find("SYNC_PULL_SUCCESS")).toHaveLength(1);
  });
});
