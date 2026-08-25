import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { writeLocalAuditLog } from "../audit";
import { listAuditLogs } from "./auditLogs";

const USER_ID = "user_audit_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "au@example.com", "hash", "Audit", now(), now()]);
  return db;
}

describe("local auditLogs", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("lists logs newest first and filters by entityType", async () => {
    const db = await freshDb();
    writeLocalAuditLog(db, { userId: USER_ID, action: "CREATE", entityType: "Task", entityId: "t1" });
    writeLocalAuditLog(db, { userId: USER_ID, action: "CREATE", entityType: "Habit", entityId: "h1" });

    expect(listAuditLogs(db, USER_ID).logs).toHaveLength(2);
    const taskLogs = listAuditLogs(db, USER_ID, { entityType: "Task" }).logs;
    expect(taskLogs).toHaveLength(1);
    expect(taskLogs[0].entityId).toBe("t1");
  });

  it("does not leak another user's logs", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, ["someone_else", "o@example.com", "hash", "Other", now(), now()]);
    writeLocalAuditLog(db, { userId: "someone_else", action: "CREATE", entityType: "Task", entityId: "t1" });
    expect(listAuditLogs(db, USER_ID).logs).toHaveLength(0);
  });
});
