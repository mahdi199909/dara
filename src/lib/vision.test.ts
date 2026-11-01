import { describe, expect, it } from "vitest";
import { computeVisionItems, contributionsOf, currentValueOf, progressRatio, type VisionEntryRow, type VisionItemRow, type VisionProjectRow, type VisionTaskRow } from "./vision";

const T0 = "2026-11-01T00:00:00.000Z";

function item(over: Partial<VisionItemRow> & { id: string }): VisionItemRow {
  return {
    parentId: null,
    title: over.id,
    description: null,
    icon: null,
    color: "#3a8d80",
    status: "ACTIVE",
    sortOrder: 0,
    unit: null,
    startValue: 0,
    targetValue: null,
    mode: "ADD",
    targetDate: null,
    achievedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

const entry = (itemId: string, value: number, date: string, id = `${itemId}-${value}-${date}`): VisionEntryRow => ({ id, itemId, value, date, note: null });
const task = (visionItemId: string, value: number | null, completedAt: string | null, id = `t-${value}-${completedAt}`): VisionTaskRow => ({
  id,
  title: id,
  visionItemId,
  visionValue: value,
  completedAt,
  dueDate: null,
  createdAt: T0,
});

describe("progressRatio", () => {
  it("is how far from the start to the target the current value is, kept between 0 and 1", () => {
    expect(progressRatio(0, 10, 0)).toBe(0);
    expect(progressRatio(0, 10, 2.5)).toBe(0.25);
    expect(progressRatio(0, 10, 10)).toBe(1);
    expect(progressRatio(0, 10, 25)).toBe(1);
    expect(progressRatio(0, 10, -3)).toBe(0);
  });

  it("works when the target is below the start (losing weight)", () => {
    expect(progressRatio(90, 80, 90)).toBe(0);
    expect(progressRatio(90, 80, 85)).toBe(0.5);
    expect(progressRatio(90, 80, 79)).toBe(1);
    expect(progressRatio(90, 80, 95)).toBe(0);
  });

  it("does not divide by zero when the target equals the start", () => {
    expect(progressRatio(5, 5, 5)).toBe(1);
    expect(progressRatio(5, 5, 4)).toBe(0);
  });
});

describe("currentValueOf", () => {
  const views = (values: number[]) => values.map((value, i) => ({ id: String(i), kind: "MANUAL" as const, value, date: T0, note: null, taskId: null, title: null }));

  it("adds the entries to the starting value in ADD mode", () => {
    expect(currentValueOf(10, "ADD", views([1, 2, 3]))).toBe(16);
    expect(currentValueOf(10, "ADD", [])).toBe(10);
  });

  it("takes the latest entry (the first, newest first) in SET mode, or the starting value when there is none", () => {
    expect(currentValueOf(90, "SET", views([85, 88, 90]))).toBe(85);
    expect(currentValueOf(90, "SET", [])).toBe(90);
  });
});

describe("contributionsOf", () => {
  it("merges hand-typed entries with finished tasks, newest first, and ignores tasks without an amount", () => {
    const list = contributionsOf(
      "g",
      [entry("g", 2, "2026-11-01T10:00:00.000Z"), entry("other", 99, "2026-11-01T10:00:00.000Z")],
      [task("g", 3, "2026-11-02T10:00:00.000Z", "t1"), task("g", null, "2026-11-03T10:00:00.000Z", "t2"), task("other", 5, "2026-11-03T10:00:00.000Z", "t3")]
    );
    expect(list.map((c) => [c.kind, c.value])).toEqual([
      ["TASK", 3],
      ["MANUAL", 2],
    ]);
  });

  it("dates a task by when it was finished, else its due day, else when it was made", () => {
    const [a] = contributionsOf("g", [], [{ ...task("g", 1, null, "a"), dueDate: "2026-12-01T00:00:00.000Z" }]);
    expect(a.date).toBe("2026-12-01T00:00:00.000Z");
    const [b] = contributionsOf("g", [], [task("g", 1, null, "b")]);
    expect(b.date).toBe(T0);
  });
});

describe("computeVisionItems", () => {
  const gold = item({ id: "gold", parentId: "wealth", unit: "گرم", targetValue: 10 });
  const wealth = item({ id: "wealth" });

  it("measures an item that has a target from its entries and its finished tasks", () => {
    const [, g] = computeVisionItems([wealth, gold], [entry("gold", 2, "2026-11-01T10:00:00.000Z")], [task("gold", 3, "2026-11-02T10:00:00.000Z")], []);
    expect(g).toMatchObject({ current: 5, ratio: 0.5, entryCount: 2 });
  });

  it("gives a vision with no target of its own the average of its goals", () => {
    const run = item({ id: "run", parentId: "wealth", targetValue: 4 });
    const [w] = computeVisionItems([wealth, gold, run], [entry("gold", 5, T0), entry("run", 1, T0)], [], []);
    expect(w.ratio).toBeCloseTo((0.5 + 0.25) / 2);
    expect(w.current).toBeNull();
  });

  it("counts the projects linked to an item by how many of their tasks are done", () => {
    const projects: VisionProjectRow[] = [
      { id: "p1", visionItemId: "wealth", taskTotal: 4, taskDone: 1 },
      { id: "p2", visionItemId: "wealth", taskTotal: 0, taskDone: 0 },
    ];
    const [w] = computeVisionItems([wealth], [], [], projects);
    expect(w.ratio).toBeCloseTo(0.25); // a project with no tasks says nothing
  });

  it("has no progress at all when there is nothing to measure", () => {
    const [w] = computeVisionItems([wealth], [], [], []);
    expect(w.ratio).toBeNull();
  });

  it("treats a vision marked as achieved as complete even with nothing to measure", () => {
    const [w] = computeVisionItems([{ ...wealth, status: "ACHIEVED" }], [], [], []);
    expect(w.ratio).toBe(1);
  });

  it("lets a goal without a target take its progress from its own projects, and its vision from that", () => {
    const study = item({ id: "study", parentId: "wealth" });
    const [w, s] = computeVisionItems([wealth, study], [], [], [{ id: "p", visionItemId: "study", taskTotal: 2, taskDone: 1 }]);
    expect(s.ratio).toBe(0.5);
    expect(w.ratio).toBe(0.5);
  });

  it("reads the latest value in SET mode", () => {
    const weight = item({ id: "weight", startValue: 90, targetValue: 80, mode: "SET" });
    const [w] = computeVisionItems([weight], [entry("weight", 88, "2026-11-01T00:00:00.000Z"), entry("weight", 85, "2026-11-02T00:00:00.000Z"), entry("weight", 87, "2026-10-30T00:00:00.000Z")], [], []);
    expect(w.current).toBe(85);
    expect(w.ratio).toBe(0.5);
  });

  it("keeps the rows in the order it was given", () => {
    const ids = computeVisionItems([gold, wealth], [], [], []).map((i) => i.id);
    expect(ids).toEqual(["gold", "wealth"]);
  });
});
