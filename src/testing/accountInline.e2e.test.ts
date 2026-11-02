// A person's first account made on the spot (under the account choice of a task or an event) and then used: the
// amount lands in THAT account, no cash «صندوق» appears next to it, and the next entry with no account named
// goes to it too. The same on the web routes and on the phone, since the form calls the same /api/accounts.
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

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});

type Call = (method: string, url: string, body?: unknown) => Promise<any>;
interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
}
const when = (hour: number) => new Date(2026, 10, 3, hour, 0, 0).toISOString();

async function firstAccountScenario(call: Call) {
  const accounts = async () => (await call("GET", "/api/accounts")).accounts as Account[];
  const accountOf = async (description: string) => ((await call("GET", "/api/transactions")).transactions as Array<{ description: string; accountId: string }>).find((t) => t.description === description)?.accountId;

  // Nobody has an account yet: the form shows only «+ افزودن حساب».
  expect(await accounts()).toEqual([]);

  // Made from the form: a bank account with a starting balance.
  const bank = (await call("POST", "/api/accounts", { name: "بانک ملی", type: "BANK_ACCOUNT", initialBalance: 1_000_000 })).account as Account;
  expect(bank).toMatchObject({ name: "بانک ملی", type: "BANK_ACCOUNT" });

  // An event with a cost and a task with an income, both naming it.
  await call("POST", "/api/events", { title: "شام بیرون", startAt: when(20), endAt: when(21), directCost: 250_000, accountId: bank.id });
  await call("POST", "/api/tasks", { title: "پروژهٔ طراحی", incomeAmount: 400_000, accountId: bank.id });
  expect(await accountOf("شام بیرون")).toBe(bank.id);
  expect(await accountOf("پروژهٔ طراحی")).toBe(bank.id);

  // No cash «صندوق» was made next to it, and the balance moved by exactly those two amounts.
  const afterFirst = await accounts();
  expect(afterFirst.map((a) => a.name)).toEqual(["بانک ملی"]);
  expect(afterFirst[0].balance).toBe(1_000_000 - 250_000 + 400_000);

  // The next entry that names no account goes to the only (so the default) account.
  await call("POST", "/api/tasks", { title: "ناهار", directCost: 90_000 });
  expect(await accountOf("ناهار")).toBe(bank.id);
  expect((await accounts()).map((a) => a.name)).toEqual(["بانک ملی"]);

  // A second bank added later (from the same place, or from Finance) can be picked for one entry.
  const second = (await call("POST", "/api/accounts", { name: "بانک ملت", type: "BANK_ACCOUNT" })).account as Account;
  await call("POST", "/api/tasks", { title: "کرایه", directCost: 30_000, accountId: second.id });
  expect(await accountOf("کرایه")).toBe(second.id);
  const finalAccounts = await accounts();
  expect(finalAccounts.find((a) => a.id === second.id)?.balance).toBe(-30_000);
  expect(finalAccounts.find((a) => a.id === bank.id)?.balance).toBe(1_000_000 - 250_000 + 400_000 - 90_000);

  // Starting without a name is refused the same way on both sides (the form checks it first, the API insists).
  return call;
}

describe("the first account, made from inside a task or an event", () => {
  it("works on the web", async () => {
    await server.registerUser();
    await firstAccountScenario((m, u, b) => server.mustWeb(m, u, b));
  });

  it("works the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await firstAccountScenario(async (m, u, b) => phone.must(m, u, b));
  });

  it("refuses an account with no name, on both sides", async () => {
    await server.registerUser();
    expect((await server.web("POST", "/api/accounts", { name: "   ", type: "BANK_ACCOUNT" })).status).toBe(400);
    const phone = await createPhone();
    phone.activate();
    expect((await phone.request("POST", "/api/accounts", { name: "   ", type: "BANK_ACCOUNT" })).status).toBe(400);
  });
});
