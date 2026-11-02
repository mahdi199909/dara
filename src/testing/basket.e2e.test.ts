// The asset basket through the real web routes on a real database, the same calls on the phone's own database, and
// both directions of sync — including a day's value being recorded by two devices before they meet.
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

import { computeBasket } from "@/lib/basket";
import { jalaliDateKey } from "@/lib/jalali";
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

interface Holding {
  id: string;
  assetKey: string;
  quantity: number;
  note: string | null;
  createdAt: string;
}
interface Point {
  date: string;
  totalValue: number;
}
type Call = (method: string, url: string, body?: unknown) => Promise<any>;
type Raw = (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }>;

const PRICES = { usd: 271_500, gold18: 25_579_200, coin_emami: 261_420_000 };
const today = () => jalaliDateKey(new Date());

/** The same scenario, run once against the web routes and once against the phone. */
async function basketScenario(call: Call, raw: Raw) {
  const list = async () => (await call("GET", "/api/basket")).holdings as Holding[];
  const history = async (range = "1m") => (await call("GET", `/api/basket/history?range=${range}`)).points as Point[];

  expect(await list()).toEqual([]);
  expect(await history()).toEqual([]);

  // Adding an asset: dollars, grams of 18-carat gold, and Emami coins.
  const usd = (await call("POST", "/api/basket", { assetKey: "usd", quantity: 1500 })).holding as Holding;
  expect(usd).toMatchObject({ assetKey: "usd", quantity: 1500, note: null });
  const gold = (await call("POST", "/api/basket", { assetKey: "gold18", quantity: 12.5, note: "گردنبند" })).holding as Holding;
  expect(gold).toMatchObject({ assetKey: "gold18", quantity: 12.5, note: "گردنبند" });
  const coin = (await call("POST", "/api/basket", { assetKey: "coin_emami", quantity: 2 })).holding as Holding;
  expect((await list()).map((h) => h.assetKey)).toEqual(["usd", "gold18", "coin_emami"]);

  // One quantity per asset: adding it again is refused, with the same answer on both sides.
  expect((await raw("POST", "/api/basket", { assetKey: "usd", quantity: 5 })).status).toBe(409);

  // What is not allowed.
  expect((await raw("POST", "/api/basket", { assetKey: "eur", quantity: 0 })).status).toBe(400);
  expect((await raw("POST", "/api/basket", { assetKey: "eur", quantity: -3 })).status).toBe(400);
  expect((await raw("POST", "/api/basket", { assetKey: "eur", quantity: "ده" })).status).toBe(400);
  expect((await raw("POST", "/api/basket", { assetKey: "eur", quantity: 1e13 })).status).toBe(400);
  expect((await raw("POST", "/api/basket", { assetKey: "bitcoin", quantity: 1 })).status).toBe(400);
  expect((await raw("POST", "/api/basket", { assetKey: "eur", quantity: 1, note: "x".repeat(201) })).status).toBe(400);
  expect((await raw("PATCH", `/api/basket/${usd.id}`, { quantity: 0 })).status).toBe(400);
  expect((await raw("PATCH", "/api/basket/does-not-exist", { quantity: 1 })).status).toBe(404);
  expect((await raw("DELETE", "/api/basket/does-not-exist")).status).toBe(404);

  // Changing a quantity or a note.
  expect((await call("PATCH", `/api/basket/${usd.id}`, { quantity: 1800 })).holding).toMatchObject({ quantity: 1800, note: null });
  expect((await call("PATCH", `/api/basket/${gold.id}`, { note: null })).holding).toMatchObject({ quantity: 12.5, note: null });

  // The day's value is recorded from the holdings the server/phone holds and the prices the page hands over.
  const total = 1800 * PRICES.usd + Math.round(12.5 * PRICES.gold18) + 2 * PRICES.coin_emami;
  expect(await call("POST", "/api/basket/snapshot", { prices: PRICES })).toEqual({ recorded: true, total, date: today() });
  expect(await history()).toEqual([{ date: today(), totalValue: total }]);

  // The same prices again change nothing; a new price rewrites today's point rather than adding another.
  await call("POST", "/api/basket/snapshot", { prices: PRICES });
  expect(await history()).toHaveLength(1);
  const dearer = { ...PRICES, usd: 280_000 };
  const total2 = 1800 * 280_000 + Math.round(12.5 * PRICES.gold18) + 2 * PRICES.coin_emami;
  expect((await call("POST", "/api/basket/snapshot", { prices: dearer })).total).toBe(total2);
  expect(await history()).toEqual([{ date: today(), totalValue: total2 }]);
  expect(await history("all")).toEqual([{ date: today(), totalValue: total2 }]);
  expect(await history("1y")).toHaveLength(1);

  // A holding with no price yet would make the total a lie, so nothing is recorded and the day keeps its last true value.
  const { coin_emami: _left, ...withoutCoin } = PRICES;
  expect(await call("POST", "/api/basket/snapshot", { prices: withoutCoin })).toMatchObject({ recorded: false, date: today() });
  expect(await history()).toEqual([{ date: today(), totalValue: total2 }]);
  expect((await raw("POST", "/api/basket/snapshot", { prices: { usd: -1 } })).status).toBe(400);
  expect((await raw("POST", "/api/basket/snapshot", {})).status).toBe(400);
  expect((await raw("GET", "/api/basket/history?range=decade")).status).toBe(400);

  // The page sums the holdings itself with the same code.
  expect(computeBasket(await list(), dearer).total).toBe(total2);

  // Deleting takes it out of the list; the days already recorded stay in the history.
  await call("DELETE", `/api/basket/${coin.id}`);
  expect((await list()).map((h) => h.assetKey)).toEqual(["usd", "gold18"]);
  expect((await raw("DELETE", `/api/basket/${coin.id}`)).status).toBe(404);
  expect(await history()).toHaveLength(1);

  // An asset can be added again after it was deleted.
  expect((await call("POST", "/api/basket", { assetKey: "coin_emami", quantity: 1 })).holding).toMatchObject({ quantity: 1 });

  // An empty basket records nothing.
  for (const holding of await list()) await call("DELETE", `/api/basket/${holding.id}`);
  expect(await call("POST", "/api/basket/snapshot", { prices: dearer })).toEqual({ recorded: false, total: null, date: today() });
}

describe("the asset basket", () => {
  it("works on the web", async () => {
    const { userId } = await server.registerUser();
    await basketScenario(
      (m, u, b) => server.mustWeb(m, u, b),
      (m, u, b) => server.web(m, u, b)
    );
    const audit = await server.prisma.auditLog.findMany({ where: { userId, entityType: "BasketHolding" } });
    const events = audit.map((r: { event: string | null }) => r.event);
    expect(events).toEqual(expect.arrayContaining(["BASKET_CREATED", "BASKET_UPDATED", "BASKET_DELETED"]));
    // The app keeps the chart's history itself; it is not an edit by the person, so it leaves no activity entry.
    expect(audit.some((r: { entityType: string }) => r.entityType === "BasketSnapshot")).toBe(false);
  });

  it("works the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await basketScenario(
      async (m, u, b) => phone.must(m, u, b),
      async (m, u, b) => phone.request(m, u, b)
    );
  });

  it("only ever shows a person their own", async () => {
    const mine = await server.registerUser();
    const holding = (await server.mustWeb("POST", "/api/basket", { assetKey: "usd", quantity: 100 })).holding as Holding;
    await server.mustWeb("POST", "/api/basket/snapshot", { prices: { usd: 271_500 } });
    const other = await server.registerUser();
    server.setWebSession(other.token);
    expect((await server.mustWeb("GET", "/api/basket")).holdings).toEqual([]);
    expect((await server.mustWeb("GET", "/api/basket/history?range=all")).points).toEqual([]);
    expect((await server.web("PATCH", `/api/basket/${holding.id}`, { quantity: 1 })).status).toBe(404);
    expect((await server.web("DELETE", `/api/basket/${holding.id}`)).status).toBe(404);
    // Someone else's snapshot is worked out from THEIR holdings, never from mine.
    expect(await server.mustWeb("POST", "/api/basket/snapshot", { prices: { usd: 271_500 } })).toMatchObject({ recorded: false, total: null });
    server.setWebSession(mine.token);
    expect((await server.mustWeb("GET", "/api/basket")).holdings).toHaveLength(1);
    expect((await server.mustWeb("GET", "/api/basket/history?range=all")).points).toHaveLength(1);
  });
});

describe("asset basket sync", () => {
  async function linkedPhone(account: { userId: string; token: string; email: string }) {
    const phone = await createPhone();
    linkPhone(phone, account);
    return phone;
  }

  it("carries holdings and the chart's days from the phone to the web and back", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);

    const usd = phone.must("POST", "/api/basket", { assetKey: "usd", quantity: 200 }).holding as Holding;
    phone.must("POST", "/api/basket", { assetKey: "gold24", quantity: 3 });
    const snap = phone.must("POST", "/api/basket/snapshot", { prices: { usd: 271_500, gold24: 34_105_200 } });
    expect(snap.recorded).toBe(true);
    await syncUntilQuiet(phone);

    server.setWebSession(account.token);
    const web = (await server.mustWeb("GET", "/api/basket")).holdings as Holding[];
    expect(web.map((h) => [h.assetKey, h.quantity]).sort()).toEqual([["gold24", 3], ["usd", 200]]);
    expect((await server.mustWeb("GET", "/api/basket/history?range=all")).points).toEqual([{ date: today(), totalValue: snap.total }]);

    // The web changes a quantity and removes the other; the phone sees both after its next sync.
    await tick();
    await server.mustWeb("PATCH", `/api/basket/${usd.id}`, { quantity: 250 });
    await server.mustWeb("DELETE", `/api/basket/${web.find((h) => h.assetKey === "gold24")!.id}`);
    await syncUntilQuiet(phone);
    expect((phone.must("GET", "/api/basket").holdings as Holding[]).map((h) => [h.assetKey, h.quantity])).toEqual([["usd", 250]]);

    // A deletion made on the phone reaches the web.
    await tick();
    phone.must("DELETE", `/api/basket/${usd.id}`);
    await syncUntilQuiet(phone);
    expect((await server.mustWeb("GET", "/api/basket")).holdings).toEqual([]);
  });

  it("keeps both rows when two devices add the same asset before meeting, and the basket adds them up", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    phone.must("POST", "/api/basket", { assetKey: "usd", quantity: 70 });
    server.setWebSession(account.token);
    await tick();
    await server.mustWeb("POST", "/api/basket", { assetKey: "usd", quantity: 30 });
    await syncUntilQuiet(phone);

    const onWeb = (await server.mustWeb("GET", "/api/basket")).holdings as Holding[];
    const onPhone = phone.must("GET", "/api/basket").holdings as Holding[];
    expect(onWeb.map((h) => h.quantity).sort()).toEqual([30, 70]);
    expect(onPhone.map((h) => h.quantity).sort()).toEqual([30, 70]);
    expect(computeBasket(onWeb, { usd: 1000 }).lines).toMatchObject([{ quantity: 100, value: 100_000 }]);
    expect(computeBasket(onPhone, { usd: 1000 }).total).toBe(100_000);
  });

  it("shows one point for a day that two devices recorded, the later one", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    phone.must("POST", "/api/basket", { assetKey: "usd", quantity: 10 });
    await syncUntilQuiet(phone);
    server.setWebSession(account.token);

    phone.must("POST", "/api/basket/snapshot", { prices: { usd: 100 } }); // 1,000
    await tick(60);
    await server.mustWeb("POST", "/api/basket/snapshot", { prices: { usd: 300 } }); // 3,000, written later
    await syncUntilQuiet(phone);

    expect((await server.mustWeb("GET", "/api/basket/history?range=all")).points).toEqual([{ date: today(), totalValue: 3000 }]);
    expect(phone.must("GET", "/api/basket/history?range=all").points).toEqual([{ date: today(), totalValue: 3000 }]);
    // Both rows exist underneath; only the read decides.
    expect(await server.prisma.basketSnapshot.count({ where: { userId: account.userId } })).toBe(2);
  });

  it("brings what was made on the web to a phone that links afterwards", async () => {
    const account = await server.registerUser();
    await server.mustWeb("POST", "/api/basket", { assetKey: "eur", quantity: 40 });
    await server.mustWeb("POST", "/api/basket/snapshot", { prices: { eur: 303_530 } });

    const phone = await linkedPhone(account);
    await syncUntilQuiet(phone);
    expect((phone.must("GET", "/api/basket").holdings as Holding[]).map((h) => [h.assetKey, h.quantity])).toEqual([["eur", 40]]);
    expect(phone.must("GET", "/api/basket/history?range=all").points).toEqual([{ date: today(), totalValue: 40 * 303_530 }]);
  });
});
