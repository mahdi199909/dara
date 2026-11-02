// A habit's own measure (kilometres, pages, kilocalories) through the real web routes on a real database, the same
// calls on the phone's own database, and both directions of sync. Everything about it is optional: a habit may only be
// ticked, and logging minutes must not wipe the amount (nor the amount the minutes).
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

import { dayKeyIso } from "@/lib/calendarGrid";
import { toJalali } from "@/lib/jalali";
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

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};
const habitRow = async (call: Call, id: string) => ((await call("GET", "/api/habits")).habits as any[]).find((h) => h.id === id);

/** The same scenario, run once against the web routes and once against the phone. */
async function metricScenario(call: Call, raw: Raw) {
  // A habit that measures kilometres, and one that is only ticked.
  const run = (await call("POST", "/api/habits", { title: "دویدن", metricKind: "DISTANCE" })).habit;
  const plain = (await call("POST", "/api/habits", { title: "مسواک" })).habit;
  expect(run.metricKind).toBe("DISTANCE");
  expect(plain.metricKind ?? null).toBeNull();
  expect((await raw("POST", "/api/habits", { title: "x", metricKind: "SPEED" })).status).toBe(400);

  // The tick alone is complete: no minutes, no amount.
  expect(await call("POST", `/api/habits/${run.id}/checkin`)).toEqual({ checkedIn: true });
  expect(await habitRow(call, run.id)).toMatchObject({ checkedInToday: true, todayAmount: null, todayDurationMin: null, metricKind: "DISTANCE" });

  // An amount alone, then minutes alone: neither wipes the other.
  expect((await call("PATCH", `/api/habits/${run.id}/checkin`, { amount: 5.5 })).checkIn).toMatchObject({ amount: 5.5, durationMin: null });
  expect((await call("PATCH", `/api/habits/${run.id}/checkin`, { durationMin: 30 })).checkIn).toMatchObject({ amount: 5.5, durationMin: 30 });
  expect(await habitRow(call, run.id)).toMatchObject({ todayAmount: 5.5, todayDurationMin: 30 });

  // 0 clears just that field.
  expect((await call("PATCH", `/api/habits/${run.id}/checkin`, { amount: 0 })).checkIn).toMatchObject({ amount: null, durationMin: 30 });
  await call("PATCH", `/api/habits/${run.id}/checkin`, { amount: 7 });

  // A body that says nothing, or something out of range, is refused.
  expect((await raw("PATCH", `/api/habits/${run.id}/checkin`, {})).status).toBe(400);
  expect((await raw("PATCH", `/api/habits/${run.id}/checkin`, { amount: -1 })).status).toBe(400);
  expect((await raw("PATCH", `/api/habits/${run.id}/checkin`, { durationMin: 2000 })).status).toBe(400);

  // Logging for a day that was not ticked yet ticks it (the old behaviour for minutes, now for an amount too).
  const yesterday = new Date(startOfToday().getTime() - 86_400_000);
  yesterday.setHours(0, 0, 0, 0);
  const patched = (await call("PATCH", `/api/habits/${run.id}/checkin`, { date: yesterday.toISOString(), amount: 3.2 })).checkIn;
  expect(patched.amount).toBe(3.2);

  // Where a day's list and the calendar's day sheet read it from.
  const from = startOfToday();
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 23, 59, 59, 999);
  const activity = (await call("GET", `/api/day-activity?from=${from.toISOString()}&to=${to.toISOString()}`)).items as any[];
  expect(activity.find((i) => i.type === "HABIT" && i.habitId === run.id)).toMatchObject({ habitMetricKind: "DISTANCE", habitAmount: 7, minutes: 30, amount: null });
  const detail = (await call("GET", `/api/calendar/day-detail?date=${from.toISOString()}`)).habits as any[];
  expect(detail.find((h) => h.id === run.id)).toMatchObject({ checkedIn: true, metricKind: "DISTANCE", amount: 7, durationMin: 30 });
  expect(detail.find((h) => h.id === plain.id)).toMatchObject({ checkedIn: false, metricKind: null, amount: null });

  // The habit's month, as «تقویم دسته‌بندی‌ها» reads it: the days it was done and what each tick logged.
  const { jy, jm } = toJalali(new Date());
  const month = (await call("GET", `/api/reports/habit-calendar?jy=${jy}&jm=${jm}`)).habits as any[];
  expect(month.map((h) => h.habitId).sort()).toEqual([run.id, plain.id].sort());
  expect(month.find((h) => h.habitId === run.id)).toMatchObject({ metricKind: "DISTANCE", isActive: true });
  expect(month.find((h) => h.habitId === run.id).days[dayKeyIso(new Date())]).toEqual({ amount: 7, minutes: 30 });
  expect(month.find((h) => h.habitId === plain.id).days).toEqual({});

  // Changing what a habit measures, and taking it off.
  expect((await call("PATCH", `/api/habits/${plain.id}`, { metricKind: "PAGES" })).habit.metricKind).toBe("PAGES");
  expect((await call("PATCH", `/api/habits/${plain.id}`, { metricKind: null })).habit.metricKind).toBeNull();
  expect((await raw("PATCH", `/api/habits/${plain.id}`, { metricKind: "WEIGHT" })).status).toBe(400);

  // Ticking again takes the day off, with its amount.
  expect(await call("POST", `/api/habits/${run.id}/checkin`)).toEqual({ checkedIn: false });
  expect(await habitRow(call, run.id)).toMatchObject({ checkedInToday: false, todayAmount: null });
}

describe("habit metrics", () => {
  it("work on the web", async () => {
    await server.registerUser();
    await metricScenario(
      (m, u, b) => server.mustWeb(m, u, b),
      (m, u, b) => server.web(m, u, b)
    );
  });

  it("work the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await metricScenario(
      async (m, u, b) => phone.must(m, u, b),
      async (m, u, b) => phone.request(m, u, b)
    );
  });
});

describe("habit metrics sync", () => {
  it("carries a habit's measure and a day's amount from the phone to the web and back", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);

    const habit = phone.must("POST", "/api/habits", { title: "مطالعه", metricKind: "PAGES" }).habit;
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {});
    phone.must("PATCH", `/api/habits/${habit.id}/checkin`, { amount: 25, durationMin: 40 });
    await syncUntilQuiet(phone);

    server.setWebSession(account.token);
    expect(await habitRow((m, u, b) => server.mustWeb(m, u, b), habit.id)).toMatchObject({ metricKind: "PAGES", todayAmount: 25, todayDurationMin: 40 });

    // The web changes the amount; the phone sees it after its next sync.
    await tick();
    await server.mustWeb("PATCH", `/api/habits/${habit.id}/checkin`, { amount: 30 });
    await syncUntilQuiet(phone);
    expect(phone.must("GET", "/api/habits").habits.find((h: any) => h.id === habit.id)).toMatchObject({ todayAmount: 30, todayDurationMin: 40 });
  });
});
