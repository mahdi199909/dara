// Account security and the owner's dashboard, against the real route handlers and a scratch database:
// one-time codes (sign-in, password reset, verifying an address or a phone), revocable sessions, suspension,
// the per-account sign-in limit, and the owner-only user/subscription routes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";
// Loaded only after the harness has pointed Prisma at its scratch database (see beforeAll): importing
// them earlier would create the Prisma client against the developer's own database first.
let getDevOutbox: typeof import("@/lib/messaging").getDevOutbox;
let clearDevOutbox: typeof import("@/lib/messaging").clearDevOutbox;
let resetAllRateLimits: typeof import("@/lib/rateLimit").resetAllRateLimits;

vi.setConfig({ testTimeout: 60_000 });

const OWNER = "owner-" + Date.now() + "@example.test";
let server: ServerHarness;

beforeAll(async () => {
  process.env.ADMIN_EMAIL = OWNER;
  server = await createServerHarness();
  ({ getDevOutbox, clearDevOutbox } = await import("@/lib/messaging"));
  ({ resetAllRateLimits } = await import("@/lib/rateLimit"));
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  clearDevOutbox();
  resetAllRateLimits();
});

/** The code the dev outbox holds for this address or number (the newest one). */
function lastCodeFor(to: string): string {
  const message = [...getDevOutbox()].reverse().find((m) => m.to === to);
  if (!message?.code) throw new Error("no code was sent to " + to);
  return message.code;
}

/** Makes the database think the resend cooldown is over for this target. */
async function skipCooldown(target: string) {
  await server.prisma.verificationCode.updateMany({ where: { target }, data: { createdAt: new Date(Date.now() - 120_000) } });
}

describe("signing in with a one-time code", () => {
  it("sends a code to the address, signs in with it once, and marks the address verified", async () => {
    const { email, userId } = await server.registerUser();
    server.setWebSession(undefined);

    const sent = await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: email });
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ ok: true, channel: "EMAIL", retryAfterSeconds: 60 });
    expect(sent.json.sentTo).not.toBe(email);
    const code = lastCodeFor(email);

    const login = await server.web("POST", "/api/auth/code/login", { identifier: email.toUpperCase(), code });
    expect(login.status).toBe(200);
    expect(login.json).toMatchObject({ id: userId, email });
    expect(typeof login.json.token).toBe("string");
    expect((await server.prisma.user.findUnique({ where: { id: userId } })).emailVerifiedAt).not.toBeNull();

    // The same code cannot be used twice.
    const again = await server.web("POST", "/api/auth/code/login", { identifier: email, code });
    expect(again.status).toBe(400);
    expect(again.json.code).toBe("AUTH-006");
  });

  it("answers the same for an address with no account, and sends nothing", async () => {
    const res = await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: "nobody-here@example.test" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, channel: "EMAIL" });
    expect(getDevOutbox()).toHaveLength(0);
    // …and a guessed code gets nowhere.
    const guess = await server.web("POST", "/api/auth/code/login", { identifier: "nobody-here@example.test", code: "123456" });
    expect(guess.status).toBe(400);
  });

  it("makes a second request wait for the cooldown, and retires the older code", async () => {
    const { email } = await server.registerUser();
    await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: email });
    const first = lastCodeFor(email);
    const tooSoon = await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: email });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.json.code).toBe("AUTH-010");

    await skipCooldown(email);
    await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: email });
    const second = lastCodeFor(email);
    if (first !== second) {
      expect((await server.web("POST", "/api/auth/code/login", { identifier: email, code: first })).status).toBe(400);
    }
    expect((await server.web("POST", "/api/auth/code/login", { identifier: email, code: second })).status).toBe(200);
  });

  it("kills a code after five wrong tries, even if the right one comes next", async () => {
    const { email } = await server.registerUser();
    await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: email });
    const code = lastCodeFor(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await server.web("POST", "/api/auth/code/login", { identifier: email, code: wrong })).status).toBe(400);
    expect((await server.web("POST", "/api/auth/code/login", { identifier: email, code })).status).toBe(400);
  });
});

describe("forgot password", () => {
  it("resets the password with a code, ends every old session, and the new password works", async () => {
    const { email, token: oldToken } = await server.registerUser();

    await server.web("POST", "/api/auth/code/request", { purpose: "RESET_PASSWORD", identifier: email });
    const reset = await server.web("POST", "/api/auth/code/reset-password", { identifier: email, code: lastCodeFor(email), newPassword: "brand-new-pass" });
    expect(reset.status).toBe(200);

    server.setWebSession(oldToken);
    expect((await server.web("GET", "/api/account")).status).toBe(401);
    server.setWebSession(reset.json.token);
    expect((await server.web("GET", "/api/account")).status).toBe(200);

    expect((await server.web("POST", "/api/auth/login", { email, password: "secret123" })).status).toBe(401);
    expect((await server.web("POST", "/api/auth/login", { email, password: "brand-new-pass" })).status).toBe(200);
  });

  it("refuses a new password shorter than eight characters", async () => {
    const { email } = await server.registerUser();
    await server.web("POST", "/api/auth/code/request", { purpose: "RESET_PASSWORD", identifier: email });
    const res = await server.web("POST", "/api/auth/code/reset-password", { identifier: email, code: lastCodeFor(email), newPassword: "short" });
    expect(res.status).toBe(400);
  });
});

describe("verifying the email and a phone number", () => {
  it("verifies the email with a code sent to it", async () => {
    const { email } = await server.registerUser();
    expect((await server.mustWeb("GET", "/api/account")).emailVerified).toBe(false);
    await server.mustWeb("POST", "/api/account/email/send-code", {});
    expect((await server.web("POST", "/api/account/email/verify", { code: "999999" === lastCodeFor(email) ? "888888" : "999999" })).status).toBe(400);
    await server.mustWeb("POST", "/api/account/email/verify", { code: lastCodeFor(email) });
    expect((await server.mustWeb("GET", "/api/account")).emailVerified).toBe(true);
  });

  it("adds a phone only once its code comes back; then it signs in by password and by SMS code", async () => {
    const { email, userId } = await server.registerUser();
    const sent = await server.mustWeb("POST", "/api/account/phone/send-code", { phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹" });
    expect(sent.phone).toBe("09123456789");
    expect((await server.prisma.user.findUnique({ where: { id: userId } })).phone).toBeNull();

    await server.mustWeb("POST", "/api/account/phone/verify", { phone: "09123456789", code: lastCodeFor("09123456789") });
    const account = await server.mustWeb("GET", "/api/account");
    expect(account).toMatchObject({ phone: "09123456789", phoneVerified: true });

    server.setWebSession(undefined);
    const byPassword = await server.web("POST", "/api/auth/login", { identifier: "+989123456789", password: "secret123" });
    expect(byPassword.status).toBe(200);
    expect(byPassword.json.email).toBe(email);

    await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: "09123456789" });
    const bySms = await server.web("POST", "/api/auth/code/login", { identifier: "09123456789", code: lastCodeFor("09123456789") });
    expect(bySms.status).toBe(200);
    expect(bySms.json.id).toBe(userId);
  });

  it("will not give one verified number to a second account", async () => {
    await server.registerUser();
    await server.mustWeb("POST", "/api/account/phone/send-code", { phone: "09350000001" });
    await server.mustWeb("POST", "/api/account/phone/verify", { phone: "09350000001", code: lastCodeFor("09350000001") });

    await server.registerUser();
    const res = await server.web("POST", "/api/account/phone/send-code", { phone: "09350000001" });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("AUTH-009");
  });

  it("refuses something that is not an Iranian mobile number", async () => {
    await server.registerUser();
    expect((await server.web("POST", "/api/account/phone/send-code", { phone: "12345" })).status).toBe(400);
  });
});

describe("sessions", () => {
  it("changing the password ends the other sessions and hands this device a fresh token", async () => {
    const { email, token: oldToken } = await server.registerUser();
    const wrong = await server.web("POST", "/api/account/password", { currentPassword: "not-it", newPassword: "another-pass-1" });
    expect(wrong.status).toBe(400);

    const changed = await server.mustWeb("POST", "/api/account/password", { currentPassword: "secret123", newPassword: "another-pass-1" });
    server.setWebSession(oldToken);
    expect((await server.web("GET", "/api/account")).status).toBe(401);
    server.setWebSession(changed.token);
    expect((await server.web("GET", "/api/account")).status).toBe(200);
    expect((await server.web("POST", "/api/auth/login", { email, password: "another-pass-1" })).status).toBe(200);
  });

  it("sign out everywhere else ends older tokens, including a phone's bearer token for sync", async () => {
    const { token: phoneToken } = await server.registerUser();
    const out = await server.mustWeb("POST", "/api/account/logout-all", {});
    server.setWebSession(phoneToken);
    expect((await server.web("GET", "/api/sync/pull")).status).toBe(401);
    server.setWebSession(out.token);
    expect((await server.web("GET", "/api/account")).status).toBe(200);
  });

  it("locks one account after ten wrong passwords, whatever address the attempts claim to come from", async () => {
    const { email } = await server.registerUser();
    server.setWebSession(undefined);
    for (let i = 0; i < 10; i++) expect((await server.web("POST", "/api/auth/login", { email, password: "wrong-" + i })).status).toBe(401);
    const locked = await server.web("POST", "/api/auth/login", { email, password: "secret123" });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe("AUTH-002");
  });
});

describe("the owner's dashboard", () => {
  it("lists every account with its subscription, extends one, suspends and restores it — and records it all against the owner", async () => {
    const target = await server.registerUser();
    await server.mustWeb("GET", "/api/license/status"); // starts the target's 30-day trial
    const owner = await server.registerUser(OWNER);

    const list = await server.mustWeb("GET", "/api/admin/users?filter=trial&q=" + encodeURIComponent(target.email));
    expect(list.total).toBe(1);
    expect(list.users[0]).toMatchObject({ id: target.userId, license: { status: "TRIAL" } });
    const trialEnd = new Date(list.users[0].license.endsAt).getTime();

    // +30 days on a running trial: a subscription that starts where the trial ends.
    const extended = await server.mustWeb("POST", `/api/admin/users/${target.userId}/license`, { action: "extend", days: 30 });
    expect(extended.status).toBe("SUBSCRIBED");
    expect(Math.round((new Date(extended.endsAt).getTime() - trialEnd) / 86_400_000)).toBe(30);

    const stats = await server.mustWeb("GET", "/api/admin/stats");
    expect(stats.byStatus.SUBSCRIBED).toBeGreaterThanOrEqual(1);
    expect(stats.signupsByDay).toHaveLength(30);

    await server.mustWeb("POST", `/api/admin/users/${target.userId}/actions`, { action: "disable" });
    server.setWebSession(target.token);
    const blocked = await server.web("GET", "/api/account");
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe("AUTH-007");
    const signIn = await server.web("POST", "/api/auth/login", { email: target.email, password: "secret123" });
    expect(signIn.status).toBe(403);

    server.setWebSession(owner.token);
    await server.mustWeb("POST", `/api/admin/users/${target.userId}/actions`, { action: "enable" });
    expect((await server.web("POST", "/api/auth/login", { email: target.email, password: "secret123" })).status).toBe(200);

    server.setWebSession(owner.token);
    const detail = await server.mustWeb("GET", `/api/admin/users/${target.userId}`);
    expect(detail.history.map((h: { event: string }) => h.event)).toEqual(expect.arrayContaining(["LICENSE_ADMIN_UPDATED", "USER_ADMIN_DISABLED", "USER_ADMIN_ENABLED"]));
    const rows = await server.prisma.auditLog.findMany({ where: { source: "admin", event: "USER_ADMIN_DISABLED" } });
    expect(rows.every((r: { userId: string }) => r.userId === owner.userId)).toBe(true);

    // The owner cannot lock themselves out.
    expect((await server.web("POST", `/api/admin/users/${owner.userId}/actions`, { action: "disable" })).status).toBe(422);
  });

  it("is closed to everyone else", async () => {
    const someone = await server.registerUser();
    for (const url of ["/api/admin/users", "/api/admin/stats", `/api/admin/users/${someone.userId}`]) {
      const res = await server.web("GET", url);
      expect(res.status, url).toBe(403);
    }
    expect((await server.web("POST", `/api/admin/users/${someone.userId}/license`, { action: "lifetime" })).status).toBe(403);
    expect((await server.prisma.license.findUnique({ where: { userId: someone.userId } }))?.status ?? "none").not.toBe("LIFETIME");
  });
});
