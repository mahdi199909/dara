// End-to-end check of the audit trail on the real routes: the actual route handlers, a real Prisma client
// on a real SQLite database, the shared logger routed into memory. It asserts what History and a support
// investigation depend on — every row says which request wrote it and which fact it records, an update
// carries its diff, money follows the configured policy, the owner-only routes leave a trail, backups are
// reported, old entries are pruned — and that the screen's own API still returns what it always did.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { installMemoryLogger } from "@/lib/observability/testing";
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
  delete process.env.AUDIT_MONEY_MODE;
  delete process.env.ADMIN_EMAIL;
});

const unique = () => Math.random().toString(36).slice(2, 10);

/** The completion record of the nth request of that shape, and the audit rows that request wrote. */
async function auditedBy(method: string, path: string, nth = 0) {
  const completion = memory.sink.find("HTTP_REQUEST_COMPLETED").filter((record) => record.method === method && record.path === path)[nth];
  expect(completion, `no completion record for ${method} ${path}`).toBeDefined();
  const rows = await server.prisma.auditLog.findMany({ where: { requestId: completion.request_id }, orderBy: { createdAt: "asc" } });
  return { completion, rows };
}

describe("a task's history", () => {
  it("names the request that wrote each entry, the fact it records and, for an update, exactly what changed", async () => {
    await server.registerUser();
    memory.sink.clear();

    const created = await server.web("POST", "/api/tasks", { title: "کار محرمانهٔ اول" });
    expect(created.status).toBe(201);
    const { completion, rows } = await auditedBy("POST", "/api/tasks");
    const createRow = rows.find((row: { entityType: string }) => row.entityType === "Task");
    expect(createRow).toMatchObject({ action: "CREATE", event: "TASK_CREATED", source: "api", requestId: completion.request_id, traceId: completion.trace_id, changes: null });
    const taskId = createRow.entityId as string;

    // The application log says the operation succeeded — after the write, with the same request id and ids only.
    const [createdLine] = memory.sink.find("TASK_CREATE_SUCCESS");
    expect(createdLine).toMatchObject({ level: "INFO", entity_type: "Task", entity_id: taskId, request_id: completion.request_id, layer: "server" });

    memory.sink.clear();
    const renamed = await server.web("PATCH", `/api/tasks/${taskId}`, { title: "عنوان تازه‌ی محرمانه" });
    expect(renamed.status).toBe(200);
    const update = await auditedBy("PATCH", `/api/tasks/${taskId}`);
    const updateRow = update.rows.find((row: { entityType: string }) => row.entityType === "Task");
    expect(updateRow).toMatchObject({ action: "UPDATE", event: "TASK_UPDATED", requestId: update.completion.request_id });
    const diff = JSON.parse(updateRow.changes);
    expect(diff.changedFields).toEqual(["title"]);
    expect(diff.changes.title).toEqual({ from: "کار محرمانهٔ اول", to: "عنوان تازه‌ی محرمانه" });
    // the legacy snapshots are still there, whole
    expect(JSON.parse(updateRow.oldValue).title).toBe("کار محرمانهٔ اول");
    expect(JSON.parse(updateRow.newValue).title).toBe("عنوان تازه‌ی محرمانه");
    // …and none of the text reached the application log
    expect(JSON.stringify(memory.sink.records)).not.toContain("محرمانه");
    expect(memory.sink.find("TASK_UPDATE_SUCCESS")[0].metadata.changedFields).toEqual(["title"]);

    memory.sink.clear();
    await server.web("PATCH", `/api/tasks/${taskId}`, { status: "DONE" });
    const done = await auditedBy("PATCH", `/api/tasks/${taskId}`);
    expect(done.rows.find((row: { entityType: string }) => row.entityType === "Task")).toMatchObject({ action: "COMPLETE_TASK", event: "TASK_COMPLETED" });
    expect(memory.sink.find("TASK_COMPLETE_SUCCESS")).toHaveLength(1);

    memory.sink.clear();
    await server.web("DELETE", `/api/tasks/${taskId}`);
    const removed = await auditedBy("DELETE", `/api/tasks/${taskId}`);
    expect(removed.rows.find((row: { entityType: string }) => row.entityType === "Task")).toMatchObject({ action: "DELETE", event: "TASK_DELETED", changes: null });
  });

  it("still answers the History screen's own request exactly as before, with the new fields alongside", async () => {
    await server.registerUser();
    await server.web("POST", "/api/tasks", { title: "برای سابقه" });
    await server.web("POST", "/api/accounts", { name: "حساب سابقه" });

    const all = await server.web("GET", "/api/audit-logs");
    expect(all.status).toBe(200);
    expect(Array.isArray(all.json.logs)).toBe(true);
    for (const log of all.json.logs) {
      for (const legacy of ["id", "userId", "action", "entityType", "entityId", "oldValue", "newValue", "ipAddress", "userAgent", "metadata", "createdAt"]) expect(log, legacy).toHaveProperty(legacy);
      for (const added of ["event", "source", "requestId", "traceId", "deviceId", "localEventId", "changes"]) expect(log, added).toHaveProperty(added);
    }
    const actions = all.json.logs.map((log: { action: string }) => log.action);
    expect(actions).toEqual(expect.arrayContaining(["REGISTER", "CREATE"]));
    // newest first, as the screen expects
    const times = all.json.logs.map((log: { createdAt: string }) => log.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    const onlyTasks = await server.web("GET", "/api/audit-logs?entityType=Task");
    expect(onlyTasks.json.logs.length).toBeGreaterThan(0);
    expect(onlyTasks.json.logs.every((log: { entityType: string }) => log.entityType === "Task")).toBe(true);
  });
});

describe("money in the history", () => {
  it("keeps the real amount by default — the entry sits beside the transaction that holds it", async () => {
    await server.registerUser();
    memory.sink.clear();
    const created = await server.web("POST", "/api/accounts", { name: "حساب یک", initialBalance: 987654 });
    expect(created.status).toBe(201);
    const { rows } = await auditedBy("POST", "/api/accounts");
    expect(rows[0]).toMatchObject({ action: "CREATE", entityType: "FinanceAccount", event: "ACCOUNT_CREATED" });
    expect(JSON.parse(rows[0].newValue).initialBalance).toBe(987654);
    // The application log never has it, whatever the policy.
    expect(JSON.stringify(memory.sink.records)).not.toContain("987654");
  });

  it("masks it in the entry when the operator asks for that", async () => {
    await server.registerUser();
    process.env.AUDIT_MONEY_MODE = "redacted";
    memory.sink.clear();
    await server.web("POST", "/api/accounts", { name: "حساب دو", initialBalance: 123456 });
    const { rows } = await auditedBy("POST", "/api/accounts");
    expect(rows[0].newValue).toContain("[REDACTED_MONEY]");
    expect(rows[0].newValue).not.toContain("123456");
    expect(JSON.parse(rows[0].newValue).name).toBe("حساب دو"); // only the money is masked
  });

  it("records an account rename as a one-field diff (bookkeeping fields are not changes)", async () => {
    await server.registerUser();
    const created = await server.web("POST", "/api/accounts", { name: "قدیمی" });
    memory.sink.clear();
    await server.web("PATCH", `/api/accounts/${created.json.account.id}`, { name: "جدید" });
    const { rows } = await auditedBy("PATCH", `/api/accounts/${created.json.account.id}`);
    expect(rows[0]).toMatchObject({ action: "UPDATE", event: "ACCOUNT_UPDATED" });
    const diff = JSON.parse(rows[0].changes);
    expect(diff.changedFields).toEqual(["name"]);
    expect(diff.changes.name).toEqual({ from: "قدیمی", to: "جدید" });
  });
});

describe("routes that used to leave no trace", () => {
  it("reordering categories is a history entry with the count, and a success line in the log", async () => {
    await server.registerUser();
    const listed = await server.web("GET", "/api/categories");
    const ids = (listed.json.categories as Array<{ id: string }>).map((category) => category.id);
    expect(ids.length).toBeGreaterThan(1);
    memory.sink.clear();

    const reordered = await server.web("PATCH", "/api/categories/reorder", { orderedIds: [...ids].reverse() });
    expect(reordered.status).toBe(200);
    const { completion, rows } = await auditedBy("PATCH", "/api/categories/reorder");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "REORDER", entityType: "Category", event: "CATEGORIES_REORDERED", requestId: completion.request_id });
    expect(JSON.parse(rows[0].metadata)).toEqual({ count: ids.length });
    expect(memory.sink.find("CATEGORY_REORDER_SUCCESS")).toHaveLength(1);
  });

  it("an owner's change to someone else's subscription is recorded against the owner, without the address", async () => {
    const target = await server.registerUser(`target-${unique()}@example.test`);
    const owner = await server.registerUser(`owner-${unique()}@example.test`);
    process.env.ADMIN_EMAIL = owner.email;
    memory.sink.clear();

    const first = await server.web("PATCH", "/api/admin/license", { email: target.email, status: "SUBSCRIBED", months: 3 });
    expect(first.status).toBe(200);
    const second = await server.web("PATCH", "/api/admin/license", { email: target.email, status: "LIFETIME" });
    expect(second.status).toBe(200);

    const rows = await server.prisma.auditLog.findMany({ where: { event: "LICENSE_ADMIN_UPDATED" }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ userId: owner.userId, action: "ADMIN_LICENSE_UPDATE", entityType: "License", source: "admin" });
      expect(JSON.parse(row.metadata)).toEqual({ targetUserId: target.userId });
    }
    expect(JSON.parse(rows[1].changes).changes.status).toEqual({ from: "SUBSCRIBED", to: "LIFETIME" });
    const stored = JSON.stringify(rows) + JSON.stringify(memory.sink.records);
    expect(stored).not.toContain(target.email);
  });

  it("a request from someone who is not the owner is refused and leaves no history entry", async () => {
    const target = await server.registerUser(`target-${unique()}@example.test`);
    const owner = await server.registerUser(`owner-${unique()}@example.test`);
    process.env.ADMIN_EMAIL = owner.email;
    server.setWebSession(target.token);
    const before = await server.prisma.auditLog.count({ where: { event: "LICENSE_ADMIN_UPDATED" } });

    const refused = await server.web("PATCH", "/api/admin/license", { email: owner.email, status: "FREE" });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe("AUTH-004");
    expect(await server.prisma.auditLog.count({ where: { event: "LICENSE_ADMIN_UPDATED" } })).toBe(before);
    expect(memory.sink.find("AUTH_FORBIDDEN")).toHaveLength(1);
  });

  it("a change to what the installed apps are told about updates is recorded, with what it was before", async () => {
    const owner = await server.registerUser(`owner-${unique()}@example.test`);
    process.env.ADMIN_EMAIL = owner.email;
    const saved = await server.web("PATCH", "/api/admin/release", { latestVersionCode: 10100, minSupportedVersionCode: 10000, downloadUrl: "" });
    expect(saved.status).toBe(200);
    const [row] = await server.prisma.auditLog.findMany({ where: { event: "RELEASE_ADMIN_UPDATED" }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(row).toMatchObject({ userId: owner.userId, action: "ADMIN_RELEASE_UPDATE", entityType: "AppRelease", entityId: "singleton", source: "admin" });
    const diff = JSON.parse(row.changes);
    expect(diff.changes.latestVersionCode).toEqual({ from: 1, to: 10100 });
    expect(diff.changes.minSupportedVersionCode).toEqual({ from: 1, to: 10000 });
  });
});

describe("backups made in the browser", () => {
  it("are reported as counts: an export, a complete restore and a partial one", async () => {
    await server.registerUser();
    memory.sink.clear();

    const exported = await server.web("POST", "/api/backup/record", { kind: "export", rows: 5, tables: { Task: 3, Habit: 2 } });
    expect(exported.status).toBe(200);
    const restored = await server.web("POST", "/api/backup/record", { kind: "import", rows: 4, tables: { Task: 4 }, unchanged: 2, rejected: 0 });
    expect(restored.status).toBe(200);
    const partial = await server.web("POST", "/api/backup/record", { kind: "import", rows: 3, tables: { Task: 3 }, unchanged: 0, rejected: 2 });
    expect(partial.status).toBe(200);

    const rows = await server.prisma.auditLog.findMany({ where: { entityType: "Backup" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row: { event: string }) => row.event)).toEqual(["BACKUP_EXPORTED", "BACKUP_IMPORTED", "BACKUP_IMPORTED"]);
    expect(JSON.parse(rows[0].metadata)).toEqual({ rows: 5, tables: { Task: 3, Habit: 2 }, via: "web" });
    expect(JSON.parse(rows[2].metadata)).toMatchObject({ stored: 3, rejected: 2 });

    expect(memory.sink.find("BACKUP_COMPLETED")[0]).toMatchObject({ level: "INFO", metadata: { rows: 5 } });
    expect(memory.sink.find("RESTORE_COMPLETED")).toHaveLength(1);
    expect(memory.sink.find("RESTORE_PARTIAL")[0]).toMatchObject({ level: "WARN", metadata: { rejected: 2 } });
  });

  it("refuse a report that names a table the app does not have, or a negative count, and record nothing", async () => {
    await server.registerUser();
    const before = await server.prisma.auditLog.count({ where: { entityType: "Backup" } });
    const unknownTable = await server.web("POST", "/api/backup/record", { kind: "export", rows: 1, tables: { Secrets: 1 } });
    expect(unknownTable.status).toBe(400);
    expect(unknownTable.json.code).toBe("VAL-001");
    expect((await server.web("POST", "/api/backup/record", { kind: "export", rows: -1, tables: {} })).status).toBe(400);
    expect((await server.web("POST", "/api/backup/record", { kind: "export", tables: {} })).status).toBe(400);
    expect(await server.prisma.auditLog.count({ where: { entityType: "Backup" } })).toBe(before);
  });

  it("need a session", async () => {
    server.setWebSession(undefined);
    const refused = await server.web("POST", "/api/backup/record", { kind: "export", rows: 0, tables: {} });
    expect(refused.status).toBe(401);
  });
});

describe("retention", () => {
  it("prunes entries older than the retention from the real table and keeps everything newer", async () => {
    const { userId } = await server.registerUser();
    const day = 24 * 60 * 60 * 1000;
    const stale = await server.prisma.auditLog.create({ data: { userId, action: "CREATE", entityType: "Task", entityId: "stale", createdAt: new Date(Date.now() - 800 * day) } });
    const staler = await server.prisma.auditLog.create({ data: { userId, action: "CREATE", entityType: "Task", entityId: "staler", createdAt: new Date(Date.now() - 1500 * day) } });
    const fresh = await server.prisma.auditLog.create({ data: { userId, action: "CREATE", entityType: "Task", entityId: "fresh", createdAt: new Date(Date.now() - 100 * day) } });
    memory.sink.clear();

    const { purgeExpiredAuditLogs } = await import("@/lib/auditRetention");
    const result = await purgeExpiredAuditLogs();
    expect(result?.deleted).toBeGreaterThanOrEqual(2);
    expect(await server.prisma.auditLog.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await server.prisma.auditLog.findUnique({ where: { id: staler.id } })).toBeNull();
    expect(await server.prisma.auditLog.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await server.prisma.auditLog.count({ where: { userId, action: "REGISTER" } })).toBe(1); // today's entries are untouched
    expect(memory.sink.find("JOB_COMPLETED")[0]).toMatchObject({ level: "INFO", metadata: { job: "audit-retention" } });
  });

  it("keeps everything when retention is switched off", async () => {
    const { userId } = await server.registerUser();
    const ancient = await server.prisma.auditLog.create({ data: { userId, action: "CREATE", entityType: "Task", createdAt: new Date("2001-01-01T00:00:00Z") } });
    process.env.AUDIT_RETENTION_DAYS = "off";
    try {
      const { purgeExpiredAuditLogs } = await import("@/lib/auditRetention");
      expect(await purgeExpiredAuditLogs()).toBeNull();
    } finally {
      delete process.env.AUDIT_RETENTION_DAYS;
    }
    expect(await server.prisma.auditLog.findUnique({ where: { id: ancient.id } })).not.toBeNull();
  });
});
