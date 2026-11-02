import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_END_OF_DAY,
  END_OF_DAY_ARMED_EVENINGS,
  END_OF_DAY_LOOKAHEAD_DAYS,
  daysWindow,
  describeEndOfDay,
  endOfDayNotificationText,
  nextEndOfDayTimes,
  openCountsByDay,
  openItemsOfDay,
  planEndOfDayReminders,
  readEndOfDaySettings,
  saveEndOfDaySettings,
  todayWindow,
} from "./endOfDay";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe("nextEndOfDayTimes", () => {
  const settings = { enabled: true, time: "21:00" };

  it("gives this evening when it is still ahead, then the following evenings", () => {
    const times = nextEndOfDayTimes(settings, at(2026, 11, 2, 15, 0), 3);
    expect(times).toEqual([at(2026, 11, 2, 21, 0), at(2026, 11, 3, 21, 0), at(2026, 11, 4, 21, 0)]);
  });

  it("starts with tomorrow evening once tonight's moment has passed (or is this very minute)", () => {
    expect(nextEndOfDayTimes(settings, at(2026, 11, 2, 22, 0), 2)).toEqual([at(2026, 11, 3, 21, 0), at(2026, 11, 4, 21, 0)]);
    expect(nextEndOfDayTimes(settings, at(2026, 11, 2, 21, 0), 1)).toEqual([at(2026, 11, 3, 21, 0)]);
  });

  it("is empty when switched off or when no time is asked for", () => {
    expect(nextEndOfDayTimes({ ...settings, enabled: false }, at(2026, 11, 2), 7)).toEqual([]);
    expect(nextEndOfDayTimes(settings, at(2026, 11, 2), 0)).toEqual([]);
  });

  it("reads another time, and falls back for text that is not a time", () => {
    expect(nextEndOfDayTimes({ enabled: true, time: "19:30" }, at(2026, 11, 2, 8, 0), 1)).toEqual([at(2026, 11, 2, 19, 30)]);
    expect(nextEndOfDayTimes({ enabled: true, time: "soon" }, at(2026, 11, 2, 8, 0), 1)).toEqual([at(2026, 11, 2, 21, 0)]);
  });

  it("keeps the same clock time across a month and a year end", () => {
    const times = nextEndOfDayTimes(settings, at(2026, 12, 31, 10, 0), 2);
    expect(times.map((t) => [t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours()])).toEqual([
      [2026, 12, 31, 21],
      [2027, 1, 1, 21],
    ]);
  });
});

describe("the setting", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is on at nine in the evening until the person says otherwise, and remembers what they chose", () => {
    expect(readEndOfDaySettings()).toEqual(DEFAULT_END_OF_DAY);
    saveEndOfDaySettings({ enabled: true, time: "20:15" });
    expect(readEndOfDaySettings()).toEqual({ enabled: true, time: "20:15" });
    saveEndOfDaySettings({ enabled: false, time: "20:15" });
    expect(readEndOfDaySettings().enabled).toBe(false);
  });

  it("describes itself for the settings line", () => {
    expect(describeEndOfDay({ enabled: true, time: "21:00" })).toBe("هر شب ساعت ۲۱:۰۰");
    expect(describeEndOfDay({ enabled: false, time: "21:00" })).toBe("خاموش");
  });
});

describe("openItemsOfDay", () => {
  const occ = (id: string, title: string, start: string, over: Record<string, unknown> = {}, isDone = false) => ({
    occurrenceId: `${id}:${start}`,
    startAt: start,
    endAt: start,
    isDone,
    event: { id, title, allDay: false, recurrenceFreq: "NONE", ...over },
  });
  const task = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, status: "TODO", dueDate: at(2026, 11, 2).toISOString(), startAt: null, endAt: null, ...over });

  it("lists what is not done: tasks still to do and events not ticked", () => {
    const data = {
      occurrences: [occ("e1", "جلسه", at(2026, 11, 2, 15).toISOString()), occ("e2", "ورزش", at(2026, 11, 2, 7).toISOString(), {}, true)],
      taskOccurrences: [task("t1", "گزارش"), task("t2", "قبض", { status: "DONE" }), task("t3", "لغو", { status: "CANCELLED" })],
    };
    expect(openItemsOfDay(data).map((o) => o.item.id)).toEqual(["e1", "t1"]);
  });

  it("puts what has a time first, in order, and what has none after", () => {
    const data = {
      occurrences: [occ("late", "شب", at(2026, 11, 2, 20).toISOString()), occ("allday", "تعطیل", at(2026, 11, 2, 0).toISOString(), { allDay: true })],
      taskOccurrences: [task("plain", "بی‌ساعت"), task("early", "صبح", { startAt: at(2026, 11, 2, 8).toISOString(), endAt: at(2026, 11, 2, 9).toISOString() })],
    };
    expect(openItemsOfDay(data).map((o) => [o.item.id, o.time])).toEqual([
      ["early", "08:00"],
      ["late", "20:00"],
      ["allday", null],
      ["plain", null],
    ]);
  });

  it("says which events repeat, so the screen can offer only 'done' for them", () => {
    const data = { occurrences: [occ("daily", "مرور", at(2026, 11, 2, 9).toISOString(), { recurrenceFreq: "DAILY" }), occ("once", "یک‌بار", at(2026, 11, 2, 10).toISOString())] };
    const items = openItemsOfDay(data);
    expect(items.map((o) => o.item.kind === "EVENT" && o.item.recurring)).toEqual([true, false]);
  });

  it("keeps an event's occurrence start, which ticking it done needs", () => {
    const start = at(2026, 11, 2, 9).toISOString();
    expect(openItemsOfDay({ occurrences: [occ("e", "x", start)] })[0].occurrenceDate).toBe(start);
  });

  it("is empty for nothing, or for a day with everything done", () => {
    expect(openItemsOfDay(undefined)).toEqual([]);
    expect(openItemsOfDay({ occurrences: [], taskOccurrences: [] })).toEqual([]);
  });
});

describe("the notification's words", () => {
  it("names the count only when it is known and above zero", () => {
    expect(endOfDayNotificationText(3).body).toBe("۳ مورد امروز هنوز باز است؛ هرکدام را تمام کن یا به فردا ببر.");
    for (const unknown of [null, 0]) expect(endOfDayNotificationText(unknown).body).toBe("امروز چه چیزی تمام نشد؟ هرچه مانده را به فردا یا زمان دیگری ببر.");
    expect(endOfDayNotificationText(1).title).toBe("مرور پایان روز");
  });

  it("has no exclamation mark and no reproach", () => {
    for (const open of [null, 0, 2, 40]) expect(endOfDayNotificationText(open).body).not.toMatch(/[!！]|عقب|شکست|کوتاهی/);
  });
});

describe("the query windows", () => {
  it("cover whole local days, from midnight to the last millisecond", () => {
    const { from, to } = daysWindow(at(2026, 11, 2, 15, 30), 3);
    expect(new Date(from)).toEqual(at(2026, 11, 2, 0, 0));
    expect(new Date(to)).toEqual(new Date(2026, 10, 4, 23, 59, 59, 999));
  });

  it("is the same for any moment of a day, so a cache key made from it holds still", () => {
    expect(todayWindow(at(2026, 11, 2, 0, 1))).toEqual(todayWindow(at(2026, 11, 2, 23, 58)));
    expect(new Date(todayWindow(at(2026, 11, 2, 9)).to)).toEqual(new Date(2026, 10, 2, 23, 59, 59, 999));
  });

  it("looks one day further than the evenings it arms, since tonight may already be past", () => {
    expect(END_OF_DAY_LOOKAHEAD_DAYS).toBe(END_OF_DAY_ARMED_EVENINGS + 1);
  });
});

describe("openItemsOfDay, narrowed to one day", () => {
  const occ = (id: string, start: Date, end: Date, isDone = false) => ({ occurrenceId: id, startAt: start.toISOString(), endAt: end.toISOString(), isDone, event: { id, title: id, allDay: false, recurrenceFreq: "NONE" } });
  const task = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id, status: "TODO", dueDate: null, startAt: null, endAt: null, ...over });

  const data = {
    occurrences: [
      occ("today-event", at(2026, 11, 2, 10), at(2026, 11, 2, 11)),
      occ("tomorrow-event", at(2026, 11, 3, 10), at(2026, 11, 3, 11)),
      occ("overnight", at(2026, 11, 2, 23), at(2026, 11, 3, 1)),
    ],
    taskOccurrences: [
      task("due-today", { dueDate: at(2026, 11, 2).toISOString() }),
      task("due-tomorrow", { dueDate: at(2026, 11, 3).toISOString() }),
      task("timed-tomorrow", { startAt: at(2026, 11, 3, 16).toISOString(), endAt: at(2026, 11, 3, 17).toISOString() }),
    ],
  };
  const ids = (day: Date) => openItemsOfDay(data, day).map((o) => o.item.id).sort();

  it("keeps an event that touches the day, the way the API does, and a task by its due day or its start", () => {
    expect(ids(at(2026, 11, 2, 12))).toEqual(["due-today", "overnight", "today-event"]);
    expect(ids(at(2026, 11, 3, 12))).toEqual(["due-tomorrow", "overnight", "timed-tomorrow", "tomorrow-event"]);
  });

  it("is empty for a day with nothing in it", () => {
    expect(ids(at(2026, 11, 9))).toEqual([]);
  });

  it("counts day by day", () => {
    expect(openCountsByDay(data, at(2026, 11, 2, 8), 3)).toEqual([3, 4, 0]);
  });
});

describe("planEndOfDayReminders", () => {
  const settings = { enabled: true, time: "21:00" };
  const task = (id: string, day: Date, status = "TODO") => ({ id, title: id, status, dueDate: day.toISOString(), startAt: null, endAt: null });
  const day = (n: number) => at(2026, 11, n);
  const now = at(2026, 11, 2, 15, 0);

  it("arms tonight with the count, when something is open today", () => {
    const planned = planEndOfDayReminders(settings, now, { taskOccurrences: [task("a", day(2)), task("b", day(2)), task("done", day(2), "DONE")] });
    expect(planned).toHaveLength(1);
    expect(planned[0].at).toEqual(at(2026, 11, 2, 21, 0));
    expect(planned[0].body).toContain("۲ مورد");
  });

  it("does not ask about a day with nothing open or planned", () => {
    expect(planEndOfDayReminders(settings, now, { taskOccurrences: [task("done", day(2), "DONE")] })).toEqual([]);
    expect(planEndOfDayReminders(settings, now, { occurrences: [], taskOccurrences: [] })).toEqual([]);
  });

  it("arms a later evening only where something is planned, and without a count", () => {
    const planned = planEndOfDayReminders(settings, now, { taskOccurrences: [task("later", day(5)), task("much-later", day(8))] });
    expect(planned.map((p) => p.at)).toEqual([at(2026, 11, 5, 21, 0), at(2026, 11, 8, 21, 0)]);
    for (const p of planned) expect(p.body).toBe(endOfDayNotificationText(null).body);
  });

  it("starts with tomorrow once tonight has passed, and then does not count today's leftovers", () => {
    const planned = planEndOfDayReminders(settings, at(2026, 11, 2, 22, 30), { taskOccurrences: [task("left", day(2)), task("tomorrow", day(3))] });
    expect(planned.map((p) => p.at)).toEqual([at(2026, 11, 3, 21, 0)]);
  });

  it("arms at most a week of evenings, counted from the first one still ahead", () => {
    // Tonight still ahead: the seven evenings are the 2nd to the 8th.
    expect(planEndOfDayReminders(settings, now, { taskOccurrences: [task("last", day(2 + END_OF_DAY_ARMED_EVENINGS - 1))] }).map((p) => p.at)).toEqual([at(2026, 11, 8, 21, 0)]);
    expect(planEndOfDayReminders(settings, now, { taskOccurrences: [task("too-far", day(2 + END_OF_DAY_ARMED_EVENINGS))] })).toEqual([]);
    // Tonight past: they are the 3rd to the 9th — the last day the look-ahead covers.
    const late = at(2026, 11, 2, 22, 30);
    expect(planEndOfDayReminders(settings, late, { taskOccurrences: [task("last", day(2 + END_OF_DAY_ARMED_EVENINGS))] }).map((p) => p.at)).toEqual([at(2026, 11, 9, 21, 0)]);
    expect(planEndOfDayReminders(settings, late, { taskOccurrences: [task("beyond", day(2 + END_OF_DAY_LOOKAHEAD_DAYS))] })).toEqual([]);
  });

  it("is empty when switched off, or before anything has loaded", () => {
    expect(planEndOfDayReminders({ ...settings, enabled: false }, now, { taskOccurrences: [task("a", day(2))] })).toEqual([]);
    expect(planEndOfDayReminders(settings, now, undefined)).toEqual([]);
  });

  it("uses the evening time the person chose", () => {
    const planned = planEndOfDayReminders({ enabled: true, time: "19:45" }, now, { taskOccurrences: [task("a", day(2))] });
    expect(planned[0].at).toEqual(at(2026, 11, 2, 19, 45));
  });
});
