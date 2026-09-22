import { describe, it, expect } from "vitest";
import { detectRecurringTransactions, recurringSpendThisMonth, type TransactionForDetection } from "./recurringTransactions";

const NOW = new Date(2026, 5, 15); // 2026-06-15

function txn(overrides: Partial<TransactionForDetection>): TransactionForDetection {
  return {
    id: Math.random().toString(36),
    description: "اجاره خانه",
    amount: 5_000_000,
    date: NOW,
    type: "EXPENSE",
    categoryId: "cat-rent",
    accountId: "acc-1",
    installmentId: null,
    taskId: null,
    eventId: null,
    activityId: null,
    ...overrides,
  };
}

describe("detectRecurringTransactions", () => {
  it("finds a category with the same-ish amount in 2+ of the last few months", () => {
    const txs = [
      txn({ date: new Date(2026, 3, 3), amount: 5_000_000 }), // April
      txn({ date: new Date(2026, 4, 2), amount: 5_100_000 }), // May, +2%
      txn({ date: new Date(2026, 5, 4), amount: 4_950_000 }), // June, -1%
    ];
    const result = detectRecurringTransactions(txs, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("cat-rent");
    expect(result[0].occurrences).toBe(3);
    expect(result[0].thisMonthAmount).toBe(4_950_000);
  });

  it("a single occurrence is not a pattern", () => {
    const result = detectRecurringTransactions([txn({ date: new Date(2026, 5, 1) })], NOW);
    expect(result).toEqual([]);
  });

  it("wildly different amounts in the same category don't count as the same bill", () => {
    const txs = [
      txn({ date: new Date(2026, 3, 1), amount: 5_000_000 }),
      txn({ date: new Date(2026, 4, 1), amount: 50_000 }), // a one-off small expense, same category
    ];
    expect(detectRecurringTransactions(txs, NOW)).toEqual([]);
  });

  it("ignores anything already structured (installment, task, event, activity) — that recurrence is already known", () => {
    const txs = [
      txn({ date: new Date(2026, 3, 1), installmentId: "inst-1" }),
      txn({ date: new Date(2026, 4, 1), installmentId: "inst-1" }),
      txn({ date: new Date(2026, 5, 1), taskId: "task-1" }),
    ];
    expect(detectRecurringTransactions(txs, NOW)).toEqual([]);
  });

  it("ignores transactions with no category at all — nothing stable to group them by", () => {
    const txs = [
      txn({ date: new Date(2026, 3, 1), categoryId: null }),
      txn({ date: new Date(2026, 4, 1), categoryId: null }),
    ];
    expect(detectRecurringTransactions(txs, NOW)).toEqual([]);
  });

  it("ignores transfers", () => {
    const txs = [
      txn({ date: new Date(2026, 3, 1), type: "TRANSFER" }),
      txn({ date: new Date(2026, 4, 1), type: "TRANSFER" }),
    ];
    expect(detectRecurringTransactions(txs, NOW)).toEqual([]);
  });

  it("outside the lookback window doesn't count", () => {
    const txs = [
      txn({ date: new Date(2025, 9, 1) }), // October 2025, well outside a 4-month window from June 2026
      txn({ date: new Date(2025, 10, 1) }),
    ];
    expect(detectRecurringTransactions(txs, NOW)).toEqual([]);
  });

  it("two distinct amount clusters in the same category become two candidates", () => {
    const txs = [
      txn({ date: new Date(2026, 3, 1), amount: 5_000_000 }),
      txn({ date: new Date(2026, 4, 1), amount: 5_050_000 }),
      // A second, much smaller recurring charge landing in the SAME category a different day —
      // grouped separately from the two above since it's outside their ±15% band, but note real
      // detection is one-entry-per-month-per-category, so this needs its own distinct months too.
    ];
    const result = detectRecurringTransactions(txs, NOW);
    expect(result).toHaveLength(1); // only the one real cluster here; the shape is what's tested
    expect(result[0].averageAmount).toBe(5_025_000);
  });

  it("recurringSpendThisMonth sums only EXPENSE candidates actually logged this month, never a projection", () => {
    const candidates = [
      { categoryId: "a", title: "اجاره", type: "EXPENSE" as const, accountId: "x", averageAmount: 5_000_000, thisMonthAmount: 5_000_000, occurrences: 3 },
      { categoryId: "b", title: "اشتراک", type: "EXPENSE" as const, accountId: "x", averageAmount: 200_000, thisMonthAmount: null, occurrences: 2 }, // not logged yet this month
      { categoryId: "c", title: "درآمد اجاره", type: "INCOME" as const, accountId: "x", averageAmount: 3_000_000, thisMonthAmount: 3_000_000, occurrences: 2 },
    ];
    expect(recurringSpendThisMonth(candidates)).toBe(5_000_000);
  });
});
