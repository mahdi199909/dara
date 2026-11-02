import { describe, expect, it } from "vitest";
import { boxSummary, boxTotals, clockText, firstFreeStart, freeGaps, layOutBlocks, minutesOfClock, openTasksOfDay, planOfDay, roundUp, timelineRange, type PlanBlock } from "./dayPlan";

const day = new Date(2026, 10, 2);
const at = (h: number, m = 0, plus = 0) => new Date(2026, 10, 2 + plus, h, m).toISOString();
const event = (id: string, title: string, start: string, end: string, over: Record<string, unknown> = {}, isDone = false) => ({ startAt: start, endAt: end, isDone, event: { id, title, allDay: false, ...over } });
const task = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, status: "TODO", startAt: null, endAt: null, ...over });
const block = (key: string, startMin: number, endMin: number): PlanBlock => ({ key, kind: "TASK", id: key, title: key, startMin, endMin, done: false, color: null });

describe("planOfDay", () => {
  const data = {
    occurrences: [event("e1", "جلسه", at(10), at(11), { category: { color: "#0e5f54" } }), event("e2", "تعطیل", at(0), at(23, 59), { allDay: true }), event("e3", "شبانه", at(23), at(1, 0, 1))],
    taskOccurrences: [
      task("t1", "گزارش", { startAt: at(14), endAt: at(15, 30), category: { color: "#aa0000" } }),
      task("t2", "بی‌ساعت", { boxMinutes: 45 }),
      task("t3", "تمام‌شده", { status: "DONE", startAt: at(8), endAt: at(9) }),
      task("t4", "لغو", { status: "CANCELLED", startAt: at(12), endAt: at(13) }),
      task("t5", "فقط شروع", { startAt: at(16) }),
      task("t6", "کارِ تمام‌شدهٔ بی‌ساعت", { status: "DONE" }),
    ],
  };
  const plan = planOfDay(data, day);

  it("draws what has a start and an end, and drops what is cancelled", () => {
    expect(plan.blocks.map((b) => [b.id, b.startMin, b.endMin, b.done])).toEqual([
      ["t3", 480, 540, true],
      ["e1", 600, 660, false],
      ["t1", 840, 930, false],
      ["t5", 960, 990, false],
      ["e3", 1380, 1440, false],
    ]);
    expect(plan.blocks.find((b) => b.id === "e1")!.color).toBe("#0e5f54");
  });

  it("gives a task that has a start and no end the default length", () => {
    expect(plan.blocks.find((b) => b.id === "t5")).toMatchObject({ startMin: 960, endMin: 990 });
  });

  it("clips an event that runs past midnight to the end of the day", () => {
    expect(plan.blocks.find((b) => b.id === "e3")!.endMin).toBe(1440);
  });

  it("lists the all-day events and the open tasks without a time apart", () => {
    expect(plan.allDay.map((a) => a.id)).toEqual(["e2"]);
    expect(plan.tray).toEqual([{ id: "t2", title: "بی‌ساعت", boxMinutes: 45, color: null, categoryId: null, timed: false }]);
  });

  it("is empty for nothing", () => {
    expect(planOfDay(undefined, day)).toEqual({ blocks: [], allDay: [], tray: [] });
  });
});

describe("layOutBlocks", () => {
  it("leaves blocks that do not touch in one column", () => {
    const laid = layOutBlocks([block("a", 540, 600), block("b", 600, 660)]);
    expect(laid.map((b) => [b.key, b.lane, b.lanes])).toEqual([["a", 0, 1], ["b", 0, 1]]);
  });

  it("puts overlapping blocks side by side, and lets a later one reuse a freed column", () => {
    const laid = layOutBlocks([block("a", 540, 660), block("b", 570, 600), block("c", 610, 700), block("d", 800, 830)]);
    const by = Object.fromEntries(laid.map((b) => [b.key, [b.lane, b.lanes]]));
    expect(by.a).toEqual([0, 2]);
    expect(by.b).toEqual([1, 2]);
    // c begins while a still runs (to 660) but after b ended (600): it takes b's column.
    expect(by.c).toEqual([1, 2]);
    // d is alone again.
    expect(by.d).toEqual([0, 1]);
  });

  it("sizes the group by its widest moment", () => {
    const laid = layOutBlocks([block("a", 0, 100), block("b", 10, 20), block("c", 15, 30)]);
    expect(laid.every((b) => b.lanes === 3)).toBe(true);
  });
});

describe("timelineRange", () => {
  it("is the waking hours, widened for what lies outside them", () => {
    expect(timelineRange([], 7, 23)).toEqual({ fromMin: 420, toMin: 1380 });
    expect(timelineRange([block("early", 330, 400)], 7, 23)).toEqual({ fromMin: 300, toMin: 1380 });
    expect(timelineRange([block("late", 1400, 1430)], 7, 23)).toEqual({ fromMin: 420, toMin: 1440 });
  });

  it("shows the whole day when the sleep hour is not after the wake hour", () => {
    expect(timelineRange([], 23, 7)).toEqual({ fromMin: 0, toMin: 1440 });
  });
});

describe("free gaps", () => {
  const blocks = [block("a", 540, 600), block("b", 570, 660), block("c", 720, 780)];

  it("lists the stretches between blocks that are long enough", () => {
    expect(freeGaps(blocks, 480, 840, 30)).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 660, endMin: 720 },
      { startMin: 780, endMin: 840 },
    ]);
    expect(freeGaps(blocks, 480, 840, 61)).toEqual([]);
  });

  it("finds the first place a duration fits, not before a given minute", () => {
    expect(firstFreeStart(blocks, 45, 480, 840)).toBe(480);
    expect(firstFreeStart(blocks, 45, 480, 840, 500)).toBe(660);
    expect(firstFreeStart(blocks, 90, 480, 840)).toBeNull();
  });
});

describe("clock helpers", () => {
  it("round trip a time", () => {
    expect(clockText(570)).toBe("09:30");
    expect(clockText(0)).toBe("00:00");
    expect(minutesOfClock("09:30")).toBe(570);
    expect(minutesOfClock("24:00")).toBeNull();
    expect(minutesOfClock("nine")).toBeNull();
  });

  it("rounds a minute up to the next five", () => {
    expect(roundUp(602)).toBe(605);
    expect(roundUp(600)).toBe(600);
  });
});

describe("the boxes", () => {
  it("adds the boxes against the waking hours", () => {
    const totals = boxTotals([{ boxMinutes: 45 }, { boxMinutes: 60 }, { boxMinutes: null }], 7, 23);
    expect(totals).toEqual({ boxed: 105, boxedCount: 2, taskCount: 3, awake: 960, spare: 855 });
  });

  it("counts a day that wraps past midnight", () => {
    expect(boxTotals([], 20, 4).awake).toBe(8 * 60);
  });

  it("says it plainly, with no verdict", () => {
    const f = (m: number) => `${m}د`;
    expect(boxSummary(boxTotals([], 7, 23), f)).toBe("کار بازی برای امروز نیست.");
    expect(boxSummary(boxTotals([{ boxMinutes: null }], 7, 23), f)).toBe("هنوز برای هیچ کاری جعبه نگذاشتی.");
    expect(boxSummary(boxTotals([{ boxMinutes: 60 }], 7, 23), f)).toBe("جعبه‌ها 60د از 960د وقت بیداری‌اند؛ 900د آزاد می‌ماند.");
    const over = boxSummary(boxTotals([{ boxMinutes: 600 }, { boxMinutes: 600 }], 7, 23), f);
    expect(over).toBe("جعبه‌ها 1200د از 960د وقت بیداری‌اند؛ 240د بیشتر از وقتی که داری.");
    expect(over).not.toMatch(/[!！]|شکست|عقب/);
  });
});

describe("openTasksOfDay", () => {
  it("lists every open task, those with a time first and in order of it, carrying their box", () => {
    const list = openTasksOfDay({
      taskOccurrences: [
        task("late", "دیر", { startAt: at(16), boxMinutes: 30, categoryId: "c1" }),
        task("none", "بی‌ساعت"),
        task("early", "زود", { startAt: at(8) }),
        task("done", "تمام", { status: "DONE" }),
        task("cancelled", "لغو", { status: "CANCELLED" }),
      ],
    });
    expect(list.map((t) => [t.id, t.timed, t.boxMinutes, t.categoryId])).toEqual([
      ["early", true, null, null],
      ["late", true, 30, "c1"],
      ["none", false, null, null],
    ]);
    expect(openTasksOfDay(undefined)).toEqual([]);
  });
});
