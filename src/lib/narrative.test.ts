import { describe, expect, it } from "vitest";
import { generateNarrative } from "./narrative";
import type { TimeAndMoneyReport, HiddenCostReport } from "./reportEngine";

function baseReport(overrides: Partial<TimeAndMoneyReport> = {}): TimeAndMoneyReport {
  return {
    from: new Date("2026-01-01"),
    to: new Date("2026-01-31"),
    hourlyValue: 100_000,
    totalDurationMin: 0,
    productiveMin: 0,
    neutralMin: 0,
    wasteMin: 0,
    productiveRatio: 0,
    timeByCategory: [],
    timeByProject: [],
    income: 0,
    expense: 0,
    net: 0,
    expenseByCategory: [],
    timeCost: 0,
    opportunityCost: 0,
    realCost: 0,
    virtualAssetValue: 0,
    tasksCompleted: 0,
    eventsCount: 0,
    ...overrides,
  };
}

function emptyHiddenCost(overrides: Partial<HiddenCostReport> = {}): HiddenCostReport {
  return { items: [], totalDirectCost: 0, totalTimeCost: 0, totalHiddenCost: 0, ...overrides };
}

describe("generateNarrative", () => {
  it("returns an empty string when there's nothing real to report in any act", () => {
    const result = generateNarrative(baseReport(), emptyHiddenCost(), 0);
    expect(result).toBe("");
  });

  it("renders only Act 1 (چه خرج کردی) when there's time but no hidden cost and no productive category", () => {
    const report = baseReport({
      timeByCategory: [{ categoryId: "c1", name: "شبکه‌های اجتماعی", color: "#000", kind: "WASTE", minutes: 60 }],
    });
    const result = generateNarrative(report, emptyHiddenCost(), 0);
    expect(result).toContain("«شبکه‌های اجتماعی»");
    expect(result).toContain("پرداخت کردی");
    expect(result).not.toContain("پنهان");
  });

  it("renders all three acts in fixed order: spend, then hidden, then build", () => {
    const report = baseReport({
      timeByCategory: [
        { categoryId: "c1", name: "شبکه‌های اجتماعی", color: "#000", kind: "WASTE", minutes: 120 },
        { categoryId: "c2", name: "برنامه‌نویسی", color: "#000", kind: "PRODUCTIVE", minutes: 60 },
      ],
    });
    const hiddenCost = emptyHiddenCost({
      items: [{ entityType: "EVENT", id: "e1", title: "این جلسه", categoryName: null, directCost: 0, durationMin: 60, timeCost: 240_000, hiddenCost: 240_000, date: new Date() }],
    });
    const result = generateNarrative(report, hiddenCost, 2820); // 47h lifetime for برنامه‌نویسی

    const spendIdx = result.indexOf("شبکه‌های اجتماعی");
    const hiddenIdx = result.indexOf("این جلسه");
    const buildIdx = result.indexOf("برنامه‌نویسی");
    expect(spendIdx).toBeGreaterThanOrEqual(0);
    expect(hiddenIdx).toBeGreaterThan(spendIdx);
    expect(buildIdx).toBeGreaterThan(hiddenIdx);
    expect(result).toContain("۴۷ ساعت"); // the lifetime total, not this period's 1 hour
  });

  it("omits Act 2 when the period has no hidden cost", () => {
    const report = baseReport({ timeByCategory: [{ categoryId: "c1", name: "کار", color: "#000", kind: "PRODUCTIVE", minutes: 60 }] });
    const result = generateNarrative(report, emptyHiddenCost(), 60);
    expect(result).not.toContain("صفر ثبت شده بود");
  });

  it("omits Act 3 when no category in the period is PRODUCTIVE", () => {
    const report = baseReport({ timeByCategory: [{ categoryId: "c1", name: "تفریح", color: "#000", kind: "NEUTRAL", minutes: 60 }] });
    const result = generateNarrative(report, emptyHiddenCost(), 999);
    expect(result).not.toContain("پنهان");
    expect(result).not.toContain("۹۹۹");
  });
});
