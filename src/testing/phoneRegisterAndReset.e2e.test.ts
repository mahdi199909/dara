// Sign-up on an email OR a mobile number (separate columns, either one signs in afterwards), and the owner's
// manual password reset with the forced change at the next sign-in — against the real route handlers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";
let getDevOutbox: typeof import("@/lib/messaging").getDevOutbox;
let clearDevOutbox: typeof import("@/lib/messaging").clearDevOutbox;
let resetAllRateLimits: typeof import("@/lib/rateLimit").resetAllRateLimits;

vi.setConfig({ testTimeout: 60_000 });

const OWNER = "owner-" + Date.now() + "@example.test";
let server: ServerHarness;
let ownerToken = "";

beforeAll(async () => {
  process.env.ADMIN_EMAIL = OWNER;
  server = await createServerHarness();
  ({ getDevOutbox, clearDevOutbox } = await import("@/lib/messaging"));
  ({ resetAllRateLimits } = await import("@/lib/rateLimit"));
  ownerToken = (await server.registerUser(OWNER)).token;
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  clearDevOutbox();
  resetAllRateLimits();
  server.setWebSession(undefined);
});

function lastCodeFor(to: string): string {
  const message = [...getDevOutbox()].reverse().find((m) => m.to === to);
  if (!message?.code) throw new Error("no code was sent to " + to);
  return message.code;
}

let phoneCounter = 0;
function newPhone(): string {
  phoneCounter += 1;
  return "0912" + String(Date.now()).slice(-4) + String(phoneCounter).padStart(3, "0");
}

describe("registering with a mobile number", () => {
  it("creates an account with no email, phone already verified, and the same number signs in by password and by code", async () => {
    const phone = newPhone();
    const sent = await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: phone });
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ ok: true, channel: "SMS" });

    const created = await server.web("POST", "/api/auth/code/register", { name: "فرد موبایلی", identifier: phone, code: lastCodeFor(phone), password: "phone-pass-1" });
    expect(created.status).toBe(200);
    const row = await server.prisma.user.findUnique({ where: { id: created.json.id } });
    expect(row.email).toBeNull();
    expect(row.phone).toBe(phone);
    expect(row.phoneVerifiedAt).not.toBeNull();
    // The legacy `email` field of the answer carries the phone, so older app builds still have a label to show.
    expect(created.json.email).toBe(phone);

    server.setWebSession(undefined);
    const byPassword = await server.web("POST", "/api/auth/login", { identifier: phone, password: "phone-pass-1" });
    expect(byPassword.status).toBe(200);
    expect(byPassword.json.id).toBe(created.json.id);

    await server.prisma.verificationCode.updateMany({ where: { target: phone }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: phone });
    const byCode = await server.web("POST", "/api/auth/code/login", { identifier: phone, code: lastCodeFor(phone) });
    expect(byCode.status).toBe(200);
    expect(byCode.json.id).toBe(created.json.id);
  });

  it("refuses a wrong code and a number that is already registered", async () => {
    const phone = newPhone();
    await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: phone });
    const code = lastCodeFor(phone);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await server.web("POST", "/api/auth/code/register", { name: "x", identifier: phone, code: wrong, password: "phone-pass-1" });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("AUTH-006");

    const ok = await server.web("POST", "/api/auth/code/register", { name: "x", identifier: phone, code: code, password: "phone-pass-1" });
    expect(ok.status).toBe(200);

    await server.prisma.verificationCode.updateMany({ where: { target: phone }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const again = await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: phone });
    expect(again.status).toBe(409);
  });

  it("needs a code for an email sign-up too, and stores the address verified", async () => {
    const email = "fresh-" + Date.now() + "@example.test";
    await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: email });
    const created = await server.web("POST", "/api/auth/code/register", { name: "ایمیلی", identifier: email, code: lastCodeFor(email), password: "email-pass-1" });
    expect(created.status).toBe(200);
    const row = await server.prisma.user.findUnique({ where: { id: created.json.id } });
    expect(row.email).toBe(email);
    expect(row.phone).toBeNull();
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("does not let a code for one number create an account on another", async () => {
    const a = newPhone();
    const b = newPhone();
    await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: a });
    const res = await server.web("POST", "/api/auth/code/register", { name: "x", identifier: b, code: lastCodeFor(a), password: "phone-pass-1" });
    expect(res.status).toBe(400);
  });
});

describe("the owner resets a password by hand", () => {
  it("gives a temporary password once, ends old sessions, forces a new password, and then the old and temporary ones stop working", async () => {
    const target = await server.registerUser();
    server.setWebSession(ownerToken);

    const reset = await server.mustWeb("POST", `/api/admin/users/${target.userId}/actions`, { action: "reset-password" });
    const temp: string = reset.temporaryPassword;
    expect(temp).toMatch(/^[A-Za-z0-9]{10}$/);

    // The old session and the old password are gone.
    server.setWebSession(target.token);
    expect((await server.web("GET", "/api/account")).status).toBe(401);
    server.setWebSession(undefined);
    expect((await server.web("POST", "/api/auth/login", { email: target.email, password: "secret123" })).status).toBe(401);

    // The temporary password signs in and says a new one must be chosen.
    const login = await server.web("POST", "/api/auth/login", { email: target.email, password: temp });
    expect(login.status).toBe(200);
    expect(login.json.mustChangePassword).toBe(true);

    // The new password needs no "current password" this one time.
    server.setWebSession(login.json.token);
    const changed = await server.web("POST", "/api/account/password", { newPassword: "my-own-pass-9" });
    expect(changed.status).toBe(200);
    server.setWebSession(undefined);
    expect((await server.web("POST", "/api/auth/login", { email: target.email, password: temp })).status).toBe(401);
    const final = await server.web("POST", "/api/auth/login", { email: target.email, password: "my-own-pass-9" });
    expect(final.status).toBe(200);
    expect(final.json.mustChangePassword).toBe(false);

    // Afterwards a change asks for the current password again.
    server.setWebSession(final.json.token);
    expect((await server.web("POST", "/api/account/password", { newPassword: "another-pass-77" })).status).toBe(400);
  });

  it("works for an account that only has a phone, and is for the owner alone", async () => {
    const phone = newPhone();
    await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: phone });
    const created = await server.web("POST", "/api/auth/code/register", { name: "x", identifier: phone, code: lastCodeFor(phone), password: "phone-pass-1" });
    const stranger = await server.registerUser();

    server.setWebSession(stranger.token);
    expect((await server.web("POST", `/api/admin/users/${created.json.id}/actions`, { action: "reset-password" })).status).toBe(403);

    server.setWebSession(ownerToken);
    const reset = await server.mustWeb("POST", `/api/admin/users/${created.json.id}/actions`, { action: "reset-password" });
    server.setWebSession(undefined);
    const login = await server.web("POST", "/api/auth/login", { identifier: phone, password: reset.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.json.mustChangePassword).toBe(true);
  });
});

describe("registering with a mobile number, no code (while there is no SMS gateway)", () => {
  it("creates the account with the number unverified, signs in by password, and keeps codes closed to it", async () => {
    const phone = newPhone();
    const created = await server.web("POST", "/api/auth/register", { name: "بی‌کد", phone, password: "phone-pass-1" });
    expect(created.status).toBe(200);
    const row = await server.prisma.user.findUnique({ where: { id: created.json.id } });
    expect(row.email).toBeNull();
    expect(row.phone).toBe(phone);
    expect(row.phoneVerifiedAt).toBeNull();

    server.setWebSession(undefined);
    const login = await server.web("POST", "/api/auth/login", { identifier: phone, password: "phone-pass-1" });
    expect(login.status).toBe(200);
    expect(login.json.id).toBe(created.json.id);
    expect((await server.web("POST", "/api/auth/login", { identifier: phone, password: "wrong-pass-1" })).status).toBe(401);

    // A one-time code never opens an account whose number was not verified: nothing is sent, and no code works.
    clearDevOutbox();
    await server.web("POST", "/api/auth/code/request", { purpose: "LOGIN_OTP", identifier: phone });
    expect(getDevOutbox()).toHaveLength(0);
  });

  it("refuses a second sign-up on the same number, and accepts Persian digits", async () => {
    const phone = newPhone();
    const persian = phone.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
    expect((await server.web("POST", "/api/auth/register", { name: "x", phone: persian, password: "phone-pass-1" })).status).toBe(200);
    const again = await server.web("POST", "/api/auth/register", { name: "y", phone, password: "phone-pass-2" });
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("AUTH-005");
  });

  it("needs an email or a number, and a valid number", async () => {
    expect((await server.web("POST", "/api/auth/register", { name: "x", password: "phone-pass-1" })).status).toBe(400);
    expect((await server.web("POST", "/api/auth/register", { name: "x", phone: "12345", password: "phone-pass-1" })).status).toBe(400);
  });

  it("lets the real holder take the number over by verifying it with a code", async () => {
    const phone = newPhone();
    await server.web("POST", "/api/auth/register", { name: "claimer", phone, password: "phone-pass-1" });
    server.setWebSession(undefined);
    await server.web("POST", "/api/auth/code/request", { purpose: "REGISTER", identifier: phone });
    const code = lastCodeFor(phone);
    const real = await server.web("POST", "/api/auth/code/register", { name: "real owner", identifier: phone, code, password: "phone-pass-2" });
    expect(real.status).toBe(200);
    const holder = await server.prisma.user.findFirst({ where: { phone } });
    expect(holder.id).toBe(real.json.id);
    expect(holder.phoneVerifiedAt).not.toBeNull();
  });
});
