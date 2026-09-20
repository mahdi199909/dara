import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMemoryLogger } from "@/lib/observability/testing";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { getLocalUserId } from "./localUser";
import { writeLocalAuditLog } from "./audit";
import { listAuditLogs } from "./repositories/auditLogs";

let db: LocalDb;
let userId: string;
let memory: ReturnType<typeof installMemoryLogger>;

beforeEach(async () => {
  resetLocalDbForTests();
  db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  userId = getLocalUserId(db);
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

interface Row {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadata: string | null;
  event: string | null;
  source: string | null;
  requestId: string | null;
  traceId: string | null;
  deviceId: string | null;
  localEventId: string | null;
  changes: string | null;
  createdAt: string;
}

function rows(): Row[] {
  return db.all<Row>(`SELECT * FROM "AuditLog" ORDER BY "createdAt" ASC, "rowid" ASC`);
}

const before = { id: "t1", title: "خرید هدیه برای سارا", status: "TODO", directCost: 900_000, updatedAt: "2026-09-01T00:00:00.000Z" };
const after = { ...before, title: "خرید هدیه‌ی بهتر", status: "DONE", directCost: 1_200_000, updatedAt: "2026-09-20T00:00:00.000Z" };

describe("writeLocalAuditLog", () => {
  it("stores the legacy columns as before, plus the event, the source, a local event id and the diff of an update", () => {
    writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after });
    const [row] = rows();
    expect(row).toMatchObject({ action: "UPDATE", entityType: "Task", entityId: "t1", event: "TASK_UPDATED", source: "local", requestId: null, traceId: null, deviceId: null });
    expect(row.oldValue).toBe(JSON.stringify(before));
    expect(row.newValue).toBe(JSON.stringify(after));
    expect(row.localEventId).toMatch(/^lev_[0-9A-HJKMNP-TV-Z]{26}$/);
    const changes = JSON.parse(row.changes!);
    expect(changes.changedFields.sort()).toEqual(["directCost", "status", "title"]);
    expect(changes.changes.directCost).toEqual({ from: 900_000, to: 1_200_000 }); // the owner's own history keeps real values
  });

  it("has no diff for a creation or a deletion", () => {
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: "t1", newValue: after });
    writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Task", entityId: "t1", oldValue: before });
    expect(rows().map((row) => row.changes)).toEqual([null, null]);
  });

  it("gives every write its own local event id", () => {
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: "t1", newValue: after });
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: "t2", newValue: after });
    const [one, two] = rows();
    expect(one.localEventId).not.toBe(two.localEventId);
  });

  it("puts the same local event id on the operation's success line in the application log", () => {
    writeLocalAuditLog(db, { userId, action: "COMPLETE_TASK", entityType: "Task", entityId: "t1", oldValue: before, newValue: after });
    const [row] = rows();
    const [success] = memory.sink.find("TASK_COMPLETE_SUCCESS");
    expect(success).toMatchObject({ level: "INFO", layer: "local", entity_type: "Task", entity_id: "t1", operation: "COMPLETE_TASK", local_event_id: row.localEventId });
    // ids and field names only
    const written = JSON.stringify(memory.sink.records);
    expect(written).not.toContain("سارا");
    expect(written).not.toContain("1200000");
  });

  it("never throws when the insert fails, reports it on the local layer, and still logs that the operation succeeded", () => {
    const failing = { ...db, run: () => { throw new Error("database or disk is full"); } } as unknown as LocalDb;
    expect(() => writeLocalAuditLog(failing, { userId, action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after })).not.toThrow();
    expect(memory.sink.find("AUDIT_WRITE_FAILED")[0]).toMatchObject({ level: "ERROR", layer: "local", error_code: "AUDIT-001", entity_type: "Task", entity_id: "t1" });
    expect(memory.sink.find("TASK_UPDATE_SUCCESS")).toHaveLength(1);
    expect(rows()).toEqual([]);
  });

  it("accepts the canonical event in place of the legacy action", () => {
    writeLocalAuditLog(db, { userId, action: "REORDER", entityType: "Category", metadata: { count: 3 } });
    expect(rows()[0]).toMatchObject({ event: "CATEGORIES_REORDERED", metadata: '{"count":3}' });
    expect(memory.sink.find("CATEGORY_REORDER_SUCCESS")).toHaveLength(1);
  });
});

describe("History on the phone", () => {
  it("lists what the new writer wrote — legacy fields first-class, new ones alongside — newest first, still filterable", async () => {
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: "t1", newValue: before });
    await new Promise((resolve) => setTimeout(resolve, 5));
    writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: before, newValue: after });
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Habit", entityId: "h1", newValue: { id: "h1", title: "ورزش" } });

    const { logs } = listAuditLogs(db, userId);
    expect(logs).toHaveLength(3);
    expect(logs.every((log) => typeof log.action === "string" && typeof log.entityType === "string" && typeof log.createdAt === "string")).toBe(true);
    expect(logs.map((log) => log.event).sort()).toEqual(["HABIT_CREATED", "TASK_CREATED", "TASK_UPDATED"]);
    expect(logs[0].createdAt >= logs[1].createdAt).toBe(true);
    expect(listAuditLogs(db, userId, { entityType: "Habit" }).logs).toHaveLength(1);
  });
});
