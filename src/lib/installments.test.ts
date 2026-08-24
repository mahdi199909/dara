import { describe, it, expect } from "vitest";
import { generateInstallmentSchedule, summarizeInstallments, computeLoanInterest } from "./installments";

describe("generateInstallmentSchedule", () => {
  it("generates the requested number of monthly installments on the due day", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(2026, 0, 1),
      dueDay: 15,
      numberOfInstallments: 30,
      installmentAmount: 10_000_000,
    });

    expect(schedule).toHaveLength(30);
    expect(schedule[0].dueDate.getMonth()).toBe(1); // February (0-indexed) — first installment is next month
    expect(schedule[0].dueDate.getDate()).toBe(15);
    expect(schedule[0].amount).toBe(10_000_000);
    expect(schedule[29].index).toBe(30);
  });

  it("clamps an out-of-range due day to 28", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(2026, 0, 1),
      dueDay: 31,
      numberOfInstallments: 1,
      installmentAmount: 1000,
    });
    expect(schedule[0].dueDate.getDate()).toBe(28);
  });
});

describe("summarizeInstallments", () => {
  it("matches the spec example: 30M total, 20M paid, 10M remaining", () => {
    const installments = [
      { amount: 10_000_000, status: "PAID" as const, dueDate: new Date(2026, 0, 15) },
      { amount: 10_000_000, status: "PAID" as const, dueDate: new Date(2026, 1, 15) },
      { amount: 10_000_000, status: "PENDING" as const, dueDate: new Date(2026, 2, 15) },
    ];
    const summary = summarizeInstallments(installments);
    expect(summary.totalAmount).toBe(30_000_000);
    expect(summary.paidAmount).toBe(20_000_000);
    expect(summary.remainingAmount).toBe(10_000_000);
    expect(summary.nextDueDate).toEqual(new Date(2026, 2, 15));
  });
});

describe("computeLoanInterest", () => {
  it("computes real interest as the gap between total payable and principal", () => {
    // 300,000,000 principal, 30 installments of 10,000,000 = 300,000,000 payable -> 0 interest
    const noInterest = computeLoanInterest({ totalAmount: 300_000_000, installmentAmount: 10_000_000, numberOfInstallments: 30 });
    expect(noInterest.totalPayable).toBe(300_000_000);
    expect(noInterest.interest).toBe(0);
    expect(noInterest.interestPercent).toBe(0);
  });

  it("matches a worked example with real interest", () => {
    // 12,000,000 principal, 12 installments of 1,100,000 = 13,200,000 payable -> 1,200,000 interest (10%)
    const result = computeLoanInterest({ totalAmount: 12_000_000, installmentAmount: 1_100_000, numberOfInstallments: 12 });
    expect(result.totalPayable).toBe(13_200_000);
    expect(result.interest).toBe(1_200_000);
    expect(result.interestPercent).toBeCloseTo(10, 5);
  });
});
