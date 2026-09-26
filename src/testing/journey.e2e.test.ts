// «مسیر» — the story page's facts, from the real web routes and from the phone's own repositories, over the same life.
// The wording is one shared pure function (src/lib/journeyEngine.ts), so what has to match is the rows: the web's Prisma
// loader (src/lib/journeyData.ts) and the phone's SQLite loader (src/local/journeyData.ts) must decide identically what
// "happened on a day" means.
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

import { createPhone, createServerHarness, type Phone, type ServerHarness } from "@/testing/syncHarness";
import { linkPhone, normalize, syncUntilQuiet } from "@/testing/syncScenarios";
import type { JourneyRows } from "@/lib/journeyTypes";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});

const DAY = 86_400_000;
const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
/** A moment `daysAgo` days back at `hour:minute` local time. */
const at = (daysAgo: number, hour: number, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo, hour, minute).toISOString();
const dayKey = (daysAgo: number) => {
  const d = new Date(today.getTime() - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const range = () => `from=${encodeURIComponent(at(30, 0))}&to=${encodeURIComponent(new Date(today.getTime() + DAY - 1).toISOString())}`;

/** A small, complete life: a project with tracked work and a finished task, a weekly meeting, a habit kept three days, notes. */
async function liveALife() {
  const account = await server.registerUser();

  const project = (await server.mustWeb("POST", "/api/projects", { name: "سایت آتلیه" })).project;
  const activity = (await server.mustWeb("POST", "/api/activities", { title: "طراحی صفحه‌ی اول", projectId: project.id })).activity;
  await server.mustWeb("POST", `/api/activities/${activity.id}/time-entries`, { startAt: at(3, 9), endAt: at(3, 11) });

  await server.mustWeb("POST", "/api/tasks", { title: "انتخاب رنگ‌ها", status: "DONE", projectId: project.id, startAt: at(3, 13), endAt: at(3, 14) });
  await server.mustWeb("POST", "/api/tasks", { title: "کاری که هنوز نشده", status: "TODO", projectId: project.id });

  const meeting = (await server.mustWeb("POST", "/api/events", { title: "جلسه با رها", startAt: at(2, 10), endAt: at(2, 11), location: "آنلاین" })).event
    ?? undefined;
  void meeting;
  const weekly = await server.mustWeb("POST", "/api/events", {
    title: "جلسه‌ی هفتگی",
    startAt: at(20, 15),
    endAt: at(20, 16),
    recurrenceFreq: "WEEKLY",
  });
  const weeklyId = (weekly.event ?? weekly).id;
  await server.mustWeb("POST", `/api/events/${weeklyId}/complete`, { occurrenceDate: at(13, 15) });

  const habit = (await server.mustWeb("POST", "/api/habits", { title: "ورزش" })).habit;
  for (const daysAgo of [3, 2, 1]) await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`, { date: at(daysAgo, 7) });

  await server.mustWeb("POST", "/api/notes", { day: dayKey(2), content: "امروز خوب بود.\nخط دوم." });
  await server.mustWeb("POST", "/api/notes", { day: dayKey(1), content: "یادداشت دیگر" });

  return { account, project, habit };
}

describe("مسیر: the facts of a stretch of days", () => {
  it("returns what happened, and only what happened", async () => {
    const { project } = await liveALife();
    const res = await server.web("GET", `/api/journey?${range()}`);
    expect(res.status).toBe(200);
    const rows = res.json as JourneyRows;

    // The finished, timed task is there against its project; the unfinished one is not.
    expect(rows.tasks.map((t) => t.title)).toEqual(["انتخاب رنگ‌ها"]);
    expect(rows.tasks[0]).toMatchObject({ project: "سایت آتلیه", minutes: 60 });

    // The tracked stretch, with its project and length.
    expect(rows.work).toHaveLength(1);
    expect(rows.work[0]).toMatchObject({ title: "طراحی صفحه‌ی اول", project: "سایت آتلیه", minutes: 120 });

    // The one-off meeting, and every weekly occurrence of the recurring one inside the range (one of them ticked as done).
    const meetings = rows.events.filter((e) => e.title === "جلسه با رها");
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ location: "آنلاین", allDay: false });
    const weekly = rows.events.filter((e) => e.title === "جلسه‌ی هفتگی");
    expect(weekly.length).toBeGreaterThanOrEqual(3);
    expect(weekly.filter((e) => e.done)).toHaveLength(1);
    expect(new Set(weekly.map((e) => e.id)).size).toBe(weekly.length); // each occurrence has its own id

    // Three days of the habit, each carrying how many days in a row it was by then.
    expect(rows.habits.map((h) => h.streak).sort()).toEqual([1, 2, 3]);
    expect(rows.habits.every((h) => h.title === "ورزش" && typeof h.at === "string")).toBe(true);

    // The notes, verbatim, on their own days.
    expect(rows.notes.map((n) => [n.day, n.text])).toEqual([
      [dayKey(2), "امروز خوب بود.\nخط دوم."],
      [dayKey(1), "یادداشت دیگر"],
    ]);

    // The project began today, so it is a landmark today; and the path starts at the first thing ever recorded.
    expect(rows.milestones.map((m) => [m.kind, m.name])).toEqual([["STARTED", "سایت آتلیه"]]);
    expect(rows.earliestDay).toBe(dayKey(20));
    void project;
  });

  it("refuses a missing or unreasonable range", async () => {
    await server.registerUser();
    expect((await server.web("GET", "/api/journey")).status).toBe(400);
    expect((await server.web("GET", `/api/journey?from=${encodeURIComponent(at(1, 0))}&to=${encodeURIComponent(at(2, 0))}`)).status).toBe(400); // to before from
    expect((await server.web("GET", `/api/journey?from=${encodeURIComponent(at(400, 0))}&to=${encodeURIComponent(at(1, 0))}`)).status).toBe(400); // more than three months
  });

  it("is empty — with no first day — for someone who has recorded nothing", async () => {
    await server.registerUser();
    const res = await server.web("GET", `/api/journey?${range()}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ events: [], tasks: [], work: [], habits: [], notes: [], milestones: [], earliestDay: null });
  });

  it("does not show one person another's days", async () => {
    await liveALife();
    await server.registerUser();
    const res = await server.web("GET", `/api/journey?${range()}`);
    expect(res.json.notes).toEqual([]);
    expect(res.json.earliestDay).toBeNull();
  });
});

describe("مسیر: the phone tells the same facts as the web", () => {
  let phone: Phone;

  it("returns identical rows for the same life", async () => {
    const { account } = await liveALife();
    phone = await createPhone();
    linkPhone(phone, account);
    await syncUntilQuiet(phone);

    const web = (await server.web("GET", `/api/journey?${range()}`)).json;
    const local = phone.must("GET", `/api/journey?${range()}`);

    expect(normalize(local)).toEqual(normalize(web));
    // …and it is not vacuous: there is a real life in both.
    expect((local as JourneyRows).habits).toHaveLength(3);
    expect((local as JourneyRows).events.length).toBeGreaterThan(3);
  });

  it("refuses a bad range the way the web does", async () => {
    const res = phone.request("GET", "/api/journey");
    expect(res.status).toBe(400);
  });
});
