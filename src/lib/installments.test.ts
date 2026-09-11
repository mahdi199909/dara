import { describe, it, expect } from "vitest";
import { generateInstallmentSchedule, summarizeInstallments, computeLoanInterest, computeEffectiveAnnualRate } from "./installments";

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

  it("keeps day 31 as-is in a 31-day month", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(2026, 0, 1), // installments land Feb (i=0) then March 2026 (i=1, 31 days)
      dueDay: 31,
      numberOfInstallments: 2,
      installmentAmount: 1000,
    });
    expect(schedule[1].dueDate.getMonth()).toBe(2); // March
    expect(schedule[1].dueDate.getDate()).toBe(31);
  });

  it("clamps day 31 to 30 in a 30-day month", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(2026, 4, 1), // first installment lands in June 2026 (30 days)
      dueDay: 31,
      numberOfInstallments: 1,
      installmentAmount: 1000,
    });
    expect(schedule[0].dueDate.getMonth()).toBe(5); // June
    expect(schedule[0].dueDate.getDate()).toBe(30);
  });

  it("clamps day 31 to 28 in February of a non-leap year", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(2026, 0, 1), // 2026 is not a leap year
      dueDay: 31,
      numberOfInstallments: 1,
      installmentAmount: 1000,
    });
    expect(schedule[0].dueDate.getMonth()).toBe(1); // February
    expect(schedule[0].dueDate.getDate()).toBe(28);
  });

  it("clamps day 31 to 29 in February of a leap year", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(2027, 11, 1), // first installment lands in Jan 2028; 2028 is a leap year
      dueDay: 31,
      numberOfInstallments: 2,
      installmentAmount: 1000,
    });
    expect(schedule[1].dueDate.getMonth()).toBe(1); // February 2028
    expect(schedule[1].dueDate.getDate()).toBe(29);
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

describe("computeEffectiveAnnualRate", () => {
  it("returns zero when there's no real interest (installmentAmount × n equals principal)", () => {
    const result = computeEffectiveAnnualRate({ totalAmount: 300_000_000, installmentAmount: 10_000_000, numberOfInstallments: 30 });
    expect(result.monthlyRate).toBe(0);
    expect(result.effectiveAnnualRate).toBe(0);
  });

  it("recovers a known monthly rate from its own amortization formula (round-trip)", () => {
    const principal = 10_000_000;
    const n = 12;
    const knownMonthlyRate = 0.02; // 2%/month, chosen arbitrarily
    const installmentAmount = (principal * knownMonthlyRate) / (1 - Math.pow(1 + knownMonthlyRate, -n));

    const result = computeEffectiveAnnualRate({ totalAmount: principal, installmentAmount, numberOfInstallments: n });
    expect(result.monthlyRate).toBeCloseTo(knownMonthlyRate, 6);
    expect(result.effectiveAnnualRate).toBeCloseTo(Math.pow(1 + knownMonthlyRate, 12) - 1, 6);
  });

  it("gives a higher effective annual rate than the flat total-interest percentage (compounding effect)", () => {
    // Same 12,000,000 / 1,100,000 / 12 plan as the computeLoanInterest example above (10% flat)
    const result = computeEffectiveAnnualRate({ totalAmount: 12_000_000, installmentAmount: 1_100_000, numberOfInstallments: 12 });
    expect(result.monthlyRate).toBeGreaterThan(0);
    expect(result.effectiveAnnualRatePercent).toBeGreaterThan(10);
  });

  it("returns zero for degenerate or non-positive inputs", () => {
    expect(computeEffectiveAnnualRate({ totalAmount: 0, installmentAmount: 100, numberOfInstallments: 12 }).monthlyRate).toBe(0);
    expect(computeEffectiveAnnualRate({ totalAmount: 100, installmentAmount: 0, numberOfInstallments: 12 }).monthlyRate).toBe(0);
    expect(computeEffectiveAnnualRate({ totalAmount: 100, installmentAmount: 100, numberOfInstallments: 0 }).monthlyRate).toBe(0);
  });
});
