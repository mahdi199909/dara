// A task's time box (Task.boxMinutes) through the real web routes on a real database, the same calls on the phone's own
// database, and both directions of sync. The box says how long a task may take; it never moves or changes the task.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

import { createPhone, createServerHarness, type ServerHarness } from "@/testing/syncHarness";
import { linkPhone, syncUntilQuiet } from "@/testing/syncScenarios";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

type Call = (method: string, url: string, body?: unknown) => Promise<any>;
type Raw = (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }>;

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

/** The same scenario, run once against the web routes and once against the phone. */
async function boxScenario(call: Call, raw: Raw) {
  const dueDate = today().toISOString();
  const boxed = (await call("POST", "/api/tasks", { title: "نوشتن گزارش", dueDate, boxMinutes: 45 })).task;
  const plain = (await call("POST", "/api/tasks", { title: "تماس", dueDate })).task;
  expect(boxed.boxMinutes).toBe(45);
  expect(plain.boxMinutes ?? null).toBeNull();

  // The day's list carries it, so the planner can show and total the boxes.
  const to = new Date(today().getFullYear(), today().getMonth(), today().getDate(), 23, 59, 59, 999).toISOString();
  const day = (await call("GET", `/api/events?from=${dueDate}&to=${to}`)).taskOccurrences as any[];
  expect(day.find((t) => t.id === boxed.id)).toMatchObject({ boxMinutes: 45 });

  // Changing it, giving one, and taking it away — without touching the rest of the task.
  expect((await call("PATCH", `/api/tasks/${boxed.id}`, { boxMinutes: 25 })).task).toMatchObject({ boxMinutes: 25, title: "نوشتن گزارش", status: "TODO" });
  expect((await call("PATCH", `/api/tasks/${plain.id}`, { boxMinutes: 15 })).task.boxMinutes).toBe(15);
  expect((await call("PATCH", `/api/tasks/${boxed.id}`, { boxMinutes: null })).task.boxMinutes).toBeNull();
  // Ticking a boxed task done keeps its box.
  expect((await call("PATCH", `/api/tasks/${plain.id}`, { status: "DONE" })).task).toMatchObject({ status: "DONE", boxMinutes: 15 });

  // A box must be a whole number of minutes within a day.
  for (const bad of [0, -5, 1441, 12.5]) {
    expect((await raw("PATCH", `/api/tasks/${boxed.id}`, { boxMinutes: bad })).status).toBe(400);
    expect((await raw("POST", "/api/tasks", { title: "x", boxMinutes: bad })).status).toBe(400);
  }
}

describe("task time boxes", () => {
  it("work on the web", async () => {
    await server.registerUser();
    await boxScenario(
      (m, u, b) => server.mustWeb(m, u, b),
      (m, u, b) => server.web(m, u, b)
    );
  });

  it("work the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await boxScenario(
      async (m, u, b) => phone.must(m, u, b),
      async (m, u, b) => phone.request(m, u, b)
    );
  });
});

describe("task time boxes sync", () => {
  it("travel from the phone to the web and back", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);

    const task = phone.must("POST", "/api/tasks", { title: "مرور", dueDate: today().toISOString(), boxMinutes: 60 }).task;
    await syncUntilQuiet(phone);

    server.setWebSession(account.token);
    const onWeb = async () => ((await server.mustWeb("GET", "/api/tasks")).tasks as any[]).find((t) => t.id === task.id);
    expect(await onWeb()).toMatchObject({ boxMinutes: 60 });

    await tick();
    await server.mustWeb("PATCH", `/api/tasks/${task.id}`, { boxMinutes: 25 });
    await syncUntilQuiet(phone);
    expect((phone.must("GET", "/api/tasks").tasks as any[]).find((t) => t.id === task.id)).toMatchObject({ boxMinutes: 25 });
  });
});
