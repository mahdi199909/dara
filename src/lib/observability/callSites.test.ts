// What the former console.error call sites now say. Each of them used to print an unstructured line;
// they now write a catalogued event with an error code, the right layer and NO personal data — and
// they must still behave exactly as before (same responses, same "never throws", same retries).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";

const prismaMock = vi.hoisted(() => ({ auditLog: { create: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const preferences = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: preferences.store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => void preferences.store.set(key, value)),
    remove: vi.fn(async ({ key }: { key: string }) => void preferences.store.delete(key)),
  },
}));

const notifications = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  getPending: vi.fn(),
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: notifications }));

import { ApiError, handleApiError } from "@/lib/apiError";
import { AuthError } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { dispatchLocal, setLocalDbDriver } from "@/lib/localDispatcher";
import { writeLocalAuditLog } from "@/local/audit";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "@/local/db";
import { createNodeSqliteDriver } from "@/local/drivers/nodeSqlite";
import { requestNotificationPermission, scheduleReminderNotification, syncScheduledReminderNotifications, cancelReminderNotification, rescheduleReminderNotification } from "@/local/nativeNotifications";
import { runSync } from "@/local/syncRunner";
import { requestWidgetRefresh } from "@/local/widgetRefresh";
import { drainWidgetQueue } from "@/local/widgetQueue";
import { installMemoryLogger } from "./testing";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger({ level: "TRACE" });
  preferences.store.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  memory.restore();
  vi.unstubAllGlobals();
});

function record(event: string) {
  const found = memory.sink.find(event);
  expect(found, `no ${event} was logged (got: ${memory.sink.events().join(", ") || "nothing"})`).toHaveLength(1);
  return found[0];
}

describe("handleApiError", () => {
  it("logs an unexpected exception once — stack and code included — and tells the person nothing about it", async () => {
    const response = handleApiError(new Error("Can't reach postgresql://hesabkon:hunter2@postgres:5432/hesabkon"));
    expect(response.status).toBe(500);
    // The person still learns nothing about the cause — only a stable code they can quote.
    expect(await response.json()).toEqual({ error: "خطایی رخ داد. دوباره تلاش کنید.", code: "SYS-001" });

    const logged = record("API_UNHANDLED_ERROR");
    expect(logged).toMatchObject({ level: "ERROR", module: "api", component: "error-handler", error_code: "SYS-001", error: { type: "Error" } });
    expect(logged.error?.stack).toContain("Error:");
    expect(JSON.stringify(logged)).not.toContain("hunter2");
  });

  it("classifies a database error, and still answers 500 as before", async () => {
    const response = handleApiError(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    expect(response.status).toBe(500);
    expect(record("API_UNHANDLED_ERROR").error_code).toBe("DB-005");
  });

  it("does not log outcomes it handles as expected: not-found, validation, not signed in", async () => {
    expect(handleApiError(new ApiError("پیدا نشد.", 404)).status).toBe(404);
    expect(handleApiError(new AuthError()).status).toBe(401);
    const invalid = z.object({ title: z.string() }).safeParse({});
    expect(invalid.success).toBe(false);
    expect(handleApiError((invalid as { error: ZodError }).error).status).toBe(400);
    expect(memory.sink.records).toEqual([]);
  });
});

describe("audit writers", () => {
  it("writeAuditLog keeps every legacy column exactly as before (History depends on them) and adds the new ones", async () => {
    prismaMock.auditLog.create.mockResolvedValue({ id: "aud_1" });
    await writeAuditLog({ userId: "usr_1", action: "CREATE", entityType: "Task", entityId: "t1", newValue: { title: "x" }, ipAddress: "1.2.3.4", userAgent: "UA" });
    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "usr_1", action: "CREATE", entityType: "Task", entityId: "t1", oldValue: null, newValue: '{"title":"x"}', ipAddress: "1.2.3.4", userAgent: "UA", metadata: null });
    expect(data).toMatchObject({ event: "TASK_CREATED", source: "api", requestId: null, traceId: null, deviceId: null, changes: null });
    // The write had committed before the audit call, so its success is in the application log — ids only.
    expect(record("TASK_CREATE_SUCCESS")).toMatchObject({ level: "INFO", entity_type: "Task", entity_id: "t1", operation: "CREATE", layer: "server", metadata: { auditId: "aud_1" } });
    expect(JSON.stringify(memory.sink.records)).not.toContain('"title"');
  });

  it("writeAuditLog never throws; it reports AUDIT_WRITE_FAILED with ids only — not the audited values", async () => {
    prismaMock.auditLog.create.mockRejectedValue(new Error("connection refused"));
    await expect(writeAuditLog({ userId: "usr_1", action: "UPDATE", entityType: "Transaction", entityId: "tx_1", newValue: { amount: 250000, title: "لپ‌تاپ" } })).resolves.toBeUndefined();
    const logged = record("AUDIT_WRITE_FAILED");
    expect(logged).toMatchObject({ level: "ERROR", module: "audit", component: "writer", layer: "server", error_code: "AUDIT-001", entity_type: "Transaction", entity_id: "tx_1", operation: "UPDATE" });
    expect(JSON.stringify(logged)).not.toContain("250000");
    expect(JSON.stringify(logged)).not.toContain("لپ‌تاپ");
  });

  it("writeLocalAuditLog inserts the same row as before, and reports failures on the local layer", () => {
    const run = vi.fn();
    const fakeDb = { run, get: vi.fn(), all: vi.fn(), execute: vi.fn() } as unknown as LocalDb;
    writeLocalAuditLog(fakeDb, { userId: "local", action: "CREATE", entityType: "Task", entityId: "t1", newValue: { title: "x" } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('INSERT INTO "AuditLog"');
    expect(run.mock.calls[0][1]).toHaveLength(13); // the nine legacy columns + event, source, localEventId, changes

    run.mockImplementation(() => {
      throw new Error("database or disk is full");
    });
    expect(() => writeLocalAuditLog(fakeDb, { userId: "local", action: "DELETE", entityType: "Habit", entityId: "h1" })).not.toThrow();
    expect(record("AUDIT_WRITE_FAILED")).toMatchObject({ component: "local-writer", layer: "local", error_code: "AUDIT-001", entity_type: "Habit", entity_id: "h1", operation: "DELETE" });
  });
});

describe("the on-device dispatcher", () => {
  it("answers 500 with the details a phone without adb needs, and logs the request that failed", () => {
    const broken = {
      run: () => { throw new Error("disk I/O error"); },
      get: () => { throw new Error("disk I/O error"); },
      all: () => { throw new Error("disk I/O error"); },
      execute: () => { throw new Error("disk I/O error"); },
    } as unknown as LocalDb;
    resetLocalDbForTests();
    setLocalDbDriver(broken);

    const response = dispatchLocal("GET", "/api/tasks?status=TODO");
    expect(response.status).toBe(500);
    expect(response.json).toEqual({ error: "خطایی رخ داد. دوباره تلاش کنید.", details: "Error: disk I/O error" });
    expect(record("API_UNHANDLED_ERROR")).toMatchObject({ module: "api", component: "local-dispatcher", layer: "local", error_code: "SYS-001", method: "GET", path: "/api/tasks" });
  });
});

describe("a failed sync", () => {
  async function freshDb(): Promise<LocalDb> {
    resetLocalDbForTests();
    return openLocalDb(await createNodeSqliteDriver(":memory:"));
  }
  const license = { token: "jwt", remoteUserId: "remote_1", lastPushedAt: null, lastPulledAt: null };

  it("going offline is a WARN with SYNC-001 — routine on a phone, but never silent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const outcome = await runSync(await freshDb(), license);
    expect(outcome.ok).toBe(false);
    expect(record("SYNC_FAILED")).toMatchObject({ level: "WARN", module: "sync", component: "runner", layer: "local", error_code: "SYNC-001", metadata: { kind: "network" } });
  });

  it.each([
    [401, "auth", "SYNC-003"],
    [413, "too-large", "SYNC-004"],
    [503, "server", "SYNC-002"],
  ])("a %i answer is an ERROR with the matching code", async (status, kind, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, text: async () => "", json: async () => ({}) } as Response));
    await runSync(await freshDb(), license);
    expect(record("SYNC_FAILED")).toMatchObject({ level: "ERROR", error_code: code, metadata: { kind, status } });
  });

  it("carries counts, never rows, and no token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await runSync(await freshDb(), { ...license, token: "jwt-must-not-leak" });
    const text = JSON.stringify(record("SYNC_FAILED"));
    expect(text).not.toContain("jwt-must-not-leak");
    expect(record("SYNC_FAILED").metadata).toEqual({ kind: "network", pulledCount: 0, pushedCount: 0 });
  });
});

describe("the widget queue", () => {
  it("logs a failing capture without what the person typed, and keeps it queued for the next drain", async () => {
    resetLocalDbForTests();
    const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
    const broken = { ...db, run: () => { throw new Error("database is locked"); } } as unknown as LocalDb;
    preferences.store.set("widget_pending_captures", JSON.stringify([{ title: "پرداخت اجاره خانه", categoryId: null, startedAt: new Date().toISOString(), durationMinutes: 15 }]));

    await expect(drainWidgetQueue(broken, "user_1")).resolves.toBe(0);

    expect(record("WIDGET_QUEUE_FAILED")).toMatchObject({ level: "ERROR", module: "widgets", component: "queue", layer: "local", error_code: "WIDGET-001", metadata: { queue: "capture", willRetry: true } });
    expect(JSON.stringify(memory.sink.records)).not.toContain("اجاره");
    expect(preferences.store.get("widget_pending_captures")).toContain("اجاره"); // retried later — nothing was lost
  });

  it("logs a failing habit toggle with the habit id, and carries on", async () => {
    resetLocalDbForTests();
    const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
    preferences.store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: "habit_gone", date: new Date().toISOString() }]));
    await drainWidgetQueue(db, "user_1");
    expect(record("WIDGET_QUEUE_FAILED")).toMatchObject({ entity_type: "habit", entity_id: "habit_gone", metadata: { queue: "habit_checkin" } });
  });

  it("names the failing step when a widget cannot be repainted", () => {
    vi.stubGlobal("window", { AndroidWidgets: { refresh: () => { throw new Error("bridge down"); } } });
    requestWidgetRefresh();
    expect(record("WIDGET_REFRESH_FAILED")).toMatchObject({ level: "ERROR", error_code: "WIDGET-002", layer: "local", metadata: { step: "bridge" } });
  });
});

describe("native reminder notifications", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const reminder = { id: "rem_1", title: "عنوان خصوصی", body: "متن خصوصی", remindAt: future };
  const waitForLog = (event: string) => vi.waitFor(() => expect(memory.sink.find(event).length).toBeGreaterThan(0));

  it("reports which operation failed on which reminder — never the reminder's text", async () => {
    notifications.schedule.mockRejectedValue(new Error("Notifications not permitted"));
    notifications.update.mockRejectedValue(new Error("update failed"));
    notifications.cancel.mockRejectedValue(new Error("cancel failed"));
    notifications.getPending.mockRejectedValue(new Error("pending failed"));

    scheduleReminderNotification(reminder);
    rescheduleReminderNotification(reminder);
    cancelReminderNotification("rem_2");
    syncScheduledReminderNotifications([reminder]);
    await vi.waitFor(() => expect(memory.sink.find("LOCAL_NOTIFICATION_FAILED")).toHaveLength(4));

    const failures = memory.sink.find("LOCAL_NOTIFICATION_FAILED");
    expect(failures.map((r) => r.operation).sort()).toEqual(["cancel", "reconcile", "reschedule", "schedule"]);
    expect(failures.every((r) => r.error_code === "NOTIF-001" && r.layer === "local" && r.level === "ERROR")).toBe(true);
    expect(failures.find((r) => r.operation === "schedule")?.entity_id).toBe("rem_1");
    expect(failures.find((r) => r.operation === "cancel")?.entity_id).toBe("rem_2");
    expect(JSON.stringify(memory.sink.records)).not.toContain("خصوصی");
  });

  it("treats a refused permission as a WARN with NOTIF-002", async () => {
    notifications.requestPermissions.mockRejectedValue(new Error("denied"));
    await requestNotificationPermission();
    await waitForLog("LOCAL_NOTIFICATION_PERMISSION_FAILED");
    expect(record("LOCAL_NOTIFICATION_PERMISSION_FAILED")).toMatchObject({ level: "WARN", error_code: "NOTIF-002" });
  });
});
