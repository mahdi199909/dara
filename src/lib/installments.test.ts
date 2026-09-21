import { describe, it, expect } from "vitest";
import jalaali from "jalaali-js";
import {
  generateInstallmentSchedule,
  planInstallments,
  recomputeInstallmentDueDate,
  redateInstallments,
  resolveInstallmentTiming,
  dueDateDay,
  summarizeInstallments,
  computeLoanInterest,
  computeCompoundAnnualRate,
  computeEffectiveAnnualRate,
} from "./installments";
import { fromJalali, toJalali } from "./jalali";

const jal = (date: Date) => {
  const { jy, jm, jd } = toJalali(date);
  return [jy, jm, jd];
};

describe("generateInstallmentSchedule (Jalali calendar)", () => {
  it("falls due on the chosen day of every following Jalali month", () => {
    const schedule = generateInstallmentSchedule({
      startDate: fromJalali(1405, 7, 10), // Mehr 10
      dueDay: 2,
      numberOfInstallments: 5,
      installmentAmount: 10_000_000,
    });

    expect(schedule).toHaveLength(5);
    // "the 2nd" is the 2nd of Aban, Azar, Dey, Bahman, Esfand — not the 2nd of Gregorian months,
    // which read back as unrelated Jalali days.
    expect(schedule.map((s) => jal(s.dueDate))).toEqual([
      [1405, 8, 2],
      [1405, 9, 2],
      [1405, 10, 2],
      [1405, 11, 2],
      [1405, 12, 2],
    ]);
    expect(schedule.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    expect(schedule[0].amount).toBe(10_000_000);
  });

  it("rolls over the Jalali year", () => {
    const schedule = generateInstallmentSchedule({ startDate: fromJalali(1405, 11, 20), dueDay: 2, numberOfInstallments: 4, installmentAmount: 1 });
    expect(schedule.map((s) => jal(s.dueDate))).toEqual([
      [1405, 12, 2],
      [1406, 1, 2],
      [1406, 2, 2],
      [1406, 3, 2],
    ]);
  });

  it("keeps a 30-installment plan on the same Jalali day for its whole length", () => {
    const schedule = generateInstallmentSchedule({ startDate: fromJalali(1405, 1, 1), dueDay: 15, numberOfInstallments: 30, installmentAmount: 1 });
    expect(schedule).toHaveLength(30);
    expect(jal(schedule[0].dueDate)).toEqual([1405, 2, 15]);
    expect(schedule.every((s) => toJalali(s.dueDate).jd === 15)).toBe(true);
    expect(jal(schedule[29].dueDate)).toEqual([1407, 7, 15]);
  });

  it("clamps day 31 to the real length of each Jalali month (31 / 30 / 29 or 30 days)", () => {
    const schedule = generateInstallmentSchedule({ startDate: fromJalali(1405, 1, 1), dueDay: 31, numberOfInstallments: 12, installmentAmount: 1 });
    for (const s of schedule) {
      const { jy, jm, jd } = toJalali(s.dueDate);
      expect(jd).toBe(jalaali.jalaaliMonthLength(jy, jm));
    }
    // Ordibehesht (31 days) keeps 31, Mehr (30 days) gets 30, Esfand of a non-leap year gets 29.
    expect(jal(schedule[0].dueDate)).toEqual([1405, 2, 31]);
    expect(jal(schedule[5].dueDate)).toEqual([1405, 7, 30]);
    expect(jal(schedule[10].dueDate)).toEqual([1405, 12, 29]);
  });

  it("starts on the picked first date and keeps its Jalali day, whatever dueDay says", () => {
    const first = fromJalali(1405, 7, 25);
    const schedule = generateInstallmentSchedule({ startDate: new Date(), dueDay: 3, firstDueDate: first, numberOfInstallments: 3, installmentAmount: 1 });
    expect(schedule.map((s) => jal(s.dueDate))).toEqual([
      [1405, 7, 25],
      [1405, 8, 25],
      [1405, 9, 25],
    ]);
  });

  it("clamps a picked day that a later month does not have", () => {
    const schedule = generateInstallmentSchedule({
      startDate: new Date(),
      firstDueDate: fromJalali(1405, 11, 30), // Bahman 30
      numberOfInstallments: 2,
      installmentAmount: 1,
    });
    expect(jal(schedule[0].dueDate)).toEqual([1405, 11, 30]);
    expect(jal(schedule[1].dueDate)).toEqual([1405, 12, jalaali.jalaaliMonthLength(1405, 12)]);
  });

  it("without a day or a first date, uses the start date's own Jalali day in the next month", () => {
    const timing = resolveInstallmentTiming({ startDate: fromJalali(1405, 7, 12) });
    expect(timing).toEqual({ firstMonth: { jy: 1405, jm: 8 }, dueDay: 12 });
  });
});

describe("recomputeInstallmentDueDate", () => {
  it("counts months from the first installment's Jalali month", () => {
    const first = fromJalali(1405, 7, 25);
    expect(jal(recomputeInstallmentDueDate(first, 2, 1))).toEqual([1405, 7, 2]);
    expect(jal(recomputeInstallmentDueDate(first, 2, 3))).toEqual([1405, 9, 2]);
    expect(jal(recomputeInstallmentDueDate(first, 31, 6))).toEqual([1405, 12, 29]);
  });
});

describe("planInstallments", () => {
  it("takes the start date and day from a picked first installment date", () => {
    const planned = planInstallments({ firstDueDate: "2026-10-05", numberOfInstallments: 3, installmentAmount: 100 });
    // 2026-10-05 is Mehr 13, 1405
    expect(jal(planned.startDate)).toEqual([1405, 7, 13]);
    expect(planned.dueDay).toBe(13);
    expect(planned.schedule.map((s) => jal(s.dueDate))).toEqual([
      [1405, 7, 13],
      [1405, 8, 13],
      [1405, 9, 13],
    ]);
  });

  it("still accepts only a day of the month (the first installment then falls next month)", () => {
    const planned = planInstallments({ startDate: fromJalali(1405, 7, 10).toISOString(), dueDay: 2, numberOfInstallments: 2, installmentAmount: 100 });
    expect(planned.dueDay).toBe(2);
    expect(planned.schedule.map((s) => jal(s.dueDate))).toEqual([
      [1405, 8, 2],
      [1405, 9, 2],
    ]);
  });
});

describe("redateInstallments", () => {
  const installments = (statuses: string[], first = fromJalali(1405, 7, 25)) =>
    statuses.map((status, i) => ({
      id: `i${i + 1}`,
      index: i + 1,
      status,
      dueDate: recomputeInstallmentDueDate(first, 25, i + 1),
    }));

  it("re-dates only the unpaid installments when the day changes", () => {
    const result = redateInstallments({ installments: installments(["PAID", "PENDING", "PENDING"]), dueDay: 2 })!;
    expect(result.dueDay).toBe(2);
    expect(result.changes.map((c) => c.id)).toEqual(["i2", "i3"]);
    expect(result.changes.map((c) => jal(c.dueDate))).toEqual([
      [1405, 8, 2],
      [1405, 9, 2],
    ]);
  });

  it("anchors on the first installment's month even when that one is already paid", () => {
    const result = redateInstallments({ installments: installments(["PAID", "PAID", "PENDING"]), dueDay: 3 })!;
    expect(result.changes).toHaveLength(1);
    expect(jal(result.changes[0].dueDate)).toEqual([1405, 9, 3]);
  });

  it("moves the whole schedule when a new first date is picked", () => {
    const result = redateInstallments({ installments: installments(["PENDING", "PENDING", "PENDING"]), firstDueDate: "2026-11-21" })!;
    // 2026-11-21 is Aban 30, 1405 — installments follow in Azar 30, Dey 30
    expect(result.dueDay).toBe(30);
    expect(result.changes.map((c) => jal(c.dueDate))).toEqual([
      [1405, 8, 30],
      [1405, 9, 30],
      [1405, 10, 30],
    ]);
  });

  it("lists nothing when the dates would not move, and returns null when the edit is not about dates", () => {
    expect(redateInstallments({ installments: installments(["PENDING", "PENDING"]), dueDay: 25 })!.changes).toEqual([]);
    expect(redateInstallments({ installments: installments(["PENDING"]) })).toBeNull();
    expect(redateInstallments({ installments: [], dueDay: 5 })).toBeNull();
  });

  it("reads a due date made in another time zone as the day it was made for", () => {
    // A phone in Tehran stores the local midnight of Mehr 1, 1405 (2026-09-23) as 20:30 UTC the evening before;
    // a server in UTC must still see Mehr — not Shahrivar — as the plan's first month.
    const madeInTehran = (gy: number, gm: number, gd: number) => new Date(Date.UTC(gy, gm - 1, gd - 1, 20, 30));
    const phonePlan = [
      { id: "a", index: 1, status: "PENDING", dueDate: madeInTehran(2026, 9, 23) }, // 1405/07/01
      { id: "b", index: 2, status: "PENDING", dueDate: madeInTehran(2026, 10, 23) }, // 1405/08/01
    ];
    expect(dueDateDay(phonePlan[0].dueDate)).toEqual({ jy: 1405, jm: 7, jd: 1 });
    const result = redateInstallments({ installments: phonePlan, dueDay: 5 })!;
    expect(result.changes.map((c) => dueDateDay(c.dueDate))).toEqual([
      { jy: 1405, jm: 7, jd: 5 },
      { jy: 1405, jm: 8, jd: 5 },
    ]);
    // and an edit that keeps the day changes nothing, whatever zone made the dates
    expect(redateInstallments({ installments: phonePlan, dueDay: 1 })!.changes).toEqual([]);
  });

  it("brings a plan created on the old Gregorian rule onto Jalali days", () => {
    // Old rule: the 2nd of Gregorian months — 2026-10-02 and 2026-11-02 read back as Mehr 10 and Aban 11.
    const legacy = [
      { id: "a", index: 1, status: "PENDING", dueDate: new Date(2026, 9, 2) },
      { id: "b", index: 2, status: "PENDING", dueDate: new Date(2026, 10, 2) },
    ];
    const result = redateInstallments({ installments: legacy, dueDay: 2 })!;
    expect(result.changes.map((c) => jal(c.dueDate))).toEqual([
      [1405, 7, 2],
      [1405, 8, 2],
    ]);
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

describe("computeCompoundAnnualRate", () => {
  it("equals the whole-term interest when the plan lasts exactly one year", () => {
    // 100 -> 12 x 10 = 120 payable: 20% over 12 months, so 20% a year — simple and compound agree after one period
    const result = computeCompoundAnnualRate({ totalAmount: 100, installmentAmount: 10, numberOfInstallments: 12 });
    expect(result.annualRatePercent).toBeCloseTo(20, 9);
    expect(computeLoanInterest({ totalAmount: 100, installmentAmount: 10, numberOfInstallments: 12 }).interestPercent).toBeCloseTo(20, 9);
  });

  it("is also equal at one year for a 12-installment plan of 12M paid back as 12 x 1.1M", () => {
    const result = computeCompoundAnnualRate({ totalAmount: 12_000_000, installmentAmount: 1_100_000, numberOfInstallments: 12 });
    expect(result.annualRatePercent).toBeCloseTo(10, 9);
  });

  it("compounds a shorter plan up to a year: 10% in 6 months is 21% a year", () => {
    // 100 -> 6 x 18.333.. would be arbitrary; use 6 x 110/6 = 110 payable
    const result = computeCompoundAnnualRate({ totalAmount: 100, installmentAmount: 110 / 6, numberOfInstallments: 6 });
    expect(result.annualRatePercent).toBeCloseTo(21, 9);
  });

  it("scales a longer plan down to a year: 21% over 24 months is 10% a year", () => {
    const result = computeCompoundAnnualRate({ totalAmount: 100, installmentAmount: 121 / 24, numberOfInstallments: 24 });
    expect(result.annualRatePercent).toBeCloseTo(10, 9);
  });

  it("is zero when there is no interest and for degenerate inputs", () => {
    expect(computeCompoundAnnualRate({ totalAmount: 300, installmentAmount: 10, numberOfInstallments: 30 }).annualRate).toBe(0);
    expect(computeCompoundAnnualRate({ totalAmount: 0, installmentAmount: 10, numberOfInstallments: 12 }).annualRate).toBe(0);
    expect(computeCompoundAnnualRate({ totalAmount: 100, installmentAmount: 10, numberOfInstallments: 0 }).annualRate).toBe(0);
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
