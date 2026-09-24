import { describe, it, expect } from "vitest";
import { batteryBrandOf } from "./phoneBrand";

describe("batteryBrandOf", () => {
  it("knows the Xiaomi family under any of its names", () => {
    for (const maker of ["xiaomi", "Xiaomi", "redmi", "poco"]) {
      expect(batteryBrandOf(maker)?.name).toBe("شیائومی");
    }
    expect(batteryBrandOf("xiaomi")?.hasAutostartScreen).toBe(true);
  });

  it("gives Samsung advice but no autostart screen (it has none)", () => {
    const samsung = batteryBrandOf("samsung");
    expect(samsung?.name).toBe("سامسونگ");
    expect(samsung?.hasAutostartScreen).toBe(false);
  });

  it("groups the brands that share one battery manager", () => {
    expect(batteryBrandOf("huawei")?.name).toBe(batteryBrandOf("honor")?.name);
    expect(batteryBrandOf("oppo")?.name).toBe(batteryBrandOf("realme")?.name);
    expect(batteryBrandOf("vivo")?.name).toBe(batteryBrandOf("iqoo")?.name);
  });

  it("says nothing for a stock-Android brand or an unknown one", () => {
    expect(batteryBrandOf("google")).toBeNull();
    expect(batteryBrandOf("motorola")).toBeNull();
    expect(batteryBrandOf("")).toBeNull();
    expect(batteryBrandOf(null)).toBeNull();
  });
});
