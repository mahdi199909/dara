// Checklists and the inbox through the real web routes on a real database, the same calls on the
// phone's own database, and both directions of sync.
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
import { CHECKLIST_TEMPLATES, templateLeafCount } from "@/lib/checklistTemplates";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});

type Item = { id: string; parentId: string | null; title: string; checked: boolean };
type Call = (method: string, url: string, body?: unknown) => Promise<any>;

/** The same scenario, run once against the web routes and once against the phone. */
async function checklistScenario(call: Call) {
  const seminar = (await call("POST", "/api/checklists", { title: "سمینار" })).item;
  const hall = (await call("POST", "/api/checklists", { parentId: seminar.id, title: "گرفتن سالن" })).item;
  const signup = (await call("POST", "/api/checklists", { parentId: seminar.id, title: "ثبت‌نام" })).item;
  const subs = (await call("POST", "/api/checklists", { parentId: hall.id, titles: ["تماس با سالن", "بستن قرارداد"] })).items;
  expect(subs.map((s: Item) => s.title)).toEqual(["تماس با سالن", "بستن قرارداد"]);

  const state = async () => Object.fromEntries(((await call("GET", "/api/checklists")).items as Item[]).map((i) => [i.title, i.checked]));

  // ticking both sub-items ticks the hall; the seminar waits for the sign-up
  await call("PATCH", `/api/checklists/${subs[0].id}`, { checked: true });
  await call("PATCH", `/api/checklists/${subs[1].id}`, { checked: true });
  expect(await state()).toMatchObject({ "گرفتن سالن": true, سمینار: false });
  await call("PATCH", `/api/checklists/${signup.id}`, { checked: true });
  expect(Object.values(await state()).every(Boolean)).toBe(true);

  // a new item under the ticked hall unticks the hall and the seminar
  const extra = (await call("POST", "/api/checklists", { parentId: hall.id, title: "بیعانه" })).item;
  expect(await state()).toMatchObject({ "گرفتن سالن": false, سمینار: false, "تماس با سالن": true });
  // ...and deleting it ticks them again
  await call("DELETE", `/api/checklists/${extra.id}`);
  expect(Object.values(await state()).every(Boolean)).toBe(true);

  // «از نو» on the list unticks everything in it
  const reset = await call("POST", `/api/checklists/${seminar.id}/reset`);
  expect(reset.reset).toBe(5);
  expect(Object.values(await state()).some(Boolean)).toBe(false);

  // rename and move
  await call("PATCH", `/api/checklists/${signup.id}`, { title: "ثبت‌نام شرکت‌کننده‌ها", move: "UP" });
  const items = (await call("GET", "/api/checklists")).items as Item[];
  const children = items.filter((i) => i.parentId === seminar.id).map((i) => i.title);
  expect(children).toEqual(["ثبت‌نام شرکت‌کننده‌ها", "گرفتن سالن"]);

  // deleting the list takes everything in it
  await call("DELETE", `/api/checklists/${seminar.id}`);
  expect((await call("GET", "/api/checklists")).items).toEqual([]);
}

async function inboxScenario(call: Call) {
  const a = (await call("POST", "/api/inbox", { content: "  خرید هدیه  " })).item;
  const b = (await call("POST", "/api/inbox", { content: "تمدید بیمه", priority: 2 })).item;
  const c = (await call("POST", "/api/inbox", { content: "ایدهٔ مقاله", priority: 1 })).item;
  expect(a.content).toBe("خرید هدیه");
  expect(a.priority).toBe(0);
  // most urgent first, then oldest first
  expect(((await call("GET", "/api/inbox")).items as { id: string }[]).map((i) => i.id)).toEqual([b.id, c.id, a.id]);

  await call("PATCH", `/api/inbox/${a.id}`, { content: "خرید هدیهٔ تولد", priority: 2 });
  await call("POST", `/api/inbox/${b.id}/process`, { to: "TASK" });
  await call("DELETE", `/api/inbox/${c.id}`);
  const left = (await call("GET", "/api/inbox")).items;
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ id: a.id, content: "خرید هدیهٔ تولد", priority: 2 });
}

describe("checklists", () => {
  it("work the same on the web", async () => {
    const { userId } = await server.registerUser();
    await checklistScenario((m, u, b) => server.mustWeb(m, u, b));
    const audit = await server.prisma.auditLog.findMany({ where: { userId, entityType: "ChecklistItem" } });
    expect(audit.some((r: { event: string | null }) => r.event === "CHECKLIST_CLEARED")).toBe(true);
  });

  it("work the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await checklistScenario(async (m, u, b) => phone.must(m, u, b));
  });

  it("refuse an empty title, an unknown parent and someone else's list", async () => {
    await server.registerUser();
    expect((await server.web("POST", "/api/checklists", { title: "  " })).status).toBe(400);
    expect((await server.web("POST", "/api/checklists", { parentId: "nope", title: "x" })).status).toBe(404);
    const mine = (await server.mustWeb("POST", "/api/checklists", { title: "سفر" })).item;
    await server.registerUser();
    expect((await server.web("PATCH", `/api/checklists/${mine.id}`, { checked: true })).status).toBe(404);
    expect((await server.web("POST", `/api/checklists/${mine.id}/reset`)).status).toBe(404);
    expect((await server.web("POST", "/api/checklists", { parentId: mine.id, title: "x" })).status).toBe(404);
    expect((await server.mustWeb("GET", "/api/checklists")).items).toEqual([]);
  });

  it("travel between the web and the phone", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);
    const trip = phone.must("POST", "/api/checklists", { title: "سفر" }).item;
    phone.must("POST", "/api/checklists", { parentId: trip.id, titles: ["پاسپورت", "شارژر"] });
    await syncUntilQuiet(phone);

    const onWeb = (await server.mustWeb("GET", "/api/checklists")).items as Item[];
    expect(onWeb.map((i) => i.title).sort()).toEqual(["پاسپورت", "سفر", "شارژر"].sort());
    const passport = onWeb.find((i) => i.title === "پاسپورت")!;
    await server.mustWeb("PATCH", `/api/checklists/${passport.id}`, { checked: true });
    await new Promise((r) => setTimeout(r, 1200));
    await syncUntilQuiet(phone);
    phone.activate();
    expect((phone.must("GET", "/api/checklists").items as Item[]).find((i) => i.id === passport.id)!.checked).toBe(true);
  });
});

describe("inbox", () => {
  it("works the same on the web", async () => {
    const { userId } = await server.registerUser();
    await inboxScenario((m, u, b) => server.mustWeb(m, u, b));
    const audit = await server.prisma.auditLog.findMany({ where: { userId, entityType: "InboxItem" } });
    expect(audit.find((r: { event: string | null }) => r.event === "INBOX_PROCESSED")).toBeDefined();
  });

  it("works the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await inboxScenario(async (m, u, b) => phone.must(m, u, b));
  });

  it("refuses an empty item, a made-up destination and a processed item", async () => {
    await server.registerUser();
    expect((await server.web("POST", "/api/inbox", { content: " " })).status).toBe(400);
    expect((await server.web("POST", "/api/inbox", { content: "x", priority: 7 })).status).toBe(400);
    const item = (await server.mustWeb("POST", "/api/inbox", { content: "x" })).item;
    expect((await server.web("POST", `/api/inbox/${item.id}/process`, { to: "MOON" })).status).toBe(400);
    await server.mustWeb("POST", `/api/inbox/${item.id}/process`, { to: "NOTE" });
    expect((await server.web("PATCH", `/api/inbox/${item.id}`, { content: "y" })).status).toBe(404);
  });

  it("travels between the web and the phone", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);
    const fromPhone = phone.must("POST", "/api/inbox", { content: "از گوشی" }).item;
    await server.mustWeb("POST", "/api/inbox", { content: "از وب", priority: 1 });
    await syncUntilQuiet(phone);
    expect(((await server.mustWeb("GET", "/api/inbox")).items as { content: string }[]).map((i) => i.content)).toEqual(["از وب", "از گوشی"]);

    await server.mustWeb("POST", `/api/inbox/${fromPhone.id}/process`, { to: "EVENT" });
    await new Promise((r) => setTimeout(r, 1200));
    await syncUntilQuiet(phone);
    phone.activate();
    expect((phone.must("GET", "/api/inbox").items as { content: string }[]).map((i) => i.content)).toEqual(["از وب"]);
  });
});

/** Ready-made lists, dragging and the timer's tasks — once on the web, once on the phone. */
async function extrasScenario(call: Call) {
  const seminar = CHECKLIST_TEMPLATES.find((t) => t.id === "seminar")!;
  const created = (await call("POST", "/api/checklists", { tree: seminar.tree })).items as Item[];
  expect(created[0]).toMatchObject({ title: "سمینار", parentId: null });
  const all = (await call("GET", "/api/checklists")).items as Item[];
  const leaves = all.filter((i) => !all.some((c) => c.parentId === i.id));
  expect(leaves).toHaveLength(templateLeafCount(seminar.tree));
  const firstGroups = all.filter((i) => i.parentId === created[0].id).map((i) => i.title);
  expect(firstGroups[0]).toBe("گرفتن سالن");

  // a tree added under a ticked list unticks it
  const done = (await call("POST", "/api/checklists", { title: "کوتاه" })).item;
  await call("POST", "/api/checklists", { parentId: done.id, title: "تنها مورد" });
  const only = ((await call("GET", "/api/checklists")).items as Item[]).find((i) => i.title === "تنها مورد")!;
  await call("PATCH", `/api/checklists/${only.id}`, { checked: true });
  await call("POST", "/api/checklists", { parentId: done.id, tree: { title: "بخش تازه", children: [{ title: "الف" }] } });
  expect(((await call("GET", "/api/checklists")).items as Item[]).find((i) => i.id === done.id)!.checked).toBe(false);

  // dragging: the last group to the top
  const groups = all.filter((i) => i.parentId === created[0].id);
  await call("PATCH", `/api/checklists/${groups[groups.length - 1].id}`, { position: 0 });
  const after = ((await call("GET", "/api/checklists")).items as Item[]).filter((i) => i.parentId === created[0].id).map((i) => i.id);
  expect(after[0]).toBe(groups[groups.length - 1].id);
  expect(after.slice(1)).toEqual(groups.slice(0, -1).map((g) => g.id));

  // a timer's task is told apart from a typed one
  await call("POST", "/api/tasks", { title: "تمرکز", status: "DONE", startAt: "2026-10-02T06:00:00.000Z", endAt: "2026-10-02T06:25:00.000Z", source: "TIMER", allowOverlap: true });
  await call("POST", "/api/tasks", { title: "دستی", status: "DONE" });
  const timed = (await call("GET", "/api/tasks?source=TIMER")).tasks as { title: string }[];
  expect(timed.map((t) => t.title)).toEqual(["تمرکز"]);
}

describe("ready-made lists, dragging and the timer's tasks", () => {
  it("work on the web", async () => {
    await server.registerUser();
    await extrasScenario((m, u, b) => server.mustWeb(m, u, b));
  });

  it("work on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await extrasScenario(async (m, u, b) => phone.must(m, u, b));
  });

  it("refuse a tree that is too big or too deep, and a made-up task source", async () => {
    await server.registerUser();
    const wide = { title: "x", children: Array.from({ length: 301 }, (_, i) => ({ title: `مورد ${i}` })) };
    expect((await server.web("POST", "/api/checklists", { tree: wide })).status).toBe(400);
    let deep: { title: string; children?: unknown[] } = { title: "ته" };
    for (let i = 0; i < 7; i++) deep = { title: `سطح ${i}`, children: [deep] };
    expect((await server.web("POST", "/api/checklists", { tree: deep })).status).toBe(400);
    expect((await server.web("POST", "/api/tasks", { title: "x", source: "ROBOT" })).status).toBe(400);
  });

  it("every ready-made list is valid", async () => {
    const { createChecklistTreeSchema } = await import("@/lib/schemas/checklists");
    for (const t of CHECKLIST_TEMPLATES) expect(createChecklistTreeSchema.safeParse({ tree: t.tree }).success, t.id).toBe(true);
    expect(new Set(CHECKLIST_TEMPLATES.map((t) => t.id)).size).toBe(CHECKLIST_TEMPLATES.length);
  });
});
