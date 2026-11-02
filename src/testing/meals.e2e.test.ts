// The athlete's meals and daily target through the real web routes on a real database, the same calls on the phone's
// own database, and both directions of sync (the meals as rows, the target as a setting).
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

interface Meal {
  id: string;
  day: string;
  kind: string;
  title: string;
  kcal: number;
}
type Call = (method: string, url: string, body?: unknown) => Promise<any>;
type Raw = (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }>;

/** The same scenario, run once against the web routes and once against the phone. */
async function mealsScenario(call: Call, raw: Raw) {
  const list = async (from: string, to: string) => (await call("GET", `/api/meals?from=${from}&to=${to}`)).meals as Meal[];

  expect(await list("2026-11-01", "2026-11-30")).toEqual([]);

  // Writing meals: a day, a meal of the day, a name and whole kilocalories.
  const lunch = (await call("POST", "/api/meals", { day: "2026-11-02", kind: "LUNCH", title: "چلوکباب", kcal: 950 })).meal as Meal;
  const breakfast = (await call("POST", "/api/meals", { day: "2026-11-02", kind: "BREAKFAST", title: "  املت  ", kcal: 320 })).meal as Meal;
  const tomorrow = (await call("POST", "/api/meals", { day: "2026-11-03", kind: "DINNER", title: "سوپ", kcal: 280 })).meal as Meal;
  expect(lunch).toMatchObject({ day: "2026-11-02", kind: "LUNCH", title: "چلوکباب", kcal: 950 });
  expect(breakfast.title).toBe("املت");

  // The list is the days asked for, both ends included, in the order of day and then of writing.
  expect((await list("2026-11-02", "2026-11-02")).map((m) => m.title)).toEqual(["چلوکباب", "املت"]);
  expect((await list("2026-11-02", "2026-11-03")).map((m) => m.title)).toEqual(["چلوکباب", "املت", "سوپ"]);
  expect(await list("2026-11-04", "2026-11-09")).toEqual([]);

  // Changing a meal leaves what is not named alone.
  expect((await call("PATCH", `/api/meals/${lunch.id}`, { kcal: 900 })).meal).toMatchObject({ kcal: 900, title: "چلوکباب", kind: "LUNCH", day: "2026-11-02" });
  expect((await call("PATCH", `/api/meals/${tomorrow.id}`, { day: "2026-11-05", kind: "SNACK" })).meal).toMatchObject({ day: "2026-11-05", kind: "SNACK", kcal: 280 });
  expect((await list("2026-11-03", "2026-11-03"))).toEqual([]);

  // Deleting is soft for the rest of the app: the meal is gone from every list, and a second delete finds nothing.
  expect(await call("DELETE", `/api/meals/${breakfast.id}`)).toEqual({ ok: true });
  expect((await list("2026-11-02", "2026-11-05")).map((m) => m.title)).toEqual(["چلوکباب", "سوپ"]);
  expect((await raw("DELETE", `/api/meals/${breakfast.id}`)).status).toBe(404);
  expect((await raw("PATCH", `/api/meals/${breakfast.id}`, { kcal: 1 })).status).toBe(404);

  // What is not a meal is refused, and nothing is written.
  const bad: Array<Record<string, unknown>> = [
    { day: "2026-11-02", kind: "BRUNCH", title: "x", kcal: 10 },
    { day: "2026-11-02", kind: "LUNCH", title: "   ", kcal: 10 },
    { day: "2026-11-02", kind: "LUNCH", title: "x", kcal: 0 },
    { day: "2026-11-02", kind: "LUNCH", title: "x", kcal: 12.5 },
    { day: "2026-11-02", kind: "LUNCH", title: "x", kcal: 10_001 },
    { day: "yesterday", kind: "LUNCH", title: "x", kcal: 10 },
    { day: "2026-13-45", kind: "LUNCH", title: "x", kcal: 10 },
  ];
  for (const body of bad) expect((await raw("POST", "/api/meals", body)).status, JSON.stringify(body)).toBe(400);
  expect((await list("2026-11-01", "2026-11-30")).length).toBe(2);

  // A range has to be two days in order, and not more than about a year long.
  expect((await raw("GET", "/api/meals?from=2026-11-05&to=2026-11-01")).status).toBe(400);
  expect((await raw("GET", "/api/meals?from=2026-11-01")).status).toBe(400);
  expect((await raw("GET", "/api/meals?from=2024-01-01&to=2026-11-01")).status).toBe(400);

  // The daily target is a setting: whole kilocalories within bounds, or null for none.
  expect(((await call("GET", "/api/settings")).settings as { calorieTarget: number | null }).calorieTarget).toBeNull();
  await call("PATCH", "/api/settings", { calorieTarget: 2200 });
  expect(((await call("GET", "/api/settings")).settings as { calorieTarget: number | null }).calorieTarget).toBe(2200);
  for (const target of [499, 10_001, 2200.5]) expect((await raw("PATCH", "/api/settings", { calorieTarget: target })).status).toBe(400);
  await call("PATCH", "/api/settings", { calorieTarget: null });
  expect(((await call("GET", "/api/settings")).settings as { calorieTarget: number | null }).calorieTarget).toBeNull();
}

describe("the athlete's meals", () => {
  it("work on the web", async () => {
    const { userId } = await server.registerUser();
    await mealsScenario(
      (m, u, b) => server.mustWeb(m, u, b),
      (m, u, b) => server.web(m, u, b)
    );
    const audit = await server.prisma.auditLog.findMany({ where: { userId, entityType: "MealEntry" } });
    expect(audit.map((r: { event: string | null }) => r.event)).toEqual(expect.arrayContaining(["MEAL_CREATED", "MEAL_UPDATED", "MEAL_DELETED"]));
  });

  it("work the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await mealsScenario(
      async (m, u, b) => phone.must(m, u, b),
      async (m, u, b) => phone.request(m, u, b)
    );
  });

  it("only ever show a person their own", async () => {
    await server.registerUser();
    const meal = (await server.mustWeb("POST", "/api/meals", { day: "2026-11-02", kind: "LUNCH", title: "برنج", kcal: 400 })).meal as Meal;

    await server.registerUser();
    expect((await server.mustWeb("GET", "/api/meals?from=2026-11-01&to=2026-11-30")).meals).toEqual([]);
    expect((await server.web("PATCH", `/api/meals/${meal.id}`, { kcal: 1 })).status).toBe(404);
    expect((await server.web("DELETE", `/api/meals/${meal.id}`)).status).toBe(404);
  });
});

describe("the athlete's meals sync", () => {
  it("carry meals and the daily target from the phone to the web and back, deletions too", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);

    const first = phone.must("POST", "/api/meals", { day: "2026-11-02", kind: "BREAKFAST", title: "نان و پنیر", kcal: 300 }).meal as Meal;
    phone.must("POST", "/api/meals", { day: "2026-11-02", kind: "LUNCH", title: "قورمه", kcal: 650 });
    phone.must("PATCH", "/api/settings", { calorieTarget: 2300 });
    await syncUntilQuiet(phone);

    server.setWebSession(account.token);
    const onWeb = async () => ((await server.mustWeb("GET", "/api/meals?from=2026-11-01&to=2026-11-30")).meals as Meal[]).map((m) => [m.title, m.kcal]);
    expect(await onWeb()).toEqual([["نان و پنیر", 300], ["قورمه", 650]]);
    expect(((await server.mustWeb("GET", "/api/settings")).settings as { calorieTarget: number | null }).calorieTarget).toBe(2300);

    // The web changes one meal, removes another and writes a third; the phone sees all of it after its next sync.
    await tick();
    await server.mustWeb("PATCH", `/api/meals/${first.id}`, { kcal: 350 });
    const phoneMeals = () => (phone.must("GET", "/api/meals?from=2026-11-01&to=2026-11-30").meals as Meal[]).map((m) => [m.title, m.kcal]);
    const second = ((await server.mustWeb("GET", "/api/meals?from=2026-11-01&to=2026-11-30")).meals as Meal[]).find((m) => m.title === "قورمه")!;
    await server.mustWeb("DELETE", `/api/meals/${second.id}`);
    await server.mustWeb("POST", "/api/meals", { day: "2026-11-03", kind: "DINNER", title: "سوپ", kcal: 200 });
    await syncUntilQuiet(phone);
    expect(phoneMeals()).toEqual([["نان و پنیر", 350], ["سوپ", 200]]);

    // A deletion made on the phone reaches the web.
    await tick();
    phone.must("DELETE", `/api/meals/${first.id}`);
    await syncUntilQuiet(phone);
    expect(await onWeb()).toEqual([["سوپ", 200]]);
  });
});
