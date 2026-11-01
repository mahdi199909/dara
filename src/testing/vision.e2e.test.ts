// The vision board through the real web routes on a real database, the same calls on the phone's
// own database, and both directions of sync — including the link from a «ثبت کار» task to a goal.
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

interface Item {
  id: string;
  parentId: string | null;
  title: string;
  status: string;
  current: number | null;
  ratio: number | null;
  entryCount: number;
  achievedAt: string | null;
}
type Call = (method: string, url: string, body?: unknown) => Promise<any>;
type Raw = (method: string, url: string, body?: unknown) => Promise<{ status: number; json: any }>;

const byId = (items: Item[], id: string) => items.find((i) => i.id === id)!;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** The same scenario, run once against the web routes and once against the phone. */
async function visionScenario(call: Call, raw: Raw) {
  const list = async () => (await call("GET", "/api/vision")).items as Item[];

  // A vision (words only) and, under it, a goal with a yardstick of the person's own: 10 grams of gold.
  const vision = (await call("POST", "/api/vision", { title: "امنیت مالی", icon: "💰" })).item;
  expect(vision).toMatchObject({ parentId: null, status: "ACTIVE", ratio: null, current: null });
  const gold = (await call("POST", "/api/vision", { title: "خرید ۱۰ گرم طلا", parentId: vision.id, unit: "گرم", targetValue: 10 })).item;
  expect(gold).toMatchObject({ parentId: vision.id, mode: "ADD", startValue: 0, current: 0, ratio: 0 });

  // A hand-typed entry; the vision, with no yardstick of its own, is as far along as its goal.
  const entry = (await call("POST", `/api/vision/${gold.id}/entries`, { value: 2, note: "اولین سکه" })).entry;
  expect(entry).toMatchObject({ kind: "MANUAL", value: 2, note: "اولین سکه" });
  expect(byId(await list(), gold.id)).toMatchObject({ current: 2, ratio: 0.2, entryCount: 1 });
  expect(byId(await list(), vision.id).ratio).toBeCloseTo(0.2);

  // A task counts toward the goal only once it is done.
  const task = (await call("POST", "/api/tasks", { title: "خرید ۳ گرم طلا", visionItemId: gold.id, visionValue: 3 })).task;
  expect(task).toMatchObject({ visionItemId: gold.id, visionValue: 3 });
  expect(byId(await list(), gold.id).current).toBe(2);
  await call("PATCH", `/api/tasks/${task.id}`, { status: "DONE" });
  expect(byId(await list(), gold.id)).toMatchObject({ current: 5, ratio: 0.5, entryCount: 2 });

  // Left out, the amount is 1.
  const second = (await call("POST", "/api/tasks", { title: "یک گرم دیگر", visionItemId: gold.id, status: "DONE" })).task;
  expect(second.visionValue).toBe(1);
  expect(byId(await list(), gold.id).current).toBe(6);

  // Un-ticking takes the task's share back out at once.
  await call("PATCH", `/api/tasks/${task.id}`, { status: "TODO" });
  expect(byId(await list(), gold.id).current).toBe(3);
  // Taking a task off the goal clears its amount.
  const off = (await call("PATCH", `/api/tasks/${task.id}`, { visionItemId: null })).task;
  expect(off).toMatchObject({ visionItemId: null, visionValue: null });

  // The detail lists everything that counts, newest first, with the kind of each.
  const detail = await call("GET", `/api/vision/${gold.id}`);
  expect(detail.entries.map((e: { kind: string }) => e.kind).sort()).toEqual(["MANUAL", "TASK"]);
  await call("DELETE", `/api/vision/${gold.id}/entries/${entry.id}`);
  expect(byId(await list(), gold.id)).toMatchObject({ current: 1, entryCount: 1 });

  // A project can sit under a vision; it counts by how many of its tasks are done.
  const project = (await call("POST", "/api/projects", { name: "باشگاه" })).project;
  await call("POST", "/api/tasks", { title: "ثبت‌نام", projectId: project.id, status: "DONE" });
  await call("POST", "/api/tasks", { title: "برنامهٔ تمرین", projectId: project.id });
  await call("POST", `/api/vision/${vision.id}/projects`, { projectId: project.id });
  const goalRatio = byId(await list(), gold.id).ratio as number;
  expect(byId(await list(), vision.id).ratio).toBeCloseTo((goalRatio + 0.5) / 2);
  const withProject = await call("GET", `/api/vision/${vision.id}`);
  expect(withProject.projects).toEqual([expect.objectContaining({ id: project.id, name: "باشگاه", taskTotal: 2, taskDone: 1 })]);
  expect(((await call("GET", "/api/projects")).projects as Array<{ id: string; visionItemId: string | null }>).find((p) => p.id === project.id)?.visionItemId).toBe(vision.id);
  await call("DELETE", `/api/vision/${vision.id}/projects/${project.id}`);
  expect((await call("GET", `/api/vision/${vision.id}`)).projects).toEqual([]);
  await call("POST", `/api/vision/${vision.id}/projects`, { projectId: project.id });

  // "Latest value" mode (weight): the entry with the latest DATE is the current value, whatever order they were typed in.
  const weight = (await call("POST", "/api/vision", { title: "وزن", unit: "کیلو", startValue: 90, targetValue: 80, mode: "SET" })).item;
  await call("POST", `/api/vision/${weight.id}/entries`, { value: 88, date: daysAgo(2) });
  await call("POST", `/api/vision/${weight.id}/entries`, { value: 85, date: daysAgo(1) });
  await call("POST", `/api/vision/${weight.id}/entries`, { value: 87, date: daysAgo(3) });
  expect(byId(await list(), weight.id)).toMatchObject({ current: 85, ratio: 0.5 });

  // Marking it achieved stamps the time; going back clears it.
  expect((await call("PATCH", `/api/vision/${weight.id}`, { status: "ACHIEVED" })).item.achievedAt).toBeTruthy();
  expect((await call("PATCH", `/api/vision/${weight.id}`, { status: "ACTIVE" })).item.achievedAt).toBeNull();

  // What is not allowed, with the same answer on both sides.
  expect((await raw("POST", "/api/vision", { title: "زیر هدف", parentId: gold.id })).status).toBe(400); // a goal cannot hold goals
  expect((await raw("PATCH", `/api/vision/${vision.id}`, { parentId: weight.id })).status).toBe(400); // a vision with goals cannot become a goal
  expect((await raw("POST", "/api/vision", { title: "   " })).status).toBe(400);
  expect((await raw("GET", "/api/vision/does-not-exist")).status).toBe(404);
  expect((await raw("POST", "/api/tasks", { title: "x", visionItemId: "does-not-exist" })).status).toBe(404);
  expect((await raw("POST", `/api/vision/${gold.id}/projects`, { projectId: "does-not-exist" })).status).toBe(404);

  // Deleting a vision takes its goals; the tasks and projects that pointed at them are unlinked, not deleted.
  await call("DELETE", `/api/vision/${vision.id}`);
  const after = await list();
  expect(after.map((i) => i.id)).toEqual([weight.id]);
  const tasks = (await call("GET", "/api/tasks")).tasks as Array<{ id: string; visionItemId: string | null }>;
  expect(tasks.find((t) => t.id === second.id)).toMatchObject({ visionItemId: null });
  expect(((await call("GET", "/api/projects")).projects as Array<{ id: string; visionItemId: string | null }>).find((p) => p.id === project.id)?.visionItemId).toBeNull();
}

describe("the vision board", () => {
  it("works on the web", async () => {
    const { userId } = await server.registerUser();
    await visionScenario(
      (m, u, b) => server.mustWeb(m, u, b),
      (m, u, b) => server.web(m, u, b)
    );
    const audit = await server.prisma.auditLog.findMany({ where: { userId, entityType: { in: ["VisionItem", "VisionEntry"] } } });
    const events = audit.map((r: { event: string | null }) => r.event);
    expect(events).toEqual(expect.arrayContaining(["VISION_CREATED", "VISION_UPDATED", "VISION_DELETED", "VISION_ENTRY_CREATED", "VISION_ENTRY_DELETED"]));
  });

  it("works the same on the phone", async () => {
    const phone = await createPhone();
    phone.activate();
    await visionScenario(
      async (m, u, b) => phone.must(m, u, b),
      async (m, u, b) => phone.request(m, u, b)
    );
  });

  it("only ever shows a person their own", async () => {
    const mine = await server.registerUser();
    const goal = (await server.mustWeb("POST", "/api/vision", { title: "هدف من", unit: "گرم", targetValue: 5 })).item;
    const other = await server.registerUser();
    server.setWebSession(other.token);
    expect((await server.mustWeb("GET", "/api/vision")).items).toEqual([]);
    expect((await server.web("GET", `/api/vision/${goal.id}`)).status).toBe(404);
    expect((await server.web("POST", `/api/vision/${goal.id}/entries`, { value: 1 })).status).toBe(404);
    expect((await server.web("POST", "/api/tasks", { title: "x", visionItemId: goal.id })).status).toBe(404);
    expect((await server.web("DELETE", `/api/vision/${goal.id}`)).status).toBe(404);
    server.setWebSession(mine.token);
    expect((await server.mustWeb("GET", "/api/vision")).items).toHaveLength(1);
  });
});

describe("vision board sync", () => {
  async function linkedPhone(account: { userId: string; token: string; email: string }) {
    const phone = await createPhone();
    linkPhone(phone, account);
    return phone;
  }

  it("carries visions, goals, entries and the task link from the phone to the web and back", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);

    const vision = phone.must("POST", "/api/vision", { title: "ویژن گوشی" }).item;
    const goal = phone.must("POST", "/api/vision", { title: "هدف", parentId: vision.id, unit: "گرم", targetValue: 10 }).item;
    phone.must("POST", `/api/vision/${goal.id}/entries`, { value: 4 });
    const task = phone.must("POST", "/api/tasks", { title: "کار گوشی", visionItemId: goal.id, visionValue: 2, status: "DONE" }).task;
    await syncUntilQuiet(phone);

    server.setWebSession(account.token);
    const web = (await server.mustWeb("GET", "/api/vision")).items as Item[];
    expect(byId(web, goal.id)).toMatchObject({ current: 6, ratio: 0.6 });
    expect(byId(web, vision.id).ratio).toBeCloseTo(0.6);
    const webTask = ((await server.mustWeb("GET", "/api/tasks")).tasks as Array<{ id: string; visionItemId: string | null; visionValue: number | null }>).find((t) => t.id === task.id);
    expect(webTask).toMatchObject({ visionItemId: goal.id, visionValue: 2 });

    // The web adds an entry and un-ticks the task; the phone sees the same numbers.
    await tick();
    await server.mustWeb("POST", `/api/vision/${goal.id}/entries`, { value: 1 });
    await server.mustWeb("PATCH", `/api/tasks/${task.id}`, { status: "TODO" });
    await syncUntilQuiet(phone);
    expect(byId(phone.must("GET", "/api/vision").items, goal.id)).toMatchObject({ current: 5, ratio: 0.5 });

    // Deleting on the phone removes it on the web too, and unlinks the task there.
    await tick();
    phone.must("DELETE", `/api/vision/${vision.id}`);
    await syncUntilQuiet(phone);
    expect((await server.mustWeb("GET", "/api/vision")).items).toEqual([]);
    const afterTask = ((await server.mustWeb("GET", "/api/tasks")).tasks as Array<{ id: string; visionItemId: string | null }>).find((t) => t.id === task.id);
    expect(afterTask?.visionItemId).toBeNull();
  });

  it("brings what was made on the web to a phone that links afterwards", async () => {
    const account = await server.registerUser();
    const vision = (await server.mustWeb("POST", "/api/vision", { title: "ویژن وب" })).item;
    const goal = (await server.mustWeb("POST", "/api/vision", { title: "هدف وب", parentId: vision.id, unit: "صفحه", targetValue: 200 })).item;
    await server.mustWeb("POST", `/api/vision/${goal.id}/entries`, { value: 50 });

    const phone = await linkedPhone(account);
    await syncUntilQuiet(phone);
    const items = phone.must("GET", "/api/vision").items as Item[];
    expect(byId(items, goal.id)).toMatchObject({ current: 50, ratio: 0.25 });
    expect(byId(items, vision.id).ratio).toBeCloseTo(0.25);
  });
});
