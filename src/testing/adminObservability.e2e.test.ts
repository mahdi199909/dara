// The owner's window into the running server, against the real route handlers and a real database: the log levels that
// can be changed without a restart, the health view, the support timeline read from the log files, and the metrics
// endpoint — who may use each, what each leaves behind, and what none of them ever shows.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { resetAdminLogging } from "@/lib/observability/server/adminLogging";
import { installRecentProblems, resetRecentProblems } from "@/lib/observability/server/recentProblems";
import { getServerLogSinks, startServerLogSinks } from "@/lib/observability/server/serverSinks";
import { installMemoryLogger } from "@/lib/observability/testing";
import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;
let memory: ReturnType<typeof installMemoryLogger>;
let logDir: string | null = null;

const unique = () => Math.random().toString(36).slice(2, 10);
const METRICS_TOKEN = "e2e-metrics-token-0123456789abcdef";

beforeAll(async () => {
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  resetAdminLogging();
  memory = installMemoryLogger({ level: "DEBUG" });
  installRecentProblems(memory.core);
});
afterEach(async () => {
  const sinks = getServerLogSinks();
  if (sinks) {
    await sinks.flush(); // nothing may be left queued to land in a folder that is about to disappear
    sinks.dispose();
  }
  if (logDir) rmSync(logDir, { recursive: true, force: true });
  logDir = null;
  resetRecentProblems();
  resetAdminLogging();
  memory.restore();
  delete process.env.ADMIN_EMAIL;
  delete process.env.METRICS_TOKEN;
});

async function asOwner() {
  const owner = await server.registerUser(`owner-${unique()}@example.test`);
  process.env.ADMIN_EMAIL = owner.email;
  return owner;
}

function withLogFile() {
  logDir = mkdtempSync(path.join(tmpdir(), "parva-admin-logs-"));
  return startServerLogSinks({ core: memory.core, env: { LOG_FILE_DIR: logDir }, onInternalProblem: () => {} });
}

const levelOf = (module: string) => memory.core.levels.effectiveLevel({ module });
/** The database is shared by every test in this file, so a count is only meaningful against the one taken before. */
const levelAudits = () => server.prisma.auditLog.count({ where: { event: "LOG_LEVEL_ADMIN_UPDATED" } });

describe("who may use them", () => {
  const CALLS: Array<[string, string, unknown?]> = [
    ["GET", "/api/admin/logging"],
    ["PUT", "/api/admin/logging", { kind: "scope", key: "SYNC", level: "DEBUG" }],
    ["DELETE", "/api/admin/logging?all=1"],
    ["GET", "/api/admin/health"],
    ["GET", "/api/admin/logs"],
  ];

  it("refuses anyone who is not the owner, with the code for it, and changes nothing", async () => {
    await asOwner();
    const stranger = await server.registerUser(`stranger-${unique()}@example.test`);
    server.setWebSession(stranger.token);
    const audited = await levelAudits();
    for (const [method, url, body] of CALLS) {
      const res = await server.web(method, url, body);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.json.code).toBe("AUTH-004");
    }
    expect(levelOf("sync")).toBe("DEBUG"); // the refused PUT changed nothing
    expect(await levelAudits()).toBe(audited);
    expect(memory.sink.find("AUTH_FORBIDDEN").length).toBeGreaterThanOrEqual(CALLS.length);
  });

  it("refuses a request with no session at all", async () => {
    await asOwner();
    server.setWebSession(undefined);
    for (const [method, url, body] of CALLS) expect((await server.web(method, url, body)).status, `${method} ${url}`).toBe(401);
  });
});

describe("changing log levels while the server runs", () => {
  it("shows what is in force, what may be chosen, and the limits", async () => {
    await asOwner();
    const res = await server.web("GET", "/api/admin/logging");
    expect(res.status).toBe(200);
    expect(res.json.state).toMatchObject({ base: "DEBUG", configuredBase: "DEBUG", users: [] });
    expect(res.json.levels).toEqual(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"]);
    expect(res.json.scopes).toContain("SYNC");
    expect(res.json.limits).toEqual({ defaultTtlMinutes: 30, maxTtlMinutes: 1440 });
  });

  it("turns one component up for a limited time — and leaves who did it, and what changed, in the history", async () => {
    const owner = await asOwner();
    await server.web("PUT", "/api/admin/logging", { kind: "scope", key: "TASKS", level: "WARN" }); // something quiet, to show the others are left alone
    expect(levelOf("sync")).toBe("DEBUG");

    const res = await server.web("PUT", "/api/admin/logging", { kind: "scope", key: "sync", level: "trace", ttlMinutes: 15 });
    expect(res.status).toBe(200);
    expect(res.json.applied).toEqual({ kind: "scope", scope: "SYNC", level: "TRACE", ttlMinutes: 15 });
    expect(res.json.state.overrides).toMatchObject([{ scope: "TASKS", level: "WARN" }, { scope: "SYNC", level: "TRACE", configured: false }]);
    expect(levelOf("sync")).toBe("TRACE");
    expect(levelOf("tasks")).toBe("WARN"); // the others keep their level
    expect(levelOf("finance")).toBe("DEBUG");

    const rows = (await server.prisma.auditLog.findMany({ where: { event: "LOG_LEVEL_ADMIN_UPDATED", userId: owner.userId }, orderBy: { createdAt: "asc" } })) as Array<{ metadata: string; changes: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ userId: owner.userId, action: "ADMIN_LOG_LEVEL_UPDATE", entityType: "LogSettings", entityId: "runtime", source: "admin" });
    expect(JSON.parse(rows[1].metadata)).toEqual({ kind: "scope", scope: "SYNC", level: "TRACE", ttlMinutes: 15 });
    expect(rows[1].changes).toContain("scope:SYNC");
    expect(memory.sink.find("LOG_LEVEL_CHANGED").map((r) => r.metadata.scope)).toEqual(["TASKS", "SYNC"]);
  });

  it("makes a verbose level expire even when no time was given", async () => {
    await asOwner();
    await server.web("PUT", "/api/admin/logging", { kind: "base", level: "WARN" });
    const res = await server.web("PUT", "/api/admin/logging", { kind: "scope", key: "SYNC", level: "TRACE" });
    expect(res.json.applied.ttlMinutes).toBe(30);
    expect(res.json.state.overrides[0].expiresAt).not.toBeNull();
    const quiet = await server.web("PUT", "/api/admin/logging", { kind: "scope", key: "TASK", level: "ERROR" });
    expect(quiet.json.applied.ttlMinutes).toBeNull();
  });

  it("refuses what makes no sense, with the validation code, and changes nothing", async () => {
    await asOwner();
    const audited = await levelAudits();
    const bad = [
      { kind: "scope", key: "SYNC", level: "LOUD" },
      { kind: "scope", key: "no spaces allowed", level: "DEBUG" },
      { kind: "scope", key: "SYNC", level: "DEBUG", ttlMinutes: 100_000 },
      { kind: "scope", key: "SYNC", level: "DEBUG", ttlMinutes: 0 },
      { kind: "elsewhere", level: "DEBUG" },
      { level: "DEBUG" },
    ];
    for (const body of bad) {
      const res = await server.web("PUT", "/api/admin/logging", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.code).toBe("VAL-001");
    }
    expect(await levelAudits()).toBe(audited);
  });

  it("traces one person, who must exist", async () => {
    const owner = await asOwner();
    const person = await server.registerUser(`person-${unique()}@example.test`);
    server.setWebSession(owner.token);

    const unknown = await server.web("PUT", "/api/admin/logging", { kind: "user", userId: "no-such-user", level: "DEBUG" });
    expect(unknown.status).toBe(404);
    const ok = await server.web("PUT", "/api/admin/logging", { kind: "user", userId: person.userId, level: "DEBUG", ttlMinutes: 10 });
    expect(ok.status).toBe(200);
    expect(ok.json.state.users).toMatchObject([{ userId: person.userId, level: "DEBUG" }]);
    expect(JSON.stringify(memory.sink.records)).not.toContain(person.email);
  });

  it("puts one component, one person or everything back", async () => {
    await asOwner();
    const audited = await levelAudits();
    await server.web("PUT", "/api/admin/logging", { kind: "base", level: "WARN" });
    await server.web("PUT", "/api/admin/logging", { kind: "scope", key: "SYNC", level: "DEBUG" });
    await server.web("PUT", "/api/admin/logging", { kind: "scope", key: "TASK", level: "ERROR" });

    const one = await server.web("DELETE", "/api/admin/logging?scope=sync");
    expect(one.status).toBe(200);
    expect(one.json.state.overrides.map((rule: { scope: string }) => rule.scope)).toEqual(["TASK"]);

    const all = await server.web("DELETE", "/api/admin/logging?all=1");
    expect(all.json.state).toMatchObject({ base: "DEBUG", overrides: [], users: [], baseExpiresAt: null });
    expect(levelOf("sync")).toBe("DEBUG");
    expect((await levelAudits()) - audited).toBe(5);
  });

  it("wants to know what to put back", async () => {
    await asOwner();
    const res = await server.web("DELETE", "/api/admin/logging");
    expect(res.status).toBe(400);
  });
});

describe("the health view", () => {
  it("counts what the server has done, names what just went wrong, and shows no one", async () => {
    await asOwner();
    const ghost = `ghost-${unique()}@example.test`;
    const refused = await server.web("POST", "/api/auth/login", { email: ghost, password: "nope" });
    expect(refused.status).toBe(401);
    await server.web("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: "secret123" });

    const res = await server.web("GET", "/api/admin/health");
    expect(res.status).toBe(200);
    const health = res.json;
    expect(health.requests.total).toBeGreaterThanOrEqual(3);
    expect(health.requests.clientErrors).toBeGreaterThanOrEqual(1);
    expect(health.requests.errorRate).toBeGreaterThanOrEqual(0);
    expect(health.auth.login_failed).toBeGreaterThanOrEqual(1);
    expect(health.database.queries).toBeGreaterThan(0);
    expect(health.logging.levels).toMatchObject({ base: "DEBUG" });
    expect(health.logging.recentProblems.map((p: { event: string }) => p.event)).toContain("AUTH_LOGIN_FAILED");
    expect(health.logging.recentProblems.find((p: { event: string }) => p.event === "AUTH_LOGIN_FAILED")).toMatchObject({ level: "WARN", errorCode: "AUTH-001", requestId: refused.json.requestId });
    expect(health.logging.sinks).toBeNull(); // no file or collector configured here
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(health)).not.toContain(ghost);
  });

  it("describes the file and the collector queues once they are configured", async () => {
    await asOwner();
    withLogFile();
    const res = await server.web("GET", "/api/admin/health");
    expect(res.json.logging.sinks.file).toMatchObject({ retentionDays: 14, queue: { circuit: "closed" } });
    expect(res.json.logging.sinks.remote).toBeUndefined();
  });
});

describe("the metrics endpoint", () => {
  const scrape = (authorization?: string) => fetch("http://server.local/api/metrics", { headers: authorization ? { authorization } : {} });

  it("does not exist until METRICS_TOKEN is set", async () => {
    const res = await scrape(`Bearer ${METRICS_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it("stays off for a token that is too short to be safe", async () => {
    process.env.METRICS_TOKEN = "short";
    expect((await scrape("Bearer short")).status).toBe(404);
    expect(memory.sink.find("LOG_INTERNAL_ERROR").some((r) => r.message.includes("METRICS_TOKEN"))).toBe(true);
  });

  it("answers only to its bearer token, and records a refusal as an invalid session", async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    const none = await scrape();
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect((await scrape("Bearer not-the-token")).status).toBe(401);
    expect(memory.sink.find("AUTH_SESSION_INVALID").length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(memory.sink.records)).not.toContain(METRICS_TOKEN);
  });

  it("prints the counters and timings in the Prometheus format, and nothing about anyone", async () => {
    process.env.METRICS_TOKEN = METRICS_TOKEN;
    const owner = await asOwner();
    await server.web("GET", "/api/admin/health");
    const res = await scrape(`Bearer ${METRICS_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).toMatch(/# TYPE http_requests_total counter\n/);
    expect(text).toMatch(/http_requests_total\{method="GET",route="\/api\/admin\/health",status="2xx"\} \d+/);
    expect(text).toMatch(/http_request_duration_ms_bucket\{method="GET",route="\/api\/admin\/health",le="\d+"\} \d+/);
    expect(text).toMatch(/process_uptime_seconds \d+/);
    expect(text).toContain("auth_events_total");
    for (const secret of [owner.email, owner.userId, METRICS_TOKEN]) expect(text).not.toContain(secret);
  });
});

describe("the support timeline", () => {
  it("says so when the server keeps no log file", async () => {
    await asOwner();
    const res = await server.web("GET", "/api/admin/logs");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ available: false, records: [] });
    expect(res.json.reason).toContain("LOG_FILE_DIR");
  });

  it("tells one person's story oldest first — by account id or by address — without what they wrote or their address", async () => {
    const owner = await asOwner();
    withLogFile();
    const alice = await server.registerUser(`alice-${unique()}@example.test`);
    await server.mustWeb("POST", "/api/tasks", { title: "کار کاملاً محرمانهٔ آلیس" });
    await server.web("POST", "/api/auth/login", { email: `ghost-${unique()}@example.test`, password: "nope" }); // someone else's story
    server.setWebSession(owner.token);

    const byId = await server.web("GET", `/api/admin/logs?user=${alice.userId}`);
    expect(byId.status).toBe(200);
    expect(byId.json).toMatchObject({ available: true, targetUserId: alice.userId });
    const records = byId.json.records as Array<{ timestamp: string; event: string; userId: string; requestId: string }>;
    expect(records.map((r) => r.event)).toEqual(expect.arrayContaining(["AUTH_REGISTER_SUCCESS", "TASK_CREATE_SUCCESS", "HTTP_REQUEST_COMPLETED"]));
    expect(records.every((r) => r.userId === alice.userId)).toBe(true);
    expect([...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp))).toEqual(records);
    expect(records.some((r) => r.event === "AUTH_LOGIN_FAILED")).toBe(false);

    const byAddress = await server.web("GET", `/api/admin/logs?user=${encodeURIComponent(alice.email)}`);
    expect(byAddress.json.records.map((r: { event: string }) => r.event)).toEqual(records.map((r) => r.event));

    const everything = JSON.stringify([byId.json, byAddress.json]);
    expect(everything).not.toContain("محرمانه");
    expect(everything).not.toContain(alice.email);
  });

  it("finds a failed sign-in by the address that was tried, even though it is no account", async () => {
    const owner = await asOwner();
    withLogFile();
    const ghost = `ghost-${unique()}@example.test`;
    const failed = await server.web("POST", "/api/auth/login", { email: ghost, password: "nope" });
    server.setWebSession(owner.token);

    const res = await server.web("GET", `/api/admin/logs?user=${encodeURIComponent(ghost)}`);
    expect(res.json.targetUserId).toBeUndefined();
    const events = res.json.records.map((r: { event: string }) => r.event);
    expect(events).toContain("AUTH_LOGIN_FAILED");
    expect(JSON.stringify(res.json)).not.toContain(ghost);

    const byRequest = await server.web("GET", `/api/admin/logs?request=${failed.json.requestId}`);
    expect(byRequest.json.records.length).toBeGreaterThanOrEqual(2);
    expect(byRequest.json.records.every((r: { requestId: string }) => r.requestId === failed.json.requestId)).toBe(true);
    expect(byRequest.json.records.map((r: { event: string }) => r.event)).toEqual(expect.arrayContaining(["AUTH_LOGIN_FAILED", "HTTP_REQUEST_COMPLETED"]));
  });

  it("narrows by event, level and how many, and says when it stopped short", async () => {
    const owner = await asOwner();
    withLogFile();
    const alice = await server.registerUser(`alice-${unique()}@example.test`);
    for (let i = 0; i < 3; i++) await server.mustWeb("POST", "/api/tasks", { title: `کار ${i}` });
    await server.web("POST", "/api/auth/login", { email: `ghost-${unique()}@example.test`, password: "nope" });
    server.setWebSession(owner.token);

    const tasks = await server.web("GET", `/api/admin/logs?user=${alice.userId}&event=TASK_*`);
    expect(tasks.json.records.length).toBeGreaterThanOrEqual(3);
    expect(tasks.json.records.every((r: { event: string }) => r.event.startsWith("TASK_"))).toBe(true);

    const warnings = await server.web("GET", "/api/admin/logs?level=warn&event=AUTH_*");
    expect(warnings.json.records.length).toBeGreaterThanOrEqual(1);
    expect(warnings.json.records.every((r: { level: string }) => ["WARN", "ERROR", "CRITICAL"].includes(r.level))).toBe(true);

    const one = await server.web("GET", `/api/admin/logs?user=${alice.userId}&limit=1`);
    expect(one.json.records).toHaveLength(1);
    expect(one.json.truncated).toBe(true);
  });

  it("refuses a filter it cannot read", async () => {
    await asOwner();
    withLogFile();
    expect((await server.web("GET", "/api/admin/logs?level=loud")).status).toBe(400);
    expect((await server.web("GET", "/api/admin/logs?since=yesterday")).status).toBe(400);
    expect((await server.web("GET", "/api/admin/logs?until=whenever")).status).toBe(400);
  });

  it("writes down that the log was read — which filters, never what came back", async () => {
    const owner = await asOwner();
    withLogFile();
    const alice = await server.registerUser(`alice-${unique()}@example.test`);
    await server.mustWeb("POST", "/api/tasks", { title: "یک کار" });
    server.setWebSession(owner.token);
    memory.sink.clear();

    await server.web("GET", `/api/admin/logs?user=${alice.userId}&event=TASK_*&level=info`);
    const [queried] = memory.sink.find("LOG_QUERIED");
    expect(queried).toMatchObject({ level: "INFO", metadata: { by: owner.userId, targetUserId: alice.userId } });
    expect(queried.metadata.filters).toEqual(expect.arrayContaining(["userId", "event", "minLevel", "sinceMs"]));
    expect(queried.metadata.matched).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(queried)).not.toContain("TASK_CREATE_SUCCESS"); // the filters, not the results
  });
});
