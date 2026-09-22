import { describe, it, expect } from "vitest";
import { rankDebtsForPayoff, monthsSoonerWithExtra, type DebtForPayoff } from "./debtPayoffOptimizer";

function debt(overrides: Partial<DebtForPayoff>): DebtForPayoff {
  return {
    id: Math.random().toString(36),
    title: "وام",
    remainingAmount: 1_000_000,
    remainingCount: 10,
    installmentAmount: 100_000,
    effectiveAnnualRatePercent: 0,
    ...overrides,
  };
}

describe("rankDebtsForPayoff", () => {
  it("avalanche ranks the highest real annual rate first, regardless of balance size", () => {
    const cheap = debt({ id: "cheap", remainingAmount: 9_000_000, effectiveAnnualRatePercent: 5 });
    const expensive = debt({ id: "expensive", remainingAmount: 1_000_000, effectiveAnnualRatePercent: 35 });

    const ranked = rankDebtsForPayoff([cheap, expensive], "AVALANCHE");

    expect(ranked.map((d) => d.id)).toEqual(["expensive", "cheap"]);
    expect(ranked[0].order).toBe(1);
    expect(ranked[1].order).toBe(2);
  });

  it("snowball ranks the smallest remaining balance first, regardless of rate", () => {
    const small = debt({ id: "small", remainingAmount: 500_000, effectiveAnnualRatePercent: 2 });
    const large = debt({ id: "large", remainingAmount: 5_000_000, effectiveAnnualRatePercent: 40 });

    const ranked = rankDebtsForPayoff([small, large], "SNOWBALL");

    expect(ranked.map((d) => d.id)).toEqual(["small", "large"]);
  });

  it("does not mutate the input array", () => {
    const debts = [debt({ id: "a", effectiveAnnualRatePercent: 1 }), debt({ id: "b", effectiveAnnualRatePercent: 9 })];
    rankDebtsForPayoff(debts, "AVALANCHE");
    expect(debts.map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("monthsSoonerWithExtra", () => {
  it("pulls the finish date forward proportionally to the extra amount", () => {
    // 10 months left at 100,000/month = 1,000,000 remaining. +100,000/month extra doubles the
    // monthly payment, so the same total clears in 5 months instead of 10.
    expect(monthsSoonerWithExtra(10, 100_000, 100_000)).toBe(5);
  });

  it("returns 0 with no extra payment", () => {
    expect(monthsSoonerWithExtra(10, 100_000, 0)).toBe(0);
  });

  it("returns 0 for a plan that's already fully paid", () => {
    expect(monthsSoonerWithExtra(0, 100_000, 50_000)).toBe(0);
  });

  it("never returns a negative count for an extra payment larger than the whole remaining balance", () => {
    expect(monthsSoonerWithExtra(3, 100_000, 10_000_000)).toBe(2);
  });
});
