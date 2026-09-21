// "The expense is on the phone but not on the web": the phone's real code, the server's real routes, one in-memory
// log. From nothing but a user, a time and an entity id, the whole path is rebuilt — the local write, the sync that
// carried it, the request the server received, the server's own record of it, and the end of the cycle — because
// every step names the same ids (sync_id, trace_id, device_id, request_id). Also: an app updated before its server
// (which does not know the correlation headers yet) must still sync.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});
vi.mock("@/local/nativeNotifications", () => ({
  requestNotificationPermission: async () => {},
  scheduleReminderNotification: () => {},
  rescheduleReminderNotification: () => {},
  cancelReminderNotification: () => {},
  cancelReminderNotifications: () => {},
  syncScheduledReminderNotifications: () => {},
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {}, keys: async () => ({ keys: [] }) },
}));
vi.mock("@/lib/versionGate", () => ({ cacheVersionGate: async () => {}, checkVersionGate: async () => ({ blocked: false }) }));

import { applyClientIdentity, setClientDeviceId, setClientUser } from "@/lib/observability/client/clientContext";
import { installMemoryLogger } from "@/lib/observability/testing";
import type { LogRecord } from "@/lib/observability/core/schema";
import { resetRemoteFetchState } from "@/lib/remoteFetch";
import { resetSyncRunnerState } from "@/local/syncRunner";
import { createPhone, createServerHarness, type Phone, type ServerHarness } from "@/testing/syncHarness";
import { linkPhone, syncPhone, type Account } from "@/testing/syncScenarios";

vi.setConfig({ testTimeout: 60_000 });

const DEVICE = "dev_01J8ZQ2M3N4P5R6S7T8V9W0X1Y";
const TITLE = "خرید هدیه‌ی محرمانه";

let server: ServerHarness;
let account: Account;
let phone: Phone;
let memory: ReturnType<typeof installMemoryLogger>;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(async () => {
  resetRemoteFetchState();
  resetSyncRunnerState();
  setClientDeviceId(DEVICE);
  account = await server.registerUser();
  phone = await createPhone();
  linkPhone(phone, account);
  memory = installMemoryLogger();
  applyClientIdentity({ deviceId: DEVICE, osVersion: "Android 14", tz: "Asia/Tehran" }, memory.core);
  setClientUser(account.userId, memory.core);
});
afterEach(() => {
  setClientDeviceId(undefined);
  memory.restore();
});

/** Lines the phone wrote, and lines the server wrote (both go to the one sink here; `layer` says which). */
const onPhone = (event: string) => memory.sink.find(event).filter((record) => record.layer === "local");
const onServer = (event: string) => memory.sink.find(event).filter((record) => record.layer === "server");
const request = (path: string) => onServer("HTTP_REQUEST_COMPLETED").find((record) => record.path === path) as LogRecord;

describe("one sync, seen from both sides", () => {
  it("gives the server's records of the phone's requests the phone's sync id, trace id and device id", async () => {
    phone.must("POST", "/api/tasks", { title: TITLE, directCost: 45000 });
    memory.sink.clear();

    const outcome = await syncPhone(phone, { deep: true, trigger: "manual" });
    expect(outcome.ok).toBe(true);

    const started = onPhone("SYNC_STARTED")[0];
    for (const path of ["/api/sync/pull", "/api/sync/push"]) {
      expect(request(path), path).toMatchObject({ sync_id: outcome.syncId, trace_id: started.trace_id, device_id: DEVICE, status_code: 200, user_id: account.userId });
    }
    // the server's own account of the push, under the same sync id
    expect(onServer("SYNC_PUSH_SUCCESS")[0]).toMatchObject({ sync_id: outcome.syncId, device_id: DEVICE });
    // and the phone learned the server's request id for it
    expect(onPhone("SYNC_PUSH_SUCCESS")[0].metadata.serverRequestIds).toEqual([request("/api/sync/push").request_id]);
    expect(onPhone("SYNC_PULL_SUCCESS")[0].metadata.serverRequestId).toBe(request("/api/sync/pull").request_id);
  });

  it("says nothing about what was synced beyond counts and ids", async () => {
    phone.must("POST", "/api/tasks", { title: TITLE, directCost: 45000 });
    memory.sink.clear();
    await syncPhone(phone, { deep: true, trigger: "manual" });
    const everything = JSON.stringify(memory.sink.records);
    expect(everything).not.toContain(TITLE);
    expect(everything).not.toContain("45000");
    expect(everything).not.toContain(account.token);
    expect(everything).not.toContain(account.email);
  });
});

describe("incident: the task is on the phone but not on the web", () => {
  it("is rebuilt from the user, the time and the entity id alone, step by step", async () => {
    const created = phone.must("POST", "/api/tasks", { title: TITLE });
    const entityId: string = created.task.id;
    await syncPhone(phone, { deep: true, trigger: "local-write" });

    // 1. the phone's own record of the write: which entity, which local event, and that it was waiting for a sync
    const local = onPhone("TASK_CREATE_SUCCESS").find((record) => record.entity_id === entityId);
    expect(local, "the local write").toBeDefined();
    expect(local).toMatchObject({ entity_type: "Task", operation: "CREATE", layer: "local", sync_status: "PENDING", device_id: DEVICE, user_id: account.userId });
    expect(local?.local_event_id).toMatch(/^lev_/);

    // 2. the first sync that sent it: found by the entity id, it names the cycle and the server's request
    const push = onPhone("SYNC_PUSH_SUCCESS").find((record) => (record.metadata.sentIds as Record<string, string[]>)?.Task?.includes(entityId));
    expect(push, "the phone's record of sending it").toBeDefined();
    const syncId = push!.sync_id!;

    // 3. everything the server wrote for that cycle, in one search
    const serverSide = memory.sink.records.filter((record) => record.layer === "server" && record.sync_id === syncId);
    expect(serverSide.map((record) => record.event)).toEqual(expect.arrayContaining(["HTTP_REQUEST_COMPLETED", "SYNC_PUSH_SUCCESS"]));
    const accepted = serverSide.find((record) => record.event === "HTTP_REQUEST_COMPLETED" && record.path === "/api/sync/push");
    expect(accepted).toMatchObject({ status_code: 200, method: "POST" });
    expect(push!.metadata.serverRequestIds).toContain(accepted!.request_id);

    // 4. the end of the cycle, on the phone
    expect(onPhone("SYNC_COMPLETED").find((record) => record.sync_id === syncId)).toMatchObject({ metadata: { ok: true, pushed: expect.any(Number) } });

    // 5. and the data really is on the server, where the web reads it
    const web = await server.web("GET", "/api/tasks");
    expect(web.json.tasks.map((task: { id: string }) => task.id)).toContain(entityId);
  });

  it("shows where a sync stopped when the server refused it, and which of the server's own lines to read next", async () => {
    phone.must("POST", "/api/tasks", { title: TITLE });
    memory.sink.clear();
    // the person's session no longer works: the server answers 401 to the phone's requests
    const stale = { ...account, token: "not-a-valid-token" };
    linkPhone(phone, stale);
    const outcome = await syncPhone(phone, { deep: true, trigger: "resume" });
    expect(outcome.ok).toBe(false);

    const failed = onPhone("SYNC_FAILED")[0];
    expect(failed).toMatchObject({ error_code: "SYNC-003", sync_id: outcome.syncId, metadata: { kind: "auth", status: 401 } });
    const refusal = onServer("HTTP_REQUEST_COMPLETED").find((record) => record.request_id === failed.metadata.serverRequestId);
    expect(refusal, "the server's line for the refused request").toMatchObject({ status_code: 401, sync_id: outcome.syncId, device_id: DEVICE });
  });
});

describe("an app that is newer than its server", () => {
  it("still syncs when the server does not accept the correlation headers, and notes it once", async () => {
    const real = globalThis.fetch;
    // what the browser does when a server's CORS preflight does not list a header: the request never leaves
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const sent = new Headers(init?.headers as HeadersInit);
      if (sent.has("x-parva-sync-id") || sent.has("x-parva-device-id") || sent.has("traceparent")) throw new TypeError("Failed to fetch");
      return real(input, init);
    });
    try {
      phone.must("POST", "/api/tasks", { title: TITLE });
      memory.sink.clear();
      const outcome = await syncPhone(phone, { deep: true, trigger: "boot" });
      expect(outcome.ok).toBe(true);
      expect(await server.prisma.task.count({ where: { userId: account.userId, title: TITLE } })).toBe(1); // the data got there

      expect(onPhone("SYNC_CORRELATION_UNSUPPORTED")).toHaveLength(1);
      // the server, of course, saw no ids
      expect(request("/api/sync/push").sync_id).toBeUndefined();
    } finally {
      vi.stubGlobal("fetch", real);
    }
  });
});
