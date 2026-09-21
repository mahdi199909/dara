import { describe, expect, it } from "vitest";
import { describeDrop, dropIndicator, groupCategories, planCategoryMove, resolveDropTarget, type CategoryLite } from "./categoryReorder";

const c = (id: string, parentCategoryId: string | null = null): CategoryLite => ({ id, name: id, parentCategoryId });

// الف (ا1, ا2) · ب · ج (ج1) · د
const list = [c("الف"), c("ا1", "الف"), c("ا2", "الف"), c("ب"), c("ج"), c("ج1", "ج"), c("د")];
const ids = (plan: { orderedIds: string[] } | null) => plan?.orderedIds.join(",");

describe("groupCategories", () => {
  it("lists each top-level category with its sub-categories", () => {
    expect(groupCategories(list).map((g) => [g.top.id, g.children.map((x) => x.id)])).toEqual([
      ["الف", ["ا1", "ا2"]],
      ["ب", []],
      ["ج", ["ج1"]],
      ["د", []],
    ]);
  });
});

describe("resolveDropTarget — a childless category", () => {
  it("drops above, inside or below a top-level row by where the pointer is", () => {
    expect(resolveDropTarget(list, "د", "ب", 0.1, 0.1)).toEqual({ kind: "before", rowId: "ب" });
    expect(resolveDropTarget(list, "د", "ب", 0.5, 0.5)).toEqual({ kind: "nest", rowId: "ب" });
    expect(resolveDropTarget(list, "د", "ب", 0.9, 0.9)).toEqual({ kind: "after", rowId: "ب" });
  });

  it("joins the sub-categories when dropped under a top-level row that has some", () => {
    expect(resolveDropTarget(list, "د", "الف", 0.9, 0.9)).toEqual({ kind: "before", rowId: "ا1" });
  });

  it("goes between two sub-categories as one of them", () => {
    expect(resolveDropTarget(list, "د", "ا1", 0.2, 0.2)).toEqual({ kind: "before", rowId: "ا1" });
    expect(resolveDropTarget(list, "د", "ا1", 0.8, 0.8)).toEqual({ kind: "after", rowId: "ا1" });
  });

  it("cannot nest into a sub-category, into itself, or into its own parent again", () => {
    expect(resolveDropTarget(list, "د", "ا1", 0.5, 0.5)?.kind).not.toBe("nest");
    expect(resolveDropTarget(list, "د", "د", 0.5, 0.5)).toBeNull();
    expect(resolveDropTarget(list, "ا1", "الف", 0.5, 0.5)).toBeNull();
  });

  it("does nothing for a lone child hovering under its own parent", () => {
    expect(resolveDropTarget(list, "ج1", "ج", 0.9, 0.9)).toBeNull();
  });
});

describe("resolveDropTarget — a category with sub-categories", () => {
  it("only moves between groups, judged by the group's own middle", () => {
    expect(resolveDropTarget(list, "الف", "ج1", 0.9, 0.2)).toEqual({ kind: "before", rowId: "ج" });
    expect(resolveDropTarget(list, "الف", "ج1", 0.1, 0.8)).toEqual({ kind: "after", rowId: "ج" });
    expect(resolveDropTarget(list, "الف", "ب", 0.5, 0.5)).toEqual({ kind: "after", rowId: "ب" });
  });

  it("ignores its own rows", () => {
    expect(resolveDropTarget(list, "الف", "ا1", 0.5, 0.5)).toBeNull();
  });
});

describe("planCategoryMove", () => {
  it("puts a top-level category between two others", () => {
    const plan = planCategoryMove(list, "د", { kind: "before", rowId: "ب" })!;
    expect(ids(plan)).toBe("الف,ا1,ا2,د,ب,ج,ج1");
    expect(plan.parentCategoryId).toBeNull();
    expect(plan.changesParent).toBe(false);
    expect(plan.noop).toBe(false);
  });

  it("moves a whole group with its sub-categories", () => {
    expect(ids(planCategoryMove(list, "الف", { kind: "after", rowId: "ب" }))).toBe("ب,الف,ا1,ا2,ج,ج1,د");
    expect(ids(planCategoryMove(list, "ج", { kind: "before", rowId: "الف" }))).toBe("ج,ج1,الف,ا1,ا2,ب,د");
  });

  it("appends to the end", () => {
    expect(ids(planCategoryMove(list, "ب", { kind: "end" }))).toBe("الف,ا1,ا2,ج,ج1,د,ب");
    expect(ids(planCategoryMove(list, "الف", { kind: "end" }))).toBe("ب,ج,ج1,د,الف,ا1,ا2");
  });

  it("nests as the last sub-category and changes the parent", () => {
    const plan = planCategoryMove(list, "د", { kind: "nest", rowId: "ب" })!;
    expect(ids(plan)).toBe("الف,ا1,ا2,ب,د,ج,ج1");
    expect(plan.parentCategoryId).toBe("ب");
    expect(plan.changesParent).toBe(true);
  });

  it("puts a category between two sub-categories, taking the group as its parent", () => {
    const plan = planCategoryMove(list, "د", { kind: "after", rowId: "ا1" })!;
    expect(ids(plan)).toBe("الف,ا1,د,ا2,ب,ج,ج1");
    expect(plan.parentCategoryId).toBe("الف");
    expect(plan.changesParent).toBe(true);
  });

  it("reorders sub-categories inside their group without changing the parent", () => {
    const plan = planCategoryMove(list, "ا2", { kind: "before", rowId: "ا1" })!;
    expect(ids(plan)).toBe("الف,ا2,ا1,ب,ج,ج1,د");
    expect(plan.changesParent).toBe(false);
  });

  it("promotes a sub-category to the top level between two groups", () => {
    const plan = planCategoryMove(list, "ا1", { kind: "before", rowId: "ج" })!;
    expect(ids(plan)).toBe("الف,ا2,ب,ا1,ج,ج1,د");
    expect(plan.parentCategoryId).toBeNull();
    expect(plan.changesParent).toBe(true);
  });

  it("recognises a drop where it already is", () => {
    expect(planCategoryMove(list, "ب", { kind: "before", rowId: "ج" })!.noop).toBe(true);
    expect(planCategoryMove(list, "ب", { kind: "after", rowId: "الف" })!.noop).toBe(true);
    expect(planCategoryMove(list, "ا1", { kind: "before", rowId: "ا2" })!.noop).toBe(true);
    expect(planCategoryMove(list, "د", { kind: "end" })!.noop).toBe(true);
  });

  it("refuses to put a group inside another, or onto a sub-category row", () => {
    expect(planCategoryMove(list, "الف", { kind: "nest", rowId: "ب" })).toBeNull();
    expect(planCategoryMove(list, "الف", { kind: "before", rowId: "ج1" })).toBeNull();
    expect(planCategoryMove(list, "د", { kind: "nest", rowId: "ج1" })).toBeNull();
    expect(planCategoryMove(list, "د", { kind: "before", rowId: "د" })).toBeNull();
    expect(planCategoryMove(list, "nope", { kind: "end" })).toBeNull();
  });

  it("keeps every category exactly once", () => {
    for (const target of [
      { kind: "before", rowId: "ب" },
      { kind: "after", rowId: "ج1" },
      { kind: "nest", rowId: "الف" },
      { kind: "end" },
    ] as const) {
      const plan = planCategoryMove(list, "د", target)!;
      expect([...plan.orderedIds].sort()).toEqual(list.map((x) => x.id).sort());
    }
  });
});

describe("dropIndicator", () => {
  it("draws the line at the top of the row it goes before", () => {
    expect(dropIndicator(list, { kind: "before", rowId: "ب" })).toEqual({ rowId: "ب", edge: "top" });
  });

  it("draws the line under the whole group it goes after", () => {
    expect(dropIndicator(list, { kind: "after", rowId: "ب" })).toEqual({ rowId: "ب", edge: "bottom" });
    expect(dropIndicator(list, { kind: "after", rowId: "الف" })).toEqual({ rowId: "ا2", edge: "bottom" });
  });

  it("draws the end line under the last row, and none for nesting", () => {
    expect(dropIndicator(list, { kind: "end" })).toEqual({ rowId: "د", edge: "bottom" });
    expect(dropIndicator(list, { kind: "nest", rowId: "ب" })).toBeNull();
  });
});

describe("describeDrop", () => {
  it("names the two neighbours it will fall between", () => {
    expect(describeDrop(list, "د", { kind: "before", rowId: "ب" })).toBe("بین «الف» و «ب»");
  });

  it("says before / after at the ends of the list", () => {
    expect(describeDrop(list, "د", { kind: "before", rowId: "الف" })).toBe("قبل از «الف»");
    expect(describeDrop(list, "ب", { kind: "end" })).toBe("بعد از «د»");
  });

  it("says inside for nesting, and names the parent for a sub-category", () => {
    expect(describeDrop(list, "د", { kind: "nest", rowId: "ب" })).toBe("داخل «ب»");
    expect(describeDrop(list, "د", { kind: "after", rowId: "ا1" })).toBe("بین «ا1» و «ا2» (زیرمجموعهٔ «الف»)");
  });

  it("is null when the drop is not allowed", () => {
    expect(describeDrop(list, "الف", { kind: "nest", rowId: "ب" })).toBeNull();
  });
});
