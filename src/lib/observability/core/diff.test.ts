import { describe, expect, it } from "vitest";
import { computeChanges, valuesEqual } from "./diff";
import { REDACTED, REDACTED_MONEY } from "./redact";

describe("valuesEqual", () => {
  it("treats null and undefined as the same empty value", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(undefined, undefined)).toBe(true);
    expect(valuesEqual(null, 0)).toBe(false);
    expect(valuesEqual("", null)).toBe(false);
  });

  it("compares dates by instant, arrays and objects structurally", () => {
    expect(valuesEqual(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-20T00:00:00Z"))).toBe(true);
    expect(valuesEqual(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-21T00:00:00Z"))).toBe(false);
    expect(valuesEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(valuesEqual(NaN, NaN)).toBe(true);
    expect(valuesEqual(1, "1")).toBe(false);
  });
});

describe("computeChanges", () => {
  const before = { id: "exp_1", userId: "usr_1", amount: 250000, categoryId: "cat_1", accountId: "acc_1", note: "lunch", updatedAt: "2026-09-19", createdAt: "2026-09-01" };
  const after = { ...before, amount: 300000, categoryId: "cat_2", updatedAt: "2026-09-20" };

  it("lists only the fields that changed, ignoring bookkeeping fields", () => {
    const { changes, changedFields } = computeChanges(before, after);
    expect(changedFields.sort()).toEqual(["amount", "categoryId"]);
    expect(changes.categoryId).toEqual({ from: "cat_1", to: "cat_2" });
    expect(changes.amount).toEqual({ from: 250000, to: 300000 });
    expect(changes).not.toHaveProperty("updatedAt");
    expect(changes).not.toHaveProperty("id");
  });

  it("masks money, or reduces it to a flag, when the policy says so (the example in the requirements)", () => {
    const policy = { money: ["amount"] };
    expect(computeChanges(before, after, policy, "redacted").changes).toEqual({
      amount: { from: REDACTED_MONEY, to: REDACTED_MONEY },
      categoryId: { from: "cat_1", to: "cat_2" },
    });
    expect(computeChanges(before, after, policy, "flag").changes.amount).toEqual({ changed: true });
    expect(computeChanges(before, after, policy, "values").changes.amount).toEqual({ from: 250000, to: 300000 });
  });

  it("never records the values of fields marked flag-only", () => {
    const { changes } = computeChanges({ note: "old text" }, { note: "new text" }, { flagOnly: ["note"] });
    expect(changes.note).toEqual({ changed: true });
    expect(JSON.stringify(changes)).not.toContain("text");
  });

  it("treats a creation as everything changed from nothing, and a deletion the other way", () => {
    expect(computeChanges(null, { name: "Cash", type: "CASH" }).changes).toEqual({ name: { from: null, to: "Cash" }, type: { from: null, to: "CASH" } });
    expect(computeChanges({ name: "Cash" }, null).changes).toEqual({ name: { from: "Cash", to: null } });
    expect(computeChanges(undefined, undefined).changedFields).toEqual([]);
  });

  it("returns nothing when nothing changed", () => {
    expect(computeChanges(before, { ...before, updatedAt: "later" })).toEqual({ changes: {}, changedFields: [] });
  });

  it("can be limited to some fields or extended with more exclusions", () => {
    expect(computeChanges(before, after, { include: ["categoryId"] }).changedFields).toEqual(["categoryId"]);
    expect(computeChanges(before, after, { exclude: ["amount", "id"] }).changedFields).toEqual(["categoryId", "updatedAt"]);
  });

  it("still scrubs secrets that end up inside recorded values", () => {
    const { changes } = computeChanges({ meta: { note: "a" } }, { meta: { password: "hunter2", note: "b" } });
    expect(JSON.stringify(changes)).not.toContain("hunter2");
    expect((changes.meta as { to: { password: string } }).to.password).toBe(REDACTED);
  });

  it("records dates as ISO strings", () => {
    const { changes } = computeChanges({ dueDate: new Date("2026-09-20T00:00:00Z") }, { dueDate: new Date("2026-09-21T00:00:00Z") });
    expect(changes.dueDate).toEqual({ from: "2026-09-20T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" });
  });
});
