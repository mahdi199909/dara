import { describe, it, expect } from "vitest";
import { computeBudgetProgress } from "./budgetProgress";

const NOW = new Date(2026, 8, 22); // 22 Sep 2026

describe("computeBudgetProgress", () => {
  it("sums only this month's EXPENSE transactions in the budget's category", () => {
    const [progress] = computeBudgetProgress(
      [{ categoryId: "food", monthlyCap: 1000 }],
      [
        { type: "EXPENSE", categoryId: "food", amount: 300, date: new Date(2026, 8, 1) },
        { type: "EXPENSE", categoryId: "food", amount: 200, date: new Date(2026, 8, 20) },
        { type: "EXPENSE", categoryId: "food", amount: 999, date: new Date(2026, 7, 30) }, // last month
        { type: "EXPENSE", categoryId: "transport", amount: 999, date: new Date(2026, 8, 10) }, // other category
        { type: "INCOME", categoryId: "food", amount: 999, date: new Date(2026, 8, 10) }, // not a spend
        { type: "TRANSFER", categoryId: "food", amount: 999, date: new Date(2026, 8, 10) }, // not a spend
      ],
      NOW
    );

    expect(progress.spent).toBe(500);
    expect(progress.pct).toBe(50);
    expect(progress.isNear).toBe(false);
  });

  it("flags isNear at and above the 80% threshold, not below it", () => {
    const below = computeBudgetProgress([{ categoryId: "food", monthlyCap: 1000 }], [{ type: "EXPENSE", categoryId: "food", amount: 799, date: NOW }], NOW)[0];
    const at = computeBudgetProgress([{ categoryId: "food", monthlyCap: 1000 }], [{ type: "EXPENSE", categoryId: "food", amount: 800, date: NOW }], NOW)[0];

    expect(below.isNear).toBe(false);
    expect(at.isNear).toBe(true);
  });

  it("leaves pct uncapped past 100 so callers can distinguish over-cap from at-cap", () => {
    const [progress] = computeBudgetProgress([{ categoryId: "food", monthlyCap: 1000 }], [{ type: "EXPENSE", categoryId: "food", amount: 1500, date: NOW }], NOW);

    expect(progress.pct).toBe(150);
    expect(progress.isNear).toBe(true);
  });

  it("reports zero spend, not a crash, for a cap with no matching transactions", () => {
    const [progress] = computeBudgetProgress([{ categoryId: "food", monthlyCap: 1000 }], [], NOW);

    expect(progress.spent).toBe(0);
    expect(progress.pct).toBe(0);
    expect(progress.isNear).toBe(false);
  });

  it("returns one entry per budget, in the same order", () => {
    const progress = computeBudgetProgress(
      [
        { categoryId: "food", monthlyCap: 1000 },
        { categoryId: "transport", monthlyCap: 500 },
      ],
      [{ type: "EXPENSE", categoryId: "transport", amount: 100, date: NOW }],
      NOW
    );

    expect(progress.map((p) => p.categoryId)).toEqual(["food", "transport"]);
    expect(progress[1].spent).toBe(100);
  });
});
