import { describe, expect, it } from "vitest";
import { BASKET_ASSETS, basketAssetById } from "./basketCatalog";
import { computeBasket, describeAge, formatQuantity, parseQuantityInput, rangeStartKey, snapshotPoints, usablePrice, type BasketHoldingRow, type BasketSnapshotRow } from "./basket";
import { jalaliDateKey } from "./jalali";

const holding = (id: string, assetKey: string, quantity: number, createdAt = "2026-10-01T00:00:00.000Z"): BasketHoldingRow => ({ id, assetKey, quantity, createdAt });

describe("catalog", () => {
  it("has unique ids and every asset is findable", () => {
    const ids = BASKET_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const asset of BASKET_ASSETS) expect(basketAssetById(asset.id)).toBe(asset);
    expect(basketAssetById("bitcoin")).toBeUndefined();
  });
});

describe("computeBasket", () => {
  const prices = { usd: 271_500, gold18: 25_579_200, coin_emami: 261_420_000 };

  it("values each holding as quantity × price and sums the total", () => {
    const summary = computeBasket([holding("a", "usd", 1500), holding("b", "gold18", 12.5), holding("c", "coin_emami", 2)], prices);
    expect(summary.lines.map((l) => [l.asset.id, l.value])).toEqual([
      ["usd", 407_250_000],
      ["gold18", 319_740_000],
      ["coin_emami", 522_840_000],
    ]);
    expect(summary.total).toBe(407_250_000 + 319_740_000 + 522_840_000);
    expect(summary.complete).toBe(true);
    expect(summary.unpricedCount).toBe(0);
  });

  it("keeps the catalog's order, whatever order the rows come in", () => {
    const summary = computeBasket([holding("c", "coin_emami", 1), holding("a", "usd", 1)], prices);
    expect(summary.lines.map((l) => l.asset.id)).toEqual(["usd", "coin_emami"]);
  });

  it("leaves an unpriced holding out of the total and says the basket is not complete", () => {
    const summary = computeBasket([holding("a", "usd", 100), holding("b", "eur", 50)], prices);
    expect(summary.lines.find((l) => l.asset.id === "eur")).toMatchObject({ price: null, value: null });
    expect(summary.total).toBe(27_150_000);
    expect(summary.pricedCount).toBe(1);
    expect(summary.unpricedCount).toBe(1);
    expect(summary.complete).toBe(false);
  });

  it("is not complete when empty, and ignores unknown assets and unusable quantities", () => {
    expect(computeBasket([], prices)).toMatchObject({ total: 0, complete: false, lines: [] });
    const summary = computeBasket([holding("x", "bitcoin", 1), holding("y", "usd", 0), holding("z", "usd", -3), holding("n", "usd", Number.NaN)], prices);
    expect(summary.lines).toEqual([]);
    expect(summary.complete).toBe(false);
  });

  it("sums duplicate rows of one asset, oldest first, so two devices adding the same asset do not lose any", () => {
    const summary = computeBasket(
      [holding("late", "usd", 30, "2026-10-05T00:00:00.000Z"), holding("early", "usd", 70, "2026-10-01T00:00:00.000Z")],
      prices
    );
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]).toMatchObject({ quantity: 100, holdingIds: ["early", "late"], value: 27_150_000 });
  });

  it("rounds a line to whole Toman", () => {
    const summary = computeBasket([holding("a", "gold18", 0.333)], { gold18: 25_579_200 });
    expect(summary.lines[0].value).toBe(Math.round(0.333 * 25_579_200));
  });

  it("does not trust a missing, zero, negative or non-finite price", () => {
    for (const bad of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(usablePrice({ usd: bad as number }, "usd")).toBeNull();
    }
    expect(usablePrice({ usd: 5 }, "usd")).toBe(5);
  });
});

describe("snapshotPoints", () => {
  const today = new Date(2026, 10, 2, 12, 0, 0);
  const keyDaysAgo = (n: number) => jalaliDateKey(new Date(today.getTime() - n * 86_400_000));
  const row = (date: string, totalValue: number, updatedAt: string, id?: string): BasketSnapshotRow => ({ id, date, totalValue, updatedAt });

  it("draws one point per day, oldest first", () => {
    const points = snapshotPoints([row(keyDaysAgo(1), 200, "2026-11-01T10:00:00Z"), row(keyDaysAgo(3), 100, "2026-10-30T10:00:00Z"), row(keyDaysAgo(0), 300, "2026-11-02T10:00:00Z")], "all", today);
    expect(points).toEqual([
      { date: keyDaysAgo(3), totalValue: 100 },
      { date: keyDaysAgo(1), totalValue: 200 },
      { date: keyDaysAgo(0), totalValue: 300 },
    ]);
  });

  it("lets the row written last win when two devices recorded the same day", () => {
    const day = keyDaysAgo(2);
    const points = snapshotPoints([row(day, 111, "2026-10-31T09:00:00Z", "a"), row(day, 222, "2026-10-31T15:00:00Z", "b"), row(day, 333, "2026-10-31T12:00:00Z", "c")], "all", today);
    expect(points).toEqual([{ date: day, totalValue: 222 }]);
  });

  it("breaks an exact tie the same way on every device (the larger id)", () => {
    const day = keyDaysAgo(2);
    const a = snapshotPoints([row(day, 1, "2026-10-31T09:00:00Z", "a"), row(day, 2, "2026-10-31T09:00:00Z", "b")], "all", today);
    const b = snapshotPoints([row(day, 2, "2026-10-31T09:00:00Z", "b"), row(day, 1, "2026-10-31T09:00:00Z", "a")], "all", today);
    expect(a).toEqual(b);
    expect(a[0].totalValue).toBe(2);
  });

  it("limits a month to the last 30 days and a year to the last 365", () => {
    const rows = [0, 10, 29, 30, 31, 200, 364, 365, 400].map((n) => row(keyDaysAgo(n), n, "2026-11-01T00:00:00Z"));
    expect(snapshotPoints(rows, "1m", today).map((p) => p.totalValue)).toEqual([30, 29, 10, 0]);
    expect(snapshotPoints(rows, "1y", today).map((p) => p.totalValue)).toEqual([365, 364, 200, 31, 30, 29, 10, 0]);
    expect(snapshotPoints(rows, "all", today)).toHaveLength(rows.length);
  });

  it("starts a range on the day its start key names, and 'all' on none", () => {
    expect(rangeStartKey("1m", today)).toBe(keyDaysAgo(30));
    expect(rangeStartKey("1y", today)).toBe(keyDaysAgo(365));
    expect(rangeStartKey("all", today)).toBeNull();
  });
});

describe("describeAge", () => {
  it("says how old a price is in the largest fitting unit", () => {
    expect(describeAge(0)).toBe("همین حالا");
    expect(describeAge(59)).toBe("همین حالا");
    expect(describeAge(60)).toBe("۱ دقیقه پیش");
    expect(describeAge(5 * 60 + 40)).toBe("۵ دقیقه پیش");
    expect(describeAge(3 * 3600 + 100)).toBe("۳ ساعت پیش");
    expect(describeAge(23 * 3600 + 3599)).toBe("۲۳ ساعت پیش");
    expect(describeAge(2 * 86_400 + 5)).toBe("۲ روز پیش");
  });

  it("does not print nonsense for a bad value", () => {
    expect(describeAge(Number.NaN)).toBe("همین حالا");
    expect(describeAge(-30)).toBe("همین حالا");
  });
});

describe("quantities", () => {
  it("formats with Persian digits, grouping and at most three decimals", () => {
    // The app writes Persian digits but keeps "," and "." as the separators (see formatMoney).
    expect(formatQuantity(1500)).toBe("۱,۵۰۰");
    expect(formatQuantity(12.5)).toBe("۱۲.۵");
    expect(formatQuantity(0.1234567)).toBe("۰.۱۲۳");
    expect(formatQuantity(3)).toBe("۳");
  });

  it("reads what a person types: Persian digits, either decimal mark, thousands separators", () => {
    expect(parseQuantityInput("۱۲٫۵")).toBe(12.5);
    expect(parseQuantityInput("12.5")).toBe(12.5);
    expect(parseQuantityInput("۱,۵۰۰")).toBe(1500);
    expect(parseQuantityInput(" 3 ")).toBe(3);
  });

  it("refuses zero, negatives, words, huge numbers and nothing", () => {
    for (const bad of ["0", "-2", "abc", "", "1.2.3", "1e5", "9999999999999"]) expect(parseQuantityInput(bad)).toBeNull();
  });
});
