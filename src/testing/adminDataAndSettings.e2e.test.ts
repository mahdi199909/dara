// The owner's irreversible actions (erase an account's data, delete an account) and the email/SMS settings
// edited from the dashboard — against the real route handlers and a scratch database.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { createServerHarness, type ServerHarness } from "@/testing/syncHarness";

vi.setConfig({ testTimeout: 60_000 });

const OWNER = "owner-" + Date.now() + "@example.test";
let server: ServerHarness;
let owner: { userId: string; token: string };
// Loaded after the harness has pointed Prisma at its scratch database (importing earlier would bind the
// Prisma client to the developer's own database).
let resetAllRateLimits: typeof import("@/lib/rateLimit").resetAllRateLimits;

beforeAll(async () => {
  process.env.ADMIN_EMAIL = OWNER;
  server = await createServerHarness();
  ({ resetAllRateLimits } = await import("@/lib/rateLimit"));
  owner = await server.registerUser(OWNER);
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  resetAllRateLimits();
});

/** Gives the signed-in account a bit of everything, with the links between rows that make deletion order matter. */
async function fillWithData() {
  const project = (await server.mustWeb("POST", "/api/projects", { name: "پروژه نمونه" })).project;
  const account = (await server.mustWeb("POST", "/api/accounts", { name: "نقد", type: "CASH", initialBalance: 1000 })).account;
  const task = (await server.mustWeb("POST", "/api/tasks", { title: "کار", projectId: project.id, directCost: 5000, status: "DONE" })).task;
  await server.mustWeb("POST", "/api/transactions", { type: "EXPENSE", amount: 1200, accountId: account.id, taskId: task.id, projectId: project.id });
  const start = new Date(Date.now() + 86_400_000);
  await server.mustWeb("POST", "/api/events", { title: "جلسه", startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), reminderOffsets: [30] });
  const habit = (await server.mustWeb("POST", "/api/habits", { title: "ورزش", virtualAssetValuePerCheckIn: 5000 })).habit;
  await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`);
  const plan = (await server.mustWeb("POST", "/api/installment-plans", { title: "وام", totalAmount: 300, installmentAmount: 100, numberOfInstallments: 3, firstDueDate: "2026-10-02" })).plan;
  await server.mustWeb("POST", `/api/installments/${plan.installments[0].id}/pay`, { accountId: account.id });
  const activity = (await server.mustWeb("POST", "/api/activities", { title: "مطالعه" })).activity;
  await server.mustWeb("POST", `/api/activities/${activity.id}/time-entries`, { durationMin: 30 });
  await server.mustWeb("POST", "/api/assets", { name: "لپ‌تاپ", purchasePrice: 1000 });
  await server.mustWeb("POST", "/api/notes", { day: "2026-09-21", content: "یادداشت" });
}

async function ownedRows(userId: string) {
  const p = server.prisma;
  const where = { userId };
  return {
    tasks: await p.task.count({ where }),
    transactions: await p.transaction.count({ where }),
    events: await p.event.count({ where }),
    habits: await p.habit.count({ where }),
    plans: await p.installmentPlan.count({ where }),
    accounts: await p.financeAccount.count({ where }),
    projects: await p.project.count({ where }),
    notes: await p.dailyNote.count({ where }),
    activities: await p.activity.count({ where }),
    assets: await p.asset.count({ where }),
    reminders: await p.reminder.count({ where }),
  };
}

describe("erasing an account's data, and deleting an account", () => {
  it("erases every record but keeps the account, signs it out everywhere, and gives it default categories again", async () => {
    const target = await server.registerUser();
    await fillWithData();
    const before = await ownedRows(target.userId);
    expect(Object.values(before).every((n) => n > 0), JSON.stringify(before)).toBe(true);

    server.setWebSession(owner.token);
    const wrongEmail = await server.web("POST", `/api/admin/users/${target.userId}/actions`, { action: "erase-data", confirmEmail: "someone@else.test", password: "secret123" });
    expect(wrongEmail.status).toBe(422);
    const wrongPassword = await server.web("POST", `/api/admin/users/${target.userId}/actions`, { action: "erase-data", confirmEmail: target.email, password: "not-my-password" });
    expect(wrongPassword.status).toBe(403);
    expect((await ownedRows(target.userId)).tasks).toBe(before.tasks);

    const erased = await server.mustWeb("POST", `/api/admin/users/${target.userId}/actions`, { action: "erase-data", confirmEmail: target.email.toUpperCase(), password: "secret123" });
    expect(erased.counts.Transaction).toBeGreaterThan(0);
    const after = await ownedRows(target.userId);
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true);
    expect(await server.prisma.user.count({ where: { id: target.userId } })).toBe(1);
    expect(await server.prisma.category.count({ where: { userId: target.userId } })).toBeGreaterThan(0);

    server.setWebSession(target.token);
    expect((await server.web("GET", "/api/sync/pull")).status).toBe(401);
    expect((await server.web("POST", "/api/auth/login", { email: target.email, password: "secret123" })).status).toBe(200);
  });

  it("deletes an account outright, and records it against the owner", async () => {
    const target = await server.registerUser();
    await fillWithData();

    server.setWebSession(owner.token);
    await server.mustWeb("POST", `/api/admin/users/${target.userId}/actions`, { action: "delete-account", confirmEmail: target.email, password: "secret123" });
    expect(await server.prisma.user.count({ where: { id: target.userId } })).toBe(0);
    expect(await server.prisma.transaction.count({ where: { userId: target.userId } })).toBe(0);
    const entry = await server.prisma.auditLog.findFirst({ where: { event: "USER_ADMIN_DELETED", entityId: target.userId } });
    expect(entry?.userId).toBe(owner.userId);
    expect((await server.web("POST", "/api/auth/login", { email: target.email, password: "secret123" })).status).toBe(401);
  });

  it("will not erase or delete the owner's own account", async () => {
    server.setWebSession(owner.token);
    const res = await server.web("POST", `/api/admin/users/${owner.userId}/actions`, { action: "delete-account", confirmEmail: OWNER, password: "secret123" });
    expect(res.status).toBe(422);
    expect(await server.prisma.user.count({ where: { id: owner.userId } })).toBe(1);
  });

  it("is refused to anyone but the owner", async () => {
    const victim = await server.registerUser();
    await server.registerUser();
    const res = await server.web("POST", `/api/admin/users/${victim.userId}/actions`, { action: "erase-data", confirmEmail: victim.email, password: "secret123" });
    expect(res.status).toBe(403);
  });
});

describe("email and SMS settings from the dashboard", () => {
  it("stores keys encrypted, never shows them back, needs the owner's password, and messaging uses them", async () => {
    server.setWebSession(owner.token);

    const refused = await server.web("PUT", "/api/admin/messaging", { password: "wrong", values: { SMS_PROVIDER: "kavenegar" } });
    expect(refused.status).toBe(403);
    expect(await server.prisma.serverSetting.count()).toBe(0);

    const saved = await server.mustWeb("PUT", "/api/admin/messaging", {
      password: "secret123",
      values: { SMS_PROVIDER: "Kavenegar", KAVENEGAR_API_KEY: "super-secret-api-key-123", KAVENEGAR_OTP_TEMPLATE: "parva-otp" },
    });
    expect([...saved.changed].sort()).toEqual(["KAVENEGAR_API_KEY", "KAVENEGAR_OTP_TEMPLATE", "SMS_PROVIDER"]);

    const view = await server.mustWeb("GET", "/api/admin/messaging");
    expect(JSON.stringify(view)).not.toContain("super-secret-api-key-123");
    expect(view.fields.find((f: { key: string }) => f.key === "KAVENEGAR_API_KEY")).toMatchObject({ source: "dashboard", value: null, secret: true });
    expect(view.fields.find((f: { key: string }) => f.key === "SMS_PROVIDER")).toMatchObject({ source: "dashboard", value: "kavenegar" });
    expect(view.sms).toMatchObject({ configured: true, provider: "kavenegar" });

    const row = await server.prisma.serverSetting.findUnique({ where: { key: "KAVENEGAR_API_KEY" } });
    expect(row.value).not.toContain("super-secret");
    expect(row.value.startsWith("v1.")).toBe(true);

    const { messagingConfig } = await import("@/lib/serverSettings");
    expect((await messagingConfig()).KAVENEGAR_API_KEY).toBe("super-secret-api-key-123");

    // Invalid values are refused; clearing goes back to the environment.
    expect((await server.web("PUT", "/api/admin/messaging", { password: "secret123", values: { SMS_PROVIDER: "other" } })).status).toBe(422);
    await server.mustWeb("PUT", "/api/admin/messaging", { password: "secret123", values: { SMS_PROVIDER: null, KAVENEGAR_API_KEY: null, KAVENEGAR_OTP_TEMPLATE: null } });
    expect(await server.prisma.serverSetting.count()).toBe(0);
    expect((await server.mustWeb("GET", "/api/admin/messaging")).sms.configured).toBe(false);

    // Only the names of what changed are recorded.
    const entries = await server.prisma.auditLog.findMany({ where: { event: "SERVER_SETTINGS_ADMIN_UPDATED" } });
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain("super-secret");
  });

  it("is closed to everyone else", async () => {
    await server.registerUser();
    expect((await server.web("GET", "/api/admin/messaging")).status).toBe(403);
    expect((await server.web("PUT", "/api/admin/messaging", { password: "secret123", values: { SMS_PROVIDER: "kavenegar" } })).status).toBe(403);
  });
});
