import { describe, it, expect } from "vitest";
import { simulateSpendReduction } from "./whatIfSimulator";

describe("simulateSpendReduction", () => {
  it("scales the period's real spend by the reduction percent", () => {
    const result = simulateSpendReduction({ categoryId: "shopping", name: "خرید", amount: 1_000_000 }, 20, 30);
    expect(result.periodSavings).toBe(200_000);
  });

  it("annualizes the period saving by the real period length, not an assumed month", () => {
    // A 7-day period saving 140,000 extrapolates to 140,000/7*365 = 7,300,000 a year.
    const result = simulateSpendReduction({ categoryId: "shopping", name: "خرید", amount: 700_000 }, 20, 7);
    expect(result.periodSavings).toBe(140_000);
    expect(result.annualizedSavings).toBe(7_300_000);
  });

  it("a 30-day period annualizes close to 12x the monthly saving", () => {
    const result = simulateSpendReduction({ categoryId: "shopping", name: "خرید", amount: 3_000_000 }, 20, 30);
    expect(result.periodSavings).toBe(600_000);
    expect(result.annualizedSavings).toBe(7_300_000);
  });

  it("rounds to whole Toman even when the real math is fractional — format() expects an integer amount and won't round for the caller", () => {
    const result = simulateSpendReduction({ categoryId: "shopping", name: "خرید", amount: 4_000_000 }, 20, 31);
    expect(Number.isInteger(result.periodSavings)).toBe(true);
    expect(Number.isInteger(result.annualizedSavings)).toBe(true);
    expect(result.annualizedSavings).toBe(9_419_355); // 800,000 / 31 * 365 = 9,419,354.83...
  });

  it("returns zero annualized savings for a zero-length period instead of dividing by zero", () => {
    const result = simulateSpendReduction({ categoryId: "shopping", name: "خرید", amount: 500_000 }, 20, 0);
    expect(result.annualizedSavings).toBe(0);
  });

  it("carries the category name and requested percent through untouched", () => {
    const result = simulateSpendReduction({ categoryId: "c1", name: "تفریح", amount: 100_000 }, 35, 30);
    expect(result.name).toBe("تفریح");
    expect(result.reductionPct).toBe(35);
  });
});
