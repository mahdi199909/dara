import { describe, it, expect } from "vitest";
import { computeHourlyValue } from "./hourlyValue";

describe("computeHourlyValue", () => {
  it("derives hourly value from monthly income and working hours", () => {
    expect(computeHourlyValue({ monthlyIncome: 50_000_000, workingHoursMonth: 176 })).toBe(284091);
  });

  it("prefers the manual override when set", () => {
    expect(
      computeHourlyValue({ monthlyIncome: 50_000_000, workingHoursMonth: 176, hourlyValueOverride: 350_000 })
    ).toBe(350_000);
  });

  it("returns 0 when there is not enough information", () => {
    expect(computeHourlyValue({})).toBe(0);
    expect(computeHourlyValue({ monthlyIncome: 1_000_000 })).toBe(0);
    expect(computeHourlyValue({ workingHoursMonth: 100 })).toBe(0);
  });

  it("ignores a zero or negative override", () => {
    expect(
      computeHourlyValue({ monthlyIncome: 50_000_000, workingHoursMonth: 176, hourlyValueOverride: 0 })
    ).toBe(284091);
  });
});
