import { describe, expect, it } from "vitest";
import { coerceSyncRow } from "./syncCoercion";

const T = "2026-01-01T00:00:00.000Z";

describe("coerceSyncRow — what a phone's SQLite rows look like to Prisma", () => {
  it("turns SQLite's 0/1 into real booleans (the reason categories, habits, events... never synced)", () => {
    const { data, error } = coerceSyncRow("category", { id: "c1", name: "کار", isActive: 1, generatesVirtualAsset: 0, createdAt: T, updatedAt: T });
    expect(error).toBeUndefined();
    expect(data.isActive).toBe(true);
    expect(data.generatesVirtualAsset).toBe(false);
  });

  it("accepts real booleans and their string spellings unchanged", () => {
    const { data } = coerceSyncRow("habit", { id: "h", title: "t", isActive: "true", isTrial: false, createdAt: T, updatedAt: T });
    expect(data.isActive).toBe(true);
    expect(data.isTrial).toBe(false);
  });

  it("normalizes SQLite's space-separated timestamps to ISO", () => {
    const { data, error } = coerceSyncRow("category", { id: "c", name: "x", createdAt: "2026-03-04 05:06:07", updatedAt: "2026-03-04 05:06:07" });
    expect(error).toBeUndefined();
    expect(data.createdAt).toBe("2026-03-04T05:06:07.000Z");
  });

  it("rejects a value that can't be represented, naming the field", () => {
    expect(coerceSyncRow("category", { id: "c", name: "x", isActive: "maybe", createdAt: T, updatedAt: T }).error).toMatch(/isActive.*boolean/);
    expect(coerceSyncRow("category", { id: "c", name: "x", createdAt: "not a date", updatedAt: T }).error).toMatch(/createdAt.*date/);
    expect(coerceSyncRow("category", { id: "c", name: "x", sortOrder: 1.5, createdAt: T, updatedAt: T }).error).toMatch(/sortOrder.*integer/);
  });

  it("says plainly when an amount is larger than the server's 32-bit integer column allows", () => {
    const { error } = coerceSyncRow("asset", { id: "a", name: "خانه", purchasePrice: 5_000_000_000, purchaseDate: T, currentValue: 1, createdAt: T, updatedAt: T });
    expect(error).toMatch(/purchasePrice.*larger than the server allows/);
  });

  it("drops columns the server model doesn't have instead of failing the whole row", () => {
    const { data, dropped, error } = coerceSyncRow("category", { id: "c", name: "x", someFutureColumn: 1, createdAt: T, updatedAt: T });
    expect(error).toBeUndefined();
    expect(dropped).toEqual(["someFutureColumn"]);
    expect("someFutureColumn" in data).toBe(false);
  });

  it("leaves optional nulls alone but refuses a missing required value", () => {
    expect(coerceSyncRow("category", { id: "c", name: "x", icon: null, createdAt: T, updatedAt: T }).data.icon).toBeNull();
    expect(coerceSyncRow("category", { id: "c", name: null, createdAt: T, updatedAt: T }).error).toMatch(/name.*required/);
  });
});
