// The gender and the optional modes kept in Settings, through the real web route on a real database, the same calls on
// the phone's own database, and both directions of sync (settings travel as a profile, not as rows).
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

/** The same scenario, run once against the web route and once against the phone. */
async function modesScenario(call: Call, raw: Raw) {
  const read = async () => (await call("GET", "/api/settings")).settings as { gender: string | null; modes: string | null };

  // Nobody has said anything yet.
  expect(await read()).toMatchObject({ gender: null, modes: null });

  // Both are stored; the modes in the canonical order, whatever order they arrive in.
  await call("PATCH", "/api/settings", { gender: "FEMALE", modes: "timeBoxing,athlete" });
  expect(await read()).toMatchObject({ gender: "FEMALE", modes: "athlete,timeBoxing" });

  // One field alone leaves the other as it was.
  await call("PATCH", "/api/settings", { modes: "timeBlocking" });
  expect(await read()).toMatchObject({ gender: "FEMALE", modes: "timeBlocking" });
  await call("PATCH", "/api/settings", { gender: "MALE" });
  expect(await read()).toMatchObject({ gender: "MALE", modes: "timeBlocking" });

  // A repeat is stored once; an empty text, like null, switches every mode off.
  await call("PATCH", "/api/settings", { modes: "athlete, athlete" });
  expect((await read()).modes).toBe("athlete");
  await call("PATCH", "/api/settings", { modes: "" });
  expect((await read()).modes).toBeNull();
  await call("PATCH", "/api/settings", { gender: null });
  expect(await read()).toMatchObject({ gender: null, modes: null });

  // What is not a gender or a mode is refused, and nothing changes.
  expect((await raw("PATCH", "/api/settings", { gender: "OTHER" })).status).toBe(400);
  expect((await raw("PATCH", "/api/settings", { modes: "athlete,cycle" })).status).toBe(400);
  expect((await raw("PATCH", "/api/settings", { modes: "x".repeat(200) })).status).toBe(400);
  expect(await read()).toMatchObject({ gender: null, modes: null });

  // The other settings are untouched by all of it.
  await call("PATCH", "/api/settings", { wakeHour: 6, modes: "timeBoxing" });
  expect(await read()).toMatchObject({ modes: "timeBoxing", wakeHour: 6 });
}

describe("gender and modes", () => {
  it("work on the web", async () => {
    await server.registerUser();
    await modesScenario(
      (m, u, b) => server.mustWeb(m, u, b),
      (m, u, b) => server.web(m, u, b)
    );
  });

  it("work the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await modesScenario(
      async (m, u, b) => phone.must(m, u, b),
      async (m, u, b) => phone.request(m, u, b)
    );
  });
});

describe("gender and modes sync", () => {
  it("travel with the account from the phone to the web and back", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);

    phone.must("PATCH", "/api/settings", { gender: "FEMALE", modes: "athlete,timeBoxing" });
    await syncUntilQuiet(phone);

    server.setWebSession(account.token);
    expect((await server.mustWeb("GET", "/api/settings")).settings).toMatchObject({ gender: "FEMALE", modes: "athlete,timeBoxing" });

    // The web switches one mode off and says nothing about gender; the phone sees it after its next sync.
    await tick();
    await server.mustWeb("PATCH", "/api/settings", { modes: "athlete" });
    await syncUntilQuiet(phone);
    expect(phone.must("GET", "/api/settings").settings).toMatchObject({ gender: "FEMALE", modes: "athlete" });
  });
});
