// What the phone writes down about a sync, against a scripted server: the events of a cycle in order, all carrying the
// cycle's id; what each says (counts, durations, the ids of the rows sent, the server's own request id) and what
// none of them may say (a title, an amount, the token). The acceptance scenarios 4-6 of the logging spec are here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClientDeviceId } from "@/lib/observability/client/clientContext";
import { resetRemoteFetchState } from "@/lib/remoteFetch";
import { installMemoryLogger } from "@/lib/observability/testing";
import type { LogRecord } from "@/lib/observability/core/schema";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { LOCAL_USER_ID, getLocalUserId } from "./localUser";
import { createTask } from "./repositories/tasks";
import { resetSyncRunnerState, runSync, type SyncLicense } from "./syncRunner";

const DEVICE = "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y";
const TOKEN = "jwt-must-never-appear-in-a-log";
const TITLE = "خرید هدیه برای سارا";

let memory: ReturnType<typeof installMemoryLogger>;
let db: LocalDb;

beforeEach(async () => {
  resetLocalDbForTests();
  resetRemoteFetchState();
  resetSyncRunnerState();
  setClientDeviceId(DEVICE);
  db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  getLocalUserId(db);
  memory = installMemoryLogger();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setClientDeviceId(undefined);
  memory.restore();
});

const license = (over: Partial<SyncLicense> = {}): SyncLicense => ({ token: TOKEN, remoteUserId: "remote_user_1", lastPushedAt: null, lastPulledAt: null, ...over });

interface Script {
  pull?: () => Response | Promise<Response>;
  push?: (body: any) => Response | Promise<Response>;
}
const json = (body: unknown, init: ResponseInit & { requestId?: string } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.requestId ? { "x-request-id": init.requestId } : {}) } });
const pulled = (over: Record<string, unknown> = {}, requestId = "req_PULL0000000000000000000001") =>
  json({ protocol: 2, syncedAt: "2026-09-21T10:00:00.000Z", tables: {}, tombstones: [], ...over }, { requestId });
const pushed = (results: Record<string, unknown> = {}, requestId = "req_PUSH0000000000000000000001") => json({ protocol: 2, results }, { requestId });

/** A server that answers pulls and pushes from a script, and remembers what it was sent. */
function server(script: Script = {}) {
  const requests: Array<{ method: string; path: string; headers: Headers; body?: any }> = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers as HeadersInit);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method: init?.method ?? "GET", path: url.pathname, headers, body });
    if (url.pathname === "/api/sync/pull") return (script.pull ?? (() => pulled()))();
    return (script.push ?? (() => pushed()))(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

const cycle = () => memory.sink.records.filter((record) => record.event.startsWith("SYNC_"));
const names = () => cycle().map((record) => record.event);
const byEvent = (event: string) => memory.sink.find(event)[0] as LogRecord;
const meta = (event: string) => byEvent(event).metadata as Record<string, any>;

describe("scenario 5: an online sync", () => {
  it("tells the whole cycle in order, every line carrying the cycle's sync id and trace id", async () => {
    const task = createTask(db, LOCAL_USER_ID, { title: TITLE });
    memory.sink.clear();
    server({ push: () => pushed({ Task: { upserted: 1, skipped: 0, rejected: 0 } }) });

    const outcome = await runSync(db, license(), { deep: true, trigger: "resume" });
    expect(outcome.ok).toBe(true);

    expect(names()).toEqual(["SYNC_STARTED", "SYNC_PULL_STARTED", "SYNC_PULL_SUCCESS", "SYNC_PUSH_STARTED", "SYNC_PUSH_SUCCESS", "SYNC_SUCCESS", "SYNC_COMPLETED"]);
    const ids = new Set(cycle().map((record) => record.sync_id));
    expect([...ids]).toEqual([outcome.syncId]);
    expect(new Set(cycle().map((record) => record.trace_id)).size).toBe(1);
    expect(cycle().every((record) => record.layer === "local" && record.module === "sync")).toBe(true);
    expect(byEvent("SYNC_STARTED")).toMatchObject({ level: "INFO", metadata: { trigger: "resume", deep: true, firstEver: true, attempt: 1 } });

    // what left the phone, and which server request took it — the key to the server's side of the story
    expect(byEvent("SYNC_PUSH_SUCCESS")).toMatchObject({ level: "INFO" });
    expect(meta("SYNC_PUSH_SUCCESS").sentIds.Task).toContain(task.id);
    expect(meta("SYNC_PUSH_SUCCESS")).toMatchObject({ pushed: 1, skipped: 0, rejected: 0, serverRequestIds: ["req_PUSH0000000000000000000001"] });
    expect(meta("SYNC_PULL_SUCCESS").serverRequestId).toBe("req_PULL0000000000000000000001");
    expect(meta("SYNC_COMPLETED")).toMatchObject({ ok: true, pushed: 1, pulled: 0, rejected: 0, trigger: "resume" });
    expect(byEvent("SYNC_COMPLETED").duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("sends the same ids to the server as headers, so the server's records can be found with them", async () => {
    createTask(db, LOCAL_USER_ID, { title: TITLE });
    const { requests } = server({ push: () => pushed({ Task: { upserted: 1, skipped: 0, rejected: 0 } }) });
    const outcome = await runSync(db, license(), { trigger: "manual" });

    const record = byEvent("SYNC_STARTED");
    expect(requests.map((request) => request.path)).toEqual(["/api/sync/pull", "/api/sync/push"]);
    for (const request of requests) {
      expect(request.headers.get("x-parva-sync-id")).toBe(outcome.syncId);
      expect(request.headers.get("x-parva-device-id")).toBe(DEVICE);
      expect(request.headers.get("traceparent")).toContain(`-${record.trace_id}-`);
      expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
    // a fresh span for each request of the cycle
    expect(new Set(requests.map((request) => request.headers.get("traceparent"))).size).toBe(2);
  });

  it("counts what the pull created and changed on the phone", async () => {
    const stamp = "2026-09-21T09:00:00.000Z";
    const existing = createTask(db, LOCAL_USER_ID, { title: "old title" });
    db.run(`UPDATE "Task" SET "updatedAt" = ? WHERE "id" = ?`, ["2026-09-01T00:00:00.000Z", existing.id]);
    server({
      pull: () =>
        pulled({
          tables: {
            Task: [
              { id: existing.id, userId: "remote_user_1", title: "newer title", status: "TODO", valueType: "EXPENSE", directCost: 0, incomeAmount: 0, createdAt: stamp, updatedAt: stamp },
              { id: "task-new", userId: "remote_user_1", title: "another", status: "TODO", valueType: "EXPENSE", directCost: 0, incomeAmount: 0, createdAt: stamp, updatedAt: stamp },
            ],
          },
        }),
    });
    const outcome = await runSync(db, license({ lastPulledAt: "2026-09-20T00:00:00.000Z", lastPushedAt: "2026-09-21T00:00:00.000Z" }), { trigger: "boot" });
    expect(outcome).toMatchObject({ ok: true, created: 1, updated: 1 });
    expect(meta("SYNC_PULL_SUCCESS")).toMatchObject({ received: 2, recordCount: 2, created: 1, updated: 1, tables: { Task: 2 } });
  });
});

describe("what is never in the log", () => {
  it("has no title, no amount and no token in any record of a cycle that moved real data", async () => {
    createTask(db, LOCAL_USER_ID, { title: TITLE, directCost: 987654 });
    memory.sink.clear();
    server({ push: () => pushed({ Task: { upserted: 1, skipped: 0, rejected: 0 } }) });
    await runSync(db, license(), { trigger: "manual" });
    const everything = JSON.stringify(memory.sink.records);
    expect(everything).not.toContain(TITLE);
    expect(everything).not.toContain("987654");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("remote_user_1"); // (the account is in the context of a signed-in phone, not in a sync line's own fields)
  });
});

describe("a quiet cycle stays quiet", () => {
  it("writes nothing above DEBUG when the timer's cycle found nothing to do", async () => {
    server();
    // nothing local to send: give the phone a cursor that is already past everything it has
    const outcome = await runSync(db, license({ lastPushedAt: new Date(Date.now() + 60_000).toISOString(), lastPulledAt: "2026-09-21T09:00:00.000Z" }), { trigger: "poll" });
    expect(outcome.ok).toBe(true);
    expect(names()).toContain("SYNC_COMPLETED");
    expect(cycle().filter((record) => record.level !== "DEBUG")).toEqual([]);
  });

  it("logs the start of a cycle at INFO when the person opened the app for it, and at DEBUG for a timer tick", async () => {
    server();
    await runSync(db, license({ lastPushedAt: new Date(Date.now() + 60_000).toISOString() }), { trigger: "resume" });
    expect(byEvent("SYNC_STARTED").level).toBe("INFO");
    memory.sink.clear();
    await runSync(db, license({ lastPushedAt: new Date(Date.now() + 60_000).toISOString() }), { trigger: "poll" });
    expect(byEvent("SYNC_STARTED").level).toBe("DEBUG");
  });
});

describe("scenario 6: a sync that fails and then succeeds", () => {
  it("says FAILED, then RETRY when the next cycle starts, then SUCCESS — and forgets the failure", async () => {
    createTask(db, LOCAL_USER_ID, { title: TITLE });
    memory.sink.clear();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const failed = await runSync(db, license(), { trigger: "local-write" });
    expect(failed.ok).toBe(false);
    expect(names()).toEqual(["SYNC_STARTED", "SYNC_PULL_STARTED", "SYNC_FAILED", "SYNC_COMPLETED"]);
    expect(byEvent("SYNC_FAILED")).toMatchObject({ level: "WARN", error_code: "SYNC-001", sync_id: failed.syncId, metadata: { kind: "network", attempt: 1 } });
    expect(meta("SYNC_COMPLETED").ok).toBe(false);

    memory.sink.clear();
    server({ push: () => pushed({ Task: { upserted: 1, skipped: 0, rejected: 0 } }) });
    const retried = await runSync(db, license(), { trigger: "poll" });
    expect(retried.ok).toBe(true);
    expect(names()).toContain("SYNC_RETRY");
    expect(names().indexOf("SYNC_RETRY")).toBeLessThan(names().indexOf("SYNC_SUCCESS"));
    expect(byEvent("SYNC_RETRY")).toMatchObject({ level: "WARN", sync_id: retried.syncId, metadata: { attempt: 2, previousKind: "network" } });
    expect(retried.syncId).not.toBe(failed.syncId); // a new cycle, its own id

    memory.sink.clear();
    server();
    await runSync(db, license({ lastPushedAt: new Date(Date.now() + 60_000).toISOString() }), { trigger: "poll" });
    expect(names()).not.toContain("SYNC_RETRY"); // the failure is forgotten once a cycle succeeded
  });

  it("counts a second failure as the second attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await runSync(db, license(), { trigger: "poll" });
    memory.sink.clear();
    await runSync(db, license(), { trigger: "poll" });
    expect(byEvent("SYNC_RETRY").metadata).toMatchObject({ attempt: 2 });
    expect(byEvent("SYNC_FAILED").metadata).toMatchObject({ attempt: 2 });
  });
});

describe("when the server refuses something", () => {
  it("names each refused row and why, and calls the cycle partly successful", async () => {
    const task = createTask(db, LOCAL_USER_ID, { title: TITLE });
    memory.sink.clear();
    server({
      push: () => pushed({ Task: { upserted: 0, skipped: 0, rejected: 1, rejectedRows: [{ id: task.id, reason: "parent row not found for this account" }] } }),
    });
    const outcome = await runSync(db, license(), { trigger: "manual" });
    expect(outcome).toMatchObject({ ok: true, rejectedCount: 1 });

    expect(byEvent("SYNC_PAYLOAD_REJECTED")).toMatchObject({ level: "WARN", error_code: "SYNC-005", sync_id: outcome.syncId });
    expect(meta("SYNC_PAYLOAD_REJECTED").rows).toEqual([{ table: "Task", id: task.id, reason: "parent row not found for this account" }]);
    expect(byEvent("SYNC_PARTIAL_SUCCESS")).toMatchObject({ level: "WARN", metadata: { rejected: 1 } });
    expect(names()).not.toContain("SYNC_SUCCESS");
    expect(meta("SYNC_COMPLETED")).toMatchObject({ ok: true, rejected: 1 });
    expect(JSON.stringify(memory.sink.records)).not.toContain(TITLE);
  });

  it("says when a request was too large for the server's proxy, with the size of the batch and the server's request id", async () => {
    createTask(db, LOCAL_USER_ID, { title: TITLE });
    memory.sink.clear();
    server({ push: () => json({}, { status: 413, requestId: "req_TOOBIG0000000000000000001" }) });
    const outcome = await runSync(db, license(), { trigger: "manual" });
    expect(outcome.error?.kind).toBe("too-large");

    expect(byEvent("SYNC_SIZE_LIMIT_EXCEEDED")).toMatchObject({ level: "WARN", error_code: "SYNC-004", sync_id: outcome.syncId });
    expect(meta("SYNC_SIZE_LIMIT_EXCEEDED")).toMatchObject({ batch: 1, batches: 1, serverRequestId: "req_TOOBIG0000000000000000001" });
    expect(meta("SYNC_SIZE_LIMIT_EXCEEDED").batchBytes).toBeGreaterThan(0);
    expect(byEvent("SYNC_FAILED")).toMatchObject({ level: "ERROR", error_code: "SYNC-004", metadata: { kind: "too-large", status: 413, serverRequestId: "req_TOOBIG0000000000000000001" } });
  });

  it("quotes the server's request id when it answers with an error", async () => {
    server({ pull: () => json({ error: "boom" }, { status: 503, requestId: "req_DOWN000000000000000000001" }) });
    await runSync(db, license(), { trigger: "boot" });
    expect(byEvent("SYNC_FAILED")).toMatchObject({ error_code: "SYNC-002", metadata: { status: 503, serverRequestId: "req_DOWN000000000000000000001" } });
  });
});

describe("a change the server's newer copy replaced", () => {
  it("is a conflict when the phone had changed the row since it last pushed — with which row, and who won", async () => {
    const task = createTask(db, LOCAL_USER_ID, { title: TITLE });
    const edited = "2026-09-21T09:30:00.000Z";
    db.run(`UPDATE "Task" SET "title" = ?, "updatedAt" = ? WHERE "id" = ?`, ["edited on the phone", edited, task.id]);
    const remoteStamp = "2026-09-21T09:45:00.000Z";
    memory.sink.clear();
    server({
      pull: () => pulled({ tables: { Task: [{ id: task.id, userId: "remote_user_1", title: "edited on the web", status: "TODO", valueType: "EXPENSE", directCost: 0, incomeAmount: 0, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: remoteStamp }] } }),
    });
    const outcome = await runSync(db, license({ lastPushedAt: "2026-09-21T09:00:00.000Z", lastPulledAt: "2026-09-21T08:00:00.000Z" }), { trigger: "resume" });

    expect(outcome.conflicts).toBe(1);
    expect(byEvent("SYNC_CONFLICT")).toMatchObject({ level: "INFO", error_code: "SYNC-006", sync_id: outcome.syncId });
    expect(meta("SYNC_CONFLICT")).toMatchObject({ conflicts: 1, winner: "server", ids: { Task: [task.id] } });
    expect(JSON.stringify(memory.sink.records)).not.toContain("edited on the");
  });

  it("is not a conflict when the phone had nothing unsent, or when it has never pushed at all", async () => {
    const task = createTask(db, LOCAL_USER_ID, { title: TITLE });
    db.run(`UPDATE "Task" SET "updatedAt" = ? WHERE "id" = ?`, ["2026-09-21T08:00:00.000Z", task.id]);
    const newer = { id: task.id, userId: "remote_user_1", title: "x", status: "TODO", valueType: "EXPENSE", directCost: 0, incomeAmount: 0, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-21T09:45:00.000Z" };

    memory.sink.clear();
    server({ pull: () => pulled({ tables: { Task: [newer] } }) });
    await runSync(db, license({ lastPushedAt: "2026-09-21T09:00:00.000Z" }), { trigger: "resume" }); // pushed after its last edit
    expect(names()).not.toContain("SYNC_CONFLICT");

    db.run(`UPDATE "Task" SET "updatedAt" = ? WHERE "id" = ?`, ["2026-09-21T08:00:00.000Z", task.id]);
    memory.sink.clear();
    server({ pull: () => pulled({ tables: { Task: [newer] } }) });
    await runSync(db, license({ lastPushedAt: null }), { trigger: "first-run" }); // a first sync compares against nothing
    expect(names()).not.toContain("SYNC_CONFLICT");
  });
});

describe("the ids of what was sent", () => {
  it("lists a bounded number of them, and says when it stopped", async () => {
    for (let i = 0; i < 80; i++) db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [`task-bulk-${i}`, LOCAL_USER_ID, `t${i}`, "2026-09-21T09:00:00.000Z", "2026-09-21T09:00:00.000Z"]);
    memory.sink.clear();
    server({ push: () => pushed({ Task: { upserted: 80, skipped: 0, rejected: 0 } }) });
    await runSync(db, license(), { trigger: "manual" });
    const sent = meta("SYNC_PUSH_SUCCESS");
    expect(sent.sentIds.Task.length).toBeLessThanOrEqual(20);
    expect(Object.values(sent.sentIds as Record<string, string[]>).flat().length).toBeLessThanOrEqual(60);
    expect(sent.sentIdsTruncated).toBe(true);
    expect(meta("SYNC_PUSH_STARTED")).toMatchObject({ tables: { Task: 80 } }); // the counts are always complete
  });
});
