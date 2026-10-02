import { describe, expect, it } from "vitest";
import { ancestorIds, buildTree, computeCheckChange, computeMove, computeRecheck, descendantIds, nextSortOrder, progressOf, rootIdOf, type TreeRow } from "./checklistTree";

// سمینار
// ├─ سالن
// │  ├─ تماس
// │  └─ قرارداد
// └─ ثبت‌نام
const row = (id: string, parentId: string | null, sortOrder: number, checked = false): TreeRow => ({ id, parentId, checked, sortOrder, createdAt: "2026-10-01T00:00:00.000Z" });
const seminar = () => [row("seminar", null, 0), row("hall", "seminar", 0), row("call", "hall", 0), row("contract", "hall", 1), row("signup", "seminar", 1)];
const apply = (rows: TreeRow[], change: { check: string[]; uncheck: string[] }) =>
  rows.map((r) => (change.check.includes(r.id) ? { ...r, checked: true } : change.uncheck.includes(r.id) ? { ...r, checked: false } : r));

describe("checklist tree", () => {
  it("nests items under their lists in saved order", () => {
    const rows = [row("b", null, 1), row("a", null, 0), row("a2", "a", 1), row("a1", "a", 0)];
    const tree = buildTree(rows);
    expect(tree.map((n) => n.item.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((n) => n.item.id)).toEqual(["a1", "a2"]);
  });

  it("shows an item whose parent is gone as a list of its own", () => {
    expect(buildTree([row("orphan", "deleted", 0)]).map((n) => n.item.id)).toEqual(["orphan"]);
  });

  it("finds what is below and above an item", () => {
    expect(descendantIds(seminar(), "seminar").sort()).toEqual(["call", "contract", "hall", "signup"]);
    expect(ancestorIds(seminar(), "call")).toEqual(["hall", "seminar"]);
    expect(rootIdOf(seminar(), "contract")).toBe("seminar");
    expect(rootIdOf(seminar(), "seminar")).toBe("seminar");
  });

  it("ticking an item ticks everything below it, and its parent once all siblings are done", () => {
    let rows = apply(seminar(), computeCheckChange(seminar(), "call", true));
    expect(rows.filter((r) => r.checked).map((r) => r.id)).toEqual(["call"]);
    rows = apply(rows, computeCheckChange(rows, "contract", true));
    expect(rows.filter((r) => r.checked).map((r) => r.id).sort()).toEqual(["call", "contract", "hall"]);
    rows = apply(rows, computeCheckChange(rows, "signup", true));
    expect(rows.every((r) => r.checked)).toBe(true);
  });

  it("ticking a list ticks all of it; unticking one item unticks everything above it", () => {
    let rows = apply(seminar(), computeCheckChange(seminar(), "seminar", true));
    expect(rows.every((r) => r.checked)).toBe(true);
    const change = computeCheckChange(rows, "call", false);
    expect(change.uncheck.sort()).toEqual(["call", "hall", "seminar"]);
    rows = apply(rows, change);
    expect(rows.find((r) => r.id === "contract")!.checked).toBe(true);
  });

  it("re-evaluates the items above after a new item or a deletion", () => {
    const done = seminar().map((r) => ({ ...r, checked: true }));
    expect(computeRecheck([...done, row("new", "hall", 2)], "hall").uncheck.sort()).toEqual(["hall", "seminar"]);
    // the only unticked child is deleted: the parent is now done
    const rows = seminar().map((r) => ({ ...r, checked: r.id !== "contract" && r.id !== "hall" && r.id !== "seminar" }));
    expect(computeRecheck(rows.filter((r) => r.id !== "contract"), "hall").check.sort()).toEqual(["hall", "seminar"]);
    // an item without children keeps its state
    expect(computeRecheck(seminar(), "call")).toEqual({ check: [], uncheck: [] });
  });

  it("counts progress over the things to do (items without sub-items)", () => {
    const rows = apply(seminar(), computeCheckChange(seminar(), "call", true));
    expect(progressOf(rows, "seminar")).toEqual({ done: 1, total: 3 });
    expect(progressOf(rows, "hall")).toEqual({ done: 1, total: 2 });
    expect(progressOf(rows, "signup")).toEqual({ done: 0, total: 0 });
  });

  it("moves an item among its siblings and renumbers them", () => {
    expect(computeMove(seminar(), "signup", "UP")).toEqual([
      { id: "signup", sortOrder: 0 },
      { id: "hall", sortOrder: 1 },
    ]);
    expect(computeMove(seminar(), "hall", "UP")).toEqual([]);
    expect(computeMove(seminar(), "signup", "DOWN")).toEqual([]);
    // two items with the same place (made on two devices) get distinct ones
    const tied = [row("x", null, 0), row("y", null, 0), row("z", null, 0)];
    expect(computeMove(tied, "z", "UP").sort((a, b) => a.sortOrder - b.sortOrder)).toEqual([
      { id: "z", sortOrder: 1 },
      { id: "y", sortOrder: 2 },
    ]);
  });

  it("puts a new item after the last of its siblings", () => {
    expect(nextSortOrder(seminar(), "hall")).toBe(2);
    expect(nextSortOrder(seminar(), "signup")).toBe(0);
    expect(nextSortOrder(seminar(), null)).toBe(1);
  });
});
