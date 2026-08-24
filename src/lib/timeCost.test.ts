import { describe, it, expect } from "vitest";
import { computeTimeCost, computeRealCost, computeVirtualAssetValue } from "./timeCost";

describe("computeTimeCost", () => {
  it("multiplies duration in hours by hourly value", () => {
    expect(computeTimeCost(120, 350_000)).toBe(700_000);
  });

  it("handles fractional hours", () => {
    expect(computeTimeCost(90, 350_000)).toBe(525_000);
  });
});

describe("computeRealCost", () => {
  it("sums direct cost and time cost from the spec example", () => {
    // Direct cost 5,000,000 + 3h at 350,000/h = 1,050,000 time cost => 6,050,000 real cost
    const result = computeRealCost(180, 5_000_000, 350_000);
    expect(result.directCost).toBe(5_000_000);
    expect(result.timeCost).toBe(1_050_000);
    expect(result.realCost).toBe(6_050_000);
  });

  it("works with zero direct cost (pure time cost)", () => {
    const result = computeRealCost(60, 0, 200_000);
    expect(result.realCost).toBe(200_000);
  });
});

describe("computeVirtualAssetValue", () => {
  it("computes 20 hours of study at 350,000/h as 7,000,000", () => {
    expect(computeVirtualAssetValue(20 * 60, 350_000)).toBe(7_000_000);
  });
});
