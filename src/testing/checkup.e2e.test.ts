// The public research form's routes (/api/checkup, /api/checkup/event) and the owner's view of them —
// against the real handlers and a scratch database: upsert by page, the lock after completion, the hidden
// bot field, origins, sizes, the per-address limits, the daily ceiling, and that nothing is ever read back.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";

vi.setConfig({ testTimeout: 60_000 });

const OWNER = "owner-checkup-" + Date.now() + "@example.test";
const SITE = "https://parvaapp.ir";
let server: ServerHarness;
let owner: { token: string };
let route: typeof import("@/app/api/checkup/route");
let eventRoute: typeof import("@/app/api/checkup/event/route");
let resetAllRateLimits: typeof import("@/lib/rateLimit").resetAllRateLimits;
let ipCounter = 0;

beforeAll(async () => {
  process.env.ADMIN_EMAIL = OWNER;
  server = await createServerHarness();
  route = await import("@/app/api/checkup/route");
  eventRoute = await import("@/app/api/checkup/event/route");
  ({ resetAllRateLimits } = await import("@/lib/rateLimit"));
  owner = await server.registerUser(OWNER);
}, 120_000);
afterAll(async () => {
  await server?.dispose();
});
beforeEach(() => {
  resetAllRateLimits();
  delete process.env.CHECKUP_DAILY_CAP;
});

const uuid = () => crypto.randomUUID();
const freshIp = () => `198.51.100.${++ipCounter % 250}`;

function request(path: string, body: unknown, { origin = SITE, ip = "203.0.113.9", method = "POST" }: { origin?: string | null; ip?: string; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": ip };
  if (origin) headers.origin = origin;
  return new NextRequest(`http://server.local${path}`, { method, headers, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
}

async function save(body: unknown, opts?: Parameters<typeof request>[2]) {
  const res = await route.POST(request("/api/checkup", body, opts));
  return { status: res.status, json: await res.json(), headers: res.headers };
}
async function event(body: unknown, opts?: Parameters<typeof request>[2]) {
  const res = await eventRoute.POST(request("/api/checkup/event", body, opts));
  return { status: res.status, json: await res.json() };
}

const ANSWERS = {
  wake: "08:00",
  sleep: "01:00",
  tasks: [{ title: "پروژه", hours: 7 }],
  rest: ["phone", "forgot"],
  hourly: 200000,
  regret: "یک هدفون",
  tools: ["paper"],
  toolLastOpened: "stopped",
  toolWhyLeft: "یادم می‌رفت بنویسم",
  income: "project",
  contactTelegram: "@someone_1",
  interview: "yes",
};

describe("saving answers", () => {
  it("creates a sheet on the first page, updates it page by page, recomputes every number itself, and completes it", async () => {
    const id = uuid();
    expect((await save({ id, page: 1, answers: {}, source: "IG-Shanbe" })).status).toBe(200);
    let row = await server.prisma.checkupResponse.findUnique({ where: { id } });
    expect(row).toMatchObject({ lastPage: 1, source: "ig-shanbe", sourceGroup: "branded", completedAt: null });
    expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/);

    await save({ id, page: 3, answers: ANSWERS, source: "something-else" });
    await save({ id, page: 2, answers: ANSWERS });
    row = await server.prisma.checkupResponse.findUnique({ where: { id } });
    expect(row).toMatchObject({ lastPage: 3, source: "ig-shanbe", awakeMinutes: 1020, namedMinutes: 420, hiddenMinutes: 600, restOfDayForgot: true, hourlyValue: 200000 });

    const done = await save({ id, page: 5, answers: ANSWERS, completed: true, durationSec: 280 });
    expect(done).toMatchObject({ status: 200, json: { ok: true } });
    row = await server.prisma.checkupResponse.findUnique({ where: { id } });
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row).toMatchObject({ lastPage: 5, durationSec: 280, contactTelegram: "someone_1", interviewOk: true, toolLastOpened: "stopped" });
    expect(JSON.parse(row.answersJson).toolWhyLeft).toBe("یادم می‌رفت بنویسم");
  });

  it("refuses to change a completed sheet, or one older than three hours", async () => {
    const id = uuid();
    await save({ id, page: 5, answers: ANSWERS, completed: true });
    const again = await save({ id, page: 5, answers: { ...ANSWERS, hourly: 1 }, completed: true });
    expect(again).toMatchObject({ status: 409, json: { ok: false, code: "CHECKUP-001" } });
    expect((await server.prisma.checkupResponse.findUnique({ where: { id } })).hourlyValue).toBe(200000);

    const old = uuid();
    await save({ id: old, page: 1, answers: {} });
    await server.prisma.checkupResponse.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 4 * 3600 * 1000) } });
    expect((await save({ id: old, page: 2, answers: ANSWERS })).status).toBe(409);
  });

  it("answers a filled hidden field with success but stores nothing", async () => {
    const id = uuid();
    expect(await save({ id, page: 1, answers: {}, hp: "http://spam.example" })).toMatchObject({ status: 200, json: { ok: true } });
    expect(await server.prisma.checkupResponse.findUnique({ where: { id } })).toBeNull();
  });

  it("never sends stored data back, and never says which field was wrong", async () => {
    const id = uuid();
    const res = await save({ id, page: 1, answers: ANSWERS });
    expect(Object.keys(res.json)).toEqual(["ok"]);
    const bad = await save({ id, page: 1, answers: { monthSpend: "x" } });
    expect(bad).toMatchObject({ status: 400, json: { ok: false, code: "VAL-001" } });
    expect(Object.keys(bad.json).sort()).toEqual(["code", "ok"]);
    expect((await save("not json")).status).toBe(400);
    expect((await save({ id, page: 1, answers: {}, isAdmin: true })).status).toBe(400);
  });

  it("refuses a body larger than the form ever sends", async () => {
    const res = await save({ id: uuid(), page: 1, answers: {}, hp: "", pad: "x".repeat(20_000) });
    expect(res).toMatchObject({ status: 413, json: { code: "CHECKUP-005" } });
  });
});

describe("origins (CORS)", () => {
  it("gives the site's own origin the CORS headers, and refuses any other origin or none at all", async () => {
    const ok = await save({ id: uuid(), page: 1, answers: {} });
    expect(ok.headers.get("access-control-allow-origin")).toBe(SITE);

    for (const origin of ["https://evil.example", "https://parvaapp.ir.evil.example", "null", null]) {
      const id = uuid();
      const res = await save({ id, page: 1, answers: {} }, { origin });
      expect(res.status, String(origin)).toBe(403);
      expect(res.json.code).toBe("CHECKUP-004");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(await server.prisma.checkupResponse.findUnique({ where: { id } })).toBeNull();
    }
  });

  it("answers the preflight for allowed origins only", async () => {
    const allowed = await route.OPTIONS(new Request("http://server.local/api/checkup", { method: "OPTIONS", headers: { origin: "https://www.parvaapp.ir" } }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://www.parvaapp.ir");
    const refused = await eventRoute.OPTIONS(new Request("http://server.local/api/checkup/event", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("limits", () => {
  it("allows 30 new sheets an hour per address, counting an IPv6 /64 as one address", async () => {
    const ip = "2001:db8:aa:bb::1";
    for (let i = 0; i < 30; i++) expect((await save({ id: uuid(), page: 1, answers: {} }, { ip: `2001:db8:aa:bb::${i + 1}` })).status).toBe(200);
    const refused = await save({ id: uuid(), page: 1, answers: {} }, { ip: "2001:db8:aa:bb:ffff::9" });
    expect(refused).toMatchObject({ status: 429, json: { code: "CHECKUP-002" } });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await save({ id: uuid(), page: 1, answers: {} }, { ip: "2001:db8:aa:cc::1" })).status).toBe(200);
    void ip;
  });

  it("caps writes per address, page saves included", async () => {
    const id = uuid();
    const ip = freshIp();
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await save({ id, page: 1, answers: {} }, { ip })).status;
    expect(last).toBe(429);
  });

  it("stops storing new sheets for the whole server at the daily ceiling, while existing sheets still save", async () => {
    const existing = uuid();
    await save({ id: existing, page: 1, answers: {} }, { ip: freshIp() });
    const count = await server.prisma.checkupResponse.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    process.env.CHECKUP_DAILY_CAP = String(count);
    const id = uuid();
    expect(await save({ id, page: 1, answers: {} }, { ip: freshIp() })).toMatchObject({ status: 429, json: { code: "CHECKUP-003" } });
    expect(await server.prisma.checkupResponse.findUnique({ where: { id } })).toBeNull();
    expect((await save({ id: existing, page: 2, answers: {} }, { ip: freshIp() })).status).toBe(200);
  });
});

describe("report events", () => {
  it("stamps the first time of each kind only, and only on a sheet that exists", async () => {
    const id = uuid();
    await save({ id, page: 5, answers: ANSWERS, completed: true });
    expect((await event({ id, type: "report_viewed" })).status).toBe(200);
    const first = (await server.prisma.checkupResponse.findUnique({ where: { id } })).reportViewedAt;
    await new Promise((r) => setTimeout(r, 5));
    await event({ id, type: "report_viewed" });
    expect((await server.prisma.checkupResponse.findUnique({ where: { id } })).reportViewedAt).toEqual(first);
    await event({ id, type: "share" });
    expect((await server.prisma.checkupResponse.findUnique({ where: { id } })).sharedAt).toBeInstanceOf(Date);

    expect(await event({ id: uuid(), type: "share" })).toMatchObject({ status: 404, json: { code: "CHECKUP-006" } });
    expect((await event({ id, type: "hack" })).status).toBe(400);
    expect((await event({ id, type: "share" }, { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("the owner's view", () => {
  it("is for the owner only, and its CSV neutralises formulas typed into answers", async () => {
    const id = uuid();
    await save({ id, page: 5, answers: { ...ANSWERS, regret: '=HYPERLINK("http://evil.example/","x")' }, completed: true }, { ip: freshIp() });

    server.setWebSession(undefined);
    expect((await server.web("GET", "/api/admin/checkup")).status).toBe(401);
    await server.registerUser();
    expect((await server.web("GET", "/api/admin/checkup")).status).toBe(403);

    server.setWebSession(owner.token);
    const res = await server.web("GET", "/api/admin/checkup?group=branded");
    expect(res.status).toBe(200);
    expect(res.json.metrics.qualitativeOnly).toBe(true);
    expect(JSON.stringify(res.json.metrics)).not.toMatch(/"pct":\d/);
    const blind = await server.web("GET", "/api/admin/checkup?group=blind");
    expect(blind.json.metrics.funnel.started).toBe(0);

    const all = await server.web("GET", "/api/admin/checkup");
    expect(all.json.texts.regret.some((t: { text: string }) => t.text.startsWith("=HYPERLINK"))).toBe(true);
    const csv = await server.web("GET", "/api/admin/checkup/export");
    expect(csv.status).toBe(200);
    expect(csv.json.raw).toContain(`"'=HYPERLINK(`);
    expect(csv.json.raw).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});
