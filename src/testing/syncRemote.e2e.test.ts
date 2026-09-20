// Acceptance check for a DEPLOYED server (skipped unless SYNC_REMOTE_BASE is set):
//
//   SYNC_REMOTE_BASE=https://my.parvaapp.ir NEXT_PUBLIC_REMOTE_API_BASE=https://my.parvaapp.ir \
//     npx vitest run src/testing/syncRemote.e2e.test.ts
//
// Runs the real phone code (on-device repositories + syncWithServer) against the real network and
// the real production Postgres, using a throwaway "@example.invalid" account, and reads the result
// back the way the web app would (the session cookie is just the login token). Unlike the local
// suite it can't see inside the database, so every assertion goes through the server's own API.
//
// It adapts to the server's build: a server that predates deletion/settings sync answers with
// protocol 0 and those checks are reported instead of asserted — run it again after redeploying.
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/local/nativeNotifications", () => ({
  requestNotificationPermission: async () => {},
  scheduleReminderNotification: () => {},
  rescheduleReminderNotification: () => {},
  cancelReminderNotification: () => {},
  cancelReminderNotifications: () => {},
  syncScheduledReminderNotifications: () => {},
}));
vi.mock("@/lib/versionGate", () => ({ cacheVersionGate: async () => {}, checkVersionGate: async () => ({ blocked: false }) }));

import { createPhone, type Phone } from "@/testing/syncHarness";
import { iso, linkPhone, syncUntilQuiet, type Account } from "@/testing/syncScenarios";

const BASE = process.env.SYNC_REMOTE_BASE;

async function remote(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Cookie: `hesabkon_session=${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

const report: Record<string, unknown> = {};

describe.skipIf(!BASE)("a deployed server, seen from a phone running this build", () => {
  let account: Account;
  let phone: Phone;
  let protocol: number | null = null;

  it("registers a throwaway account and links a phone to it", async () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
    const email = `claude-syncprobe-${Date.now()}@example.invalid`;
    const res = await remote("POST", "/api/auth/register", null, { name: "Probe", email, password: "Probe12345!" });
    expect(res.status).toBe(200);
    account = { userId: res.json.id, token: res.json.token, email };
    phone = await createPhone();
    linkPhone(phone, account);
  }, 60_000);

  it("delivers a phone's data to the server without a single refused row, and the web reads it back", async () => {
    const work = (phone.must("GET", "/api/categories").categories as Array<{ id: string; name: string }>).find((c) => c.name === "کار")!;
    phone.must("POST", "/api/tasks", { title: "کار آزمایشی گوشی", categoryId: work.id });
    const habit = phone.must("POST", "/api/habits", { title: "عادت آزمایشی", virtualAssetValuePerCheckIn: 1000 }).habit;
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {});
    const acct = phone.must("POST", "/api/accounts", { name: "بانک آزمایشی", type: "BANK_ACCOUNT" }).account;
    phone.must("POST", "/api/transactions", { type: "EXPENSE", amount: 5000, accountId: acct.id, categoryId: work.id });
    phone.must("POST", "/api/events", { title: "رویداد آزمایشی", startAt: iso(1, 10), endAt: iso(1, 11), categoryId: work.id, reminderOffsets: [10] });
    phone.must("POST", "/api/assets", { name: "دارایی آزمایشی", purchasePrice: 1_000_000, currentValue: 900_000 });

    const rounds = await syncUntilQuiet(phone);
    protocol = rounds.map((r) => r.serverProtocol).find((p) => p !== null) ?? null;
    report.rounds = rounds.map((r) => ({ ok: r.ok, pushed: r.pushedCount, pulled: r.pulledCount, rejected: r.rejectedCount, protocol: r.serverProtocol, error: r.error?.message }));
    for (const r of rounds) {
      expect(r.error, r.error?.message).toBeUndefined();
      expect(r.rejectedCount, JSON.stringify(r.issues)).toBe(0);
    }

    const web = async (p: string) => (await remote("GET", p, account.token)).json;
    expect((await web("/api/tasks")).tasks.map((t: any) => t.title)).toContain("کار آزمایشی گوشی");
    expect((await web("/api/habits")).habits.map((h: any) => h.title)).toContain("عادت آزمایشی");
    expect((await web("/api/accounts")).accounts.map((a: any) => a.name)).toContain("بانک آزمایشی");
    expect((await web("/api/transactions")).transactions.length).toBeGreaterThanOrEqual(1);
    expect((await web("/api/assets")).assets.map((a: any) => a.name)).toContain("دارایی آزمایشی");
    // The default categories both sides seeded were merged, not doubled.
    const names = (await web("/api/categories")).categories.map((c: any) => c.name) as string[];
    expect(new Set(names).size).toBe(names.length);

    // Does the web see the check-in the phone made today? Only if the server's idea of "today"
    // (its TZ) is the phone's — see the Dockerfile's TZ. Reported for every server, asserted for a
    // current one (which is deployed with TZ=Asia/Tehran).
    const habitOnWeb = (await web("/api/habits")).habits.find((h: any) => h.title === "عادت آزمایشی");
    report.webSeesPhoneCheckInToday = habitOnWeb?.checkedInToday;
    if (protocol !== null && protocol >= 2) expect(habitOnWeb?.checkedInToday).toBe(true);
  }, 120_000);

  it("delivers a task created on the web to the phone", async () => {
    const created = await remote("POST", "/api/tasks", account.token, { title: "کار آزمایشی وب" });
    expect(created.status).toBe(201);
    await syncUntilQuiet(phone);
    expect(phone.must("GET", "/api/tasks").tasks.map((t: any) => t.title)).toContain("کار آزمایشی وب");
  }, 60_000);

  it("syncs more data than the proxy's request-body limit in a single go (no 413)", async () => {
    phone.activate();
    const filler = "متن طولانی برای پر کردن حجم درخواست. ".repeat(40);
    const now = new Date().toISOString();
    for (let i = 0; i < 900; i++) {
      phone.db.run(`INSERT INTO "Task" ("id","userId","title","description","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [`probe_bulk_${i}`, "local-device-user", `حجیم ${i}`, filler, now, now]);
    }
    const rounds = await syncUntilQuiet(phone);
    report.bulk = rounds.map((r) => ({ ok: r.ok, pushed: r.pushedCount, rejected: r.rejectedCount, error: r.error?.message }));
    for (const r of rounds) expect(r.error, r.error?.message).toBeUndefined();
    const tasks = (await remote("GET", "/api/tasks", account.token)).json.tasks as Array<{ title: string }>;
    expect(tasks.filter((t) => t.title.startsWith("حجیم ")).length).toBe(900);
  }, 180_000);

  it("reports what happens to deletions (only a server that understands tombstones can propagate them)", async () => {
    const habit = (phone.must("GET", "/api/habits").habits as Array<{ id: string; title: string }>).find((h) => h.title === "عادت آزمایشی")!;
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {}); // un-check
    await syncUntilQuiet(phone);
    const remoteHabit = ((await remote("GET", "/api/habits", account.token)).json.habits as any[]).find((h) => h.title === "عادت آزمایشی");
    report.webCheckedInTodayAfterPhoneUncheck = remoteHabit?.checkedInToday;
    if (protocol !== null && protocol >= 2) expect(remoteHabit?.checkedInToday).toBe(false);
  }, 60_000);

  it("reports how an amount above the server's 32-bit column limit behaves", async () => {
    phone.must("POST", "/api/assets", { name: "دارایی خیلی بزرگ", purchasePrice: 3_000_000_000, currentValue: 3_000_000_000 });
    const outcome = (await syncUntilQuiet(phone, 2))[0];
    const viaWeb = await remote("POST", "/api/assets", account.token, { name: "بزرگ از وب", purchasePrice: 3_000_000_000, currentValue: 3_000_000_000 });
    report.int32 = { phoneSyncRejected: outcome.rejectedCount, reason: outcome.issues[0]?.reason, webStatus: viaWeb.status };
    expect(outcome.ok).toBe(true);
  }, 60_000);

  afterAll(() => {
    console.log("REMOTE ACCEPTANCE REPORT " + JSON.stringify({ base: BASE, serverProtocol: protocol, ...report }, null, 1));
  });
});
