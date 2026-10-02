import { describe, expect, it } from "vitest";
import { dependencyCandidates, describeRule, planChecklist, snapBackward, snapForward, type PlanItem } from "./checklistSchedule";

let order = 0;
const item = (id: string, parentId: string | null, durationMin: number | null = null, dep: Partial<PlanItem> = {}): PlanItem => ({
  id,
  parentId,
  title: id,
  sortOrder: order++,
  createdAt: "2026-10-01T00:00:00.000Z",
  checked: false,
  durationMin,
  depType: null,
  depItemId: null,
  lagMin: 0,
  ...dep,
});
// Saturday 3 October 2026, 09:00 local time
const START = new Date(2026, 9, 3, 9, 0);
const hm = (d: Date) => `${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("planning a checklist", () => {
  it("without rules, steps follow each other in list order; groups are just containers", () => {
    const items = [item("root", null), item("hall", "root"), item("call", "hall", 30), item("visit", "hall", 60), item("signup", "root", 45), item("notime", "root")];
    const plan = planChecklist(items, "root", { start: START });
    expect(plan.steps.map((s) => [s.id, hm(s.start), hm(s.end)])).toEqual([
      ["call", "3 09:00", "3 09:30"],
      ["visit", "3 09:30", "3 10:30"],
      ["signup", "3 10:30", "3 11:15"],
    ]);
    expect(plan.steps[0].path).toEqual(["hall"]);
    expect(plan.unscheduled.map((u) => u.id)).toEqual(["notime"]);
    expect(hm(plan.end!)).toBe("3 11:15");
  });

  it("AFTER a group waits for all of it, with a gap", () => {
    const items = [
      item("root", null),
      item("hall", "root"),
      item("call", "hall", 30),
      item("contract", "hall", 60),
      item("topic", "root", 60, { depType: "AFTER", depItemId: "hall", lagMin: 24 * 60 }),
    ];
    const plan = planChecklist(items, "root", { start: START });
    const topic = plan.steps.find((s) => s.id === "topic")!;
    expect(hm(topic.start)).toBe("4 10:30");
    expect(topic.rule).toBe("۱ روز بعد از «hall»");
  });

  it("WITH starts together; BEFORE ends when the other begins", () => {
    const items = [
      item("root", null),
      item("a", "root", 60),
      item("b", "root", 30, { depType: "WITH", depItemId: "a" }),
      item("c", "root", 120, { depType: "AFTER", depItemId: "a", lagMin: 60 }),
      item("ticket", "root", 30, { depType: "BEFORE", depItemId: "c" }),
    ];
    const plan = planChecklist(items, "root", { start: START });
    const at = (id: string) => plan.steps.find((s) => s.id === id)!;
    expect(hm(at("b").start)).toBe("3 09:00");
    expect(hm(at("c").start)).toBe("3 11:00");
    expect([hm(at("ticket").start), hm(at("ticket").end)]).toEqual(["3 10:30", "3 11:00"]);
  });

  it("the default 'after the previous step' never loops with a BEFORE rule", () => {
    // ticket must be done before travel; travel has no rule and comes right after ticket in the list.
    const items = [item("root", null), item("ticket", "root", 30, { depType: "BEFORE", depItemId: "travel" }), item("travel", "root", 120)];
    const plan = planChecklist(items, "root", { start: START });
    expect(plan.problems).toEqual([]);
    expect(hm(plan.steps.find((s) => s.id === "travel")!.start)).toBe("3 09:00");
    expect(hm(plan.steps.find((s) => s.id === "ticket")!.end)).toBe("3 09:00");
  });

  it("a group's rule applies to its first step; the rest of the group follows on", () => {
    const items = [
      item("root", null),
      item("hall", "root"),
      item("find", "hall", 60),
      item("sign", "hall", 60),
      item("other", "root", 30),
      item("speakers", "root", null, { depType: "AFTER", depItemId: "hall", lagMin: 24 * 60 }),
      item("invite", "speakers", 30),
      item("topic", "speakers", 60),
    ];
    const plan = planChecklist(items, "root", { start: START });
    const at = (id: string) => hm(plan.steps.find((s) => s.id === id)!.start);
    expect(at("invite")).toBe("4 11:00");
    expect(at("topic")).toBe("4 11:30");
    expect(plan.steps.find((s) => s.id === "invite")!.rule).toBe("۱ روز بعد از «hall»");
  });

  it("reports a real circle instead of guessing", () => {
    const items = [item("root", null), item("x", "root", 30, { depType: "AFTER", depItemId: "y" }), item("y", "root", 30, { depType: "AFTER", depItemId: "x" })];
    const plan = planChecklist(items, "root", { start: START });
    expect(plan.steps).toEqual([]);
    expect(plan.problems.map((p) => p.id).sort()).toEqual(["x", "y"]);
  });

  it("a step pinned by hand moves the steps after it", () => {
    const items = [item("root", null), item("a", "root", 60), item("b", "root", 30)];
    const plan = planChecklist(items, "root", { start: START, pinned: { a: new Date(2026, 9, 5, 14, 0) } });
    expect(plan.steps.map((s) => [s.id, hm(s.start), s.pinned])).toEqual([
      ["a", "5 14:00", true],
      ["b", "5 15:00", false],
    ]);
  });

  it("keeps steps inside working hours and skips Friday", () => {
    // Thursday 8 October 16:30: a 60-minute step does not fit before 17:00 → Saturday 10 Oct 09:00 (Friday skipped)
    const thu = new Date(2026, 9, 8, 16, 30);
    const wh = { startHour: 9, endHour: 17, skipFriday: true };
    expect(hm(snapForward(thu, 60, wh))).toBe("10 09:00");
    expect(hm(snapForward(new Date(2026, 9, 3, 7, 0), 30, wh))).toBe("3 09:00");
    // ending before Saturday 09:30 with 60 minutes → Thursday 17:00 (Friday skipped)
    expect(hm(snapBackward(new Date(2026, 9, 10, 9, 30), 60, wh))).toBe("8 17:00");
    const items = [item("root", null), item("a", "root", 300), item("b", "root", 240)];
    const plan = planChecklist(items, "root", { start: START, workHours: wh });
    expect(plan.steps.map((s) => hm(s.start))).toEqual(["3 09:00", "4 09:00"]);
  });

  it("leaves ticked steps out unless asked", () => {
    const items = [item("root", null), item("done", "root", 30, { checked: true }), item("todo", "root", 30)];
    expect(planChecklist(items, "root", { start: START }).steps.map((s) => s.id)).toEqual(["todo"]);
    expect(planChecklist(items, "root", { start: START, includeChecked: true }).steps.map((s) => s.id)).toEqual(["done", "todo"]);
  });

  it("a rule can point at any other item of the list but not at itself, its sub-items or its own groups", () => {
    const items = [item("root", null), item("g", "root"), item("g1", "g", 10), item("g2", "g", 10), item("h", "root", 10), item("other", null)];
    expect(dependencyCandidates(items, "root", "g").map((i) => i.id)).toEqual(["h"]);
    expect(dependencyCandidates(items, "root", "g1").map((i) => i.id).sort()).toEqual(["g2", "h"]);
    expect(describeRule("WITH", "سالن", 0)).toBe("هم‌زمان با شروع «سالن»");
    expect(describeRule("BEFORE", "سفر", 120)).toBe("۲ ساعت قبل از «سفر»");
    expect(describeRule("AFTER", "سالن", 2 * 24 * 60)).toBe("۲ روز بعد از «سالن»");
    expect(describeRule("WITH", "برگزاری", 120)).toBe("۲ ساعت بعد از شروع «برگزاری»");
    expect(describeRule("AFTER", "سالن", 7 * 24 * 60)).toBe("۱ هفته بعد از «سالن»");
  });
});

describe("ready-made lists with a plan", () => {
  it("every template's rules resolve and plan without a circle", async () => {
    const { CHECKLIST_TEMPLATES } = await import("./checklistTemplates");
    const { resolveTreeRules } = await import("./checklistPlanning");
    for (const t of CHECKLIST_TEMPLATES) {
      const flat: PlanItem[] = [];
      const named: { id: string; title: string; depType?: string | null; depTitle?: string | null }[] = [];
      let n = 0;
      const add = (node: typeof t.tree, parentId: string | null) => {
        const id = `n${n++}`;
        flat.push(item(id, parentId, node.durationMin ?? null, { title: node.title, lagMin: node.lagMin ?? 0 }));
        named.push({ id, title: node.title, depType: node.depType, depTitle: node.depTitle });
        for (const c of node.children ?? []) add(c, id);
      };
      add(t.tree, null);
      const wanted = named.filter((x) => x.depType).length;
      const rules = resolveTreeRules(named);
      expect(rules.length, `${t.id}: every rule names a title in the list`).toBe(wanted);
      for (const r of rules) Object.assign(flat.find((f) => f.id === r.id)!, { depType: r.depType, depItemId: r.depItemId });
      const plan = planChecklist(flat, "n0", { start: START, workHours: { startHour: 9, endHour: 17, skipFriday: true } });
      expect(plan.problems, t.id).toEqual([]);
    }
  });
});
