import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ auditLog: { create: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { REDACTED_MONEY, newId } from "./observability";
import { installMemoryLogger } from "./observability/testing";
import { beginRequest, runWithRequestContext, setRequestUser } from "./observability/server/requestContext";
import { audit, requestMeta, writeAuditLog } from "./audit";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
  prismaMock.auditLog.create.mockReset();
  prismaMock.auditLog.create.mockResolvedValue({ id: "aud_1" });
});
afterEach(() => {
  memory.restore();
  delete process.env.AUDIT_MONEY_MODE;
});

function storedRow(): Record<string, unknown> {
  return prismaMock.auditLog.create.mock.calls.at(-1)![0].data;
}

const before = { id: "t1", userId: "usr_1", title: "خرید هدیه برای سارا", status: "TODO", amount: 900_000, updatedAt: "2026-09-01T00:00:00.000Z" };
const after = { ...before, title: "خرید هدیه‌ی بهتر", status: "DONE", amount: 1_200_000, updatedAt: "2026-09-20T00:00:00.000Z" };

describe("writeAuditLog", () => {
  it("stores the diff of an update beside the two snapshots, which stay exactly as they always were", async () => {
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after });
    const row = storedRow();
    expect(row).toMatchObject({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", event: "TASK_UPDATED", source: "api" });
    expect(row.oldValue).toBe(JSON.stringify(before));
    expect(row.newValue).toBe(JSON.stringify(after));
    const changes = JSON.parse(row.changes as string);
    expect(changes.changedFields.sort()).toEqual(["amount", "status", "title"]);
    expect(changes.changes.title).toEqual({ from: "خرید هدیه برای سارا", to: "خرید هدیه‌ی بهتر" });
    expect(changes.changes.amount).toEqual({ from: 900_000, to: 1_200_000 });
  });

  it("has no diff for a creation or a deletion", async () => {
    await writeAuditLog({ userId: "usr_1", action: "CREATE", entityType: "Task", entityId: "t1", newValue: after });
    expect(storedRow().changes).toBeNull();
    await writeAuditLog({ userId: "usr_1", action: "DELETE", entityType: "Task", entityId: "t1", oldValue: before });
    expect(storedRow().changes).toBeNull();
  });

  it("puts the operation's success in the application log after the write — ids and field names, never values", async () => {
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after });
    const [success] = memory.sink.find("TASK_UPDATE_SUCCESS");
    expect(success).toMatchObject({ level: "INFO", module: "tasks", component: "writer", layer: "server", entity_type: "Task", entity_id: "t1", operation: "UPDATE" });
    expect((success.metadata.changedFields as string[]).sort()).toEqual(["amount", "status", "title"]);
    expect(success.metadata.auditId).toBe("aud_1");
    const written = JSON.stringify(memory.sink.records);
    expect(written).not.toContain("سارا");
    expect(written).not.toContain("1200000");
  });

  it("links the row to the request that wrote it", async () => {
    const device = newId("dev");
    const context = beginRequest(new Request("http://localhost/api/tasks/t1", { method: "PATCH", headers: { "x-parva-device-id": device } }), "PATCH", "/api/tasks/[id]");
    await runWithRequestContext(context, async () => {
      setRequestUser("usr_1");
      await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after });
    });
    expect(storedRow()).toMatchObject({ requestId: context.requestId, traceId: context.traceId, deviceId: device });
    // …and the same id is on the log line, so one search finds both.
    expect(memory.sink.find("TASK_UPDATE_SUCCESS")[0].request_id).toBe(context.requestId);
  });

  it("writes null request columns when there is no request (a seed, a script)", async () => {
    await writeAuditLog({ userId: "usr_1", action: "CREATE", entityType: "Task", entityId: "t1", newValue: after });
    expect(storedRow()).toMatchObject({ requestId: null, traceId: null, deviceId: null });
  });

  it("records where an admin action came from", async () => {
    await writeAuditLog({ userId: "usr_1", action: "ADMIN_LICENSE_UPDATE", entityType: "License", entityId: "lic_1", source: "admin" });
    expect(storedRow()).toMatchObject({ source: "admin", event: "LICENSE_ADMIN_UPDATED" });
    expect(memory.sink.records.filter((r) => r.level !== "DEBUG").map((r) => r.event)).toEqual([]); // no log-catalogue event for it
  });

  it("still records a pair it has never seen, under a derived name, and says nothing in the log", async () => {
    await writeAuditLog({ userId: "usr_1", action: "ARCHIVE", entityType: "Note", entityId: "n1" });
    expect(storedRow()).toMatchObject({ action: "ARCHIVE", entityType: "Note", event: "NOTE_ARCHIVE" });
    expect(memory.sink.records).toEqual([]);
  });

  it("keeps real money by default", async () => {
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Transaction", entityId: "x1", oldValue: before, newValue: after });
    expect(storedRow().newValue).toContain("1200000");
    expect(JSON.parse(storedRow().changes as string).changes.amount).toEqual({ from: 900_000, to: 1_200_000 });
  });

  it("masks money in both the diff and the snapshots when AUDIT_MONEY_MODE=redacted", async () => {
    process.env.AUDIT_MONEY_MODE = "redacted";
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Transaction", entityId: "x1", oldValue: before, newValue: after });
    const row = storedRow();
    expect(row.oldValue).not.toContain("900000");
    expect(row.newValue).not.toContain("1200000");
    expect(row.newValue).toContain(REDACTED_MONEY);
    expect(JSON.parse(row.changes as string).changes.amount).toEqual({ from: REDACTED_MONEY, to: REDACTED_MONEY });
    // everything that is not money stays readable
    expect(JSON.parse(row.changes as string).changes.status).toEqual({ from: "TODO", to: "DONE" });
  });

  it("reduces money to 'this changed' when AUDIT_MONEY_MODE=flag", async () => {
    process.env.AUDIT_MONEY_MODE = "flag";
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Transaction", entityId: "x1", oldValue: before, newValue: after });
    expect(JSON.parse(storedRow().changes as string).changes.amount).toEqual({ changed: true });
    expect(storedRow().newValue).not.toContain("1200000");
  });

  it("accepts a precomputed diff, and null to say there is none", async () => {
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after, changes: { changedFields: ["status"], changes: { status: { from: "TODO", to: "DONE" } } } });
    expect(JSON.parse(storedRow().changes as string).changedFields).toEqual(["status"]);
    await writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after, changes: null });
    expect(storedRow().changes).toBeNull();
  });

  it("never throws when the database refuses, reports it with ids only, and still logs that the operation succeeded", async () => {
    prismaMock.auditLog.create.mockRejectedValue(new Error("connection refused"));
    await expect(writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after })).resolves.toBeUndefined();
    expect(memory.sink.find("AUDIT_WRITE_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "AUDIT-001", entity_type: "Task", entity_id: "t1", operation: "UPDATE" });
    const [success] = memory.sink.find("TASK_UPDATE_SUCCESS");
    expect(success.metadata.auditId).toBeUndefined(); // there is no audit row to point at
    expect(JSON.stringify(memory.sink.records)).not.toContain("سارا");
  });

  it("never throws for a value that cannot be serialised", async () => {
    const circular: Record<string, unknown> = { id: "t1" };
    circular.self = circular;
    await expect(writeAuditLog({ userId: "usr_1", action: "CREATE", entityType: "Task", entityId: "t1", newValue: circular })).resolves.toBeUndefined();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(memory.sink.find("AUDIT_WRITE_FAILED")).toHaveLength(1);
  });
});

describe("audit.log — the developer-facing facade", () => {
  it("takes the canonical event and stores the legacy action History labels", async () => {
    await audit.log({ userId: "usr_1", event: "CATEGORIES_REORDERED", metadata: { count: 4 } });
    expect(storedRow()).toMatchObject({ userId: "usr_1", action: "REORDER", entityType: "Category", event: "CATEGORIES_REORDERED", metadata: '{"count":4}' });
    expect(memory.sink.find("CATEGORY_REORDER_SUCCESS")).toHaveLength(1);
  });

  it("also accepts a legacy action", async () => {
    await audit.log({ userId: "usr_1", action: "UPDATE", entityType: "Task", entityId: "t1", before, after });
    expect(storedRow()).toMatchObject({ action: "UPDATE", event: "TASK_UPDATED" });
    expect(JSON.parse(storedRow().changes as string).changedFields).toContain("status");
  });

  it("takes the user from the request being handled", async () => {
    const context = beginRequest(new Request("http://localhost/api/categories/reorder", { method: "PATCH" }), "PATCH", "/api/categories/reorder");
    await runWithRequestContext(context, async () => {
      setRequestUser("usr_7");
      await audit.log({ event: "CATEGORIES_REORDERED", metadata: { count: 1 } });
    });
    expect(storedRow()).toMatchObject({ userId: "usr_7", requestId: context.requestId });
  });

  it("takes the caller's address and browser from the request", async () => {
    const req = new Request("http://localhost/api/x", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Parva/1.1" } });
    await audit.log({ userId: "usr_1", event: "CATEGORIES_REORDERED", req });
    expect(storedRow()).toMatchObject({ ipAddress: "203.0.113.9", userAgent: "Parva/1.1" });
  });

  it("does nothing but say so when there is nobody to attribute the entry to", async () => {
    await expect(audit.log({ event: "CATEGORIES_REORDERED" })).resolves.toBeUndefined();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(memory.sink.find("AUDIT_WRITE_FAILED")[0]).toMatchObject({ level: "ERROR", error_code: "AUDIT-001", metadata: { reason: "no signed-in user in this context" } });
  });
});

describe("requestMeta", () => {
  it("prefers the first forwarded address, then x-real-ip, and allows neither", () => {
    expect(requestMeta(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2", "user-agent": "UA" } }))).toEqual({ ipAddress: "1.1.1.1", userAgent: "UA" });
    expect(requestMeta(new Request("http://x", { headers: { "x-real-ip": "3.3.3.3" } }))).toEqual({ ipAddress: "3.3.3.3", userAgent: null });
    expect(requestMeta(new Request("http://x"))).toEqual({ ipAddress: null, userAgent: null });
  });
});
