// The asset basket's arithmetic, shared by the web server, the phone and the page — pure functions only, so the
// same holdings and prices give the same total everywhere. Prices are Toman for ONE unit of an asset (one
// dollar, one gram, one coin); a holding is how many units the person has.
import { jalaliDateKey } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { parseVisionNumber } from "@/lib/visionFormat";
import { BASKET_ASSETS, basketAssetById, type BasketAsset } from "@/lib/basketCatalog";

/** Toman for one unit, by asset id. An asset missing from the map has no known price. */
export type PriceMap = Readonly<Record<string, number>>;

/** Far beyond anything a person holds; keeps a typo from reaching 1e300. */
export const MAX_BASKET_QUANTITY = 1e12;

export interface BasketHoldingRow {
  id: string;
  assetKey: string;
  quantity: number;
  createdAt: Date | string;
}

export interface BasketLine {
  asset: BasketAsset;
  /** Everything held of this asset (duplicates made by two devices adding the same asset offline are summed). */
  quantity: number;
  /** Toman for one unit; null when no price is known. */
  price: number | null;
  /** quantity × price in whole Toman; null without a price. */
  value: number | null;
  /** The holding rows behind this line, oldest first. Edits go to the first; the rest are duplicates to fold in. */
  holdingIds: string[];
}

export interface BasketSummary {
  lines: BasketLine[];
  /** The sum of the priced lines. */
  total: number;
  pricedCount: number;
  unpricedCount: number;
  /** There is at least one line and every line has a price: the total is the whole truth, so it may be recorded. */
  complete: boolean;
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

/** A price is only usable when it is a positive, finite number. */
export function usablePrice(prices: PriceMap, assetId: string): number | null {
  const price = prices[assetId];
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

export function computeBasket(rows: readonly BasketHoldingRow[], prices: PriceMap): BasketSummary {
  const groups = new Map<string, BasketHoldingRow[]>();
  for (const row of rows) {
    // An asset this build does not list (a newer app added it) is left out of the sums rather than guessed at.
    if (!basketAssetById(row.assetKey)) continue;
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) continue;
    const group = groups.get(row.assetKey);
    if (group) group.push(row);
    else groups.set(row.assetKey, [row]);
  }

  const lines: BasketLine[] = [];
  for (const asset of BASKET_ASSETS) {
    const group = groups.get(asset.id);
    if (!group) continue;
    const ordered = [...group].sort((a, b) => time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : 1));
    const quantity = ordered.reduce((sum, row) => sum + row.quantity, 0);
    const price = usablePrice(prices, asset.id);
    lines.push({ asset, quantity, price, value: price === null ? null : Math.round(quantity * price), holdingIds: ordered.map((row) => row.id) });
  }

  const priced = lines.filter((line) => line.value !== null);
  return {
    lines,
    total: priced.reduce((sum, line) => sum + (line.value as number), 0),
    pricedCount: priced.length,
    unpricedCount: lines.length - priced.length,
    complete: lines.length > 0 && priced.length === lines.length,
  };
}

// --- The value-over-time chart -----------------------------------------------------------------------------

export const BASKET_RANGES = ["1m", "1y", "all"] as const;
export type BasketRange = (typeof BASKET_RANGES)[number];
export const BASKET_RANGE_LABELS: Record<BasketRange, string> = { "1m": "۱ ماه", "1y": "۱ سال", all: "کل" };

const RANGE_DAYS = { "1m": 30, "1y": 365 } as const;

/** The first Jalali day key (YYYY-MM-DD, zero-padded so keys compare as text) a range includes; null = from the start. */
export function rangeStartKey(range: BasketRange, today: Date): string | null {
  if (range === "all") return null;
  return jalaliDateKey(new Date(today.getTime() - RANGE_DAYS[range] * 86_400_000));
}

export interface BasketSnapshotRow {
  id?: string;
  /** Jalali day key, "1405-08-11". */
  date: string;
  totalValue: number;
  updatedAt: Date | string;
}

export interface BasketPoint {
  date: string;
  totalValue: number;
}

/**
 * One point per day, oldest first, for the days a range covers. Two devices can each record the same day before
 * they have synced, so a day can have several rows; the one written last wins.
 */
export function snapshotPoints(rows: readonly BasketSnapshotRow[], range: BasketRange, today: Date = new Date()): BasketPoint[] {
  const start = rangeStartKey(range, today);
  const latest = new Map<string, BasketSnapshotRow>();
  for (const row of rows) {
    if (start !== null && row.date < start) continue;
    const seen = latest.get(row.date);
    const newer = !seen || time(row.updatedAt) > time(seen.updatedAt) || (time(row.updatedAt) === time(seen.updatedAt) && (row.id ?? "") > (seen.id ?? ""));
    if (newer) latest.set(row.date, row);
  }
  return [...latest.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((row) => ({ date: row.date, totalValue: row.totalValue }));
}

// --- Showing and reading quantities ------------------------------------------------------------------------

/** How long ago a price was read, the way the page says it: "همین حالا", "۵ دقیقه پیش", "۳ ساعت پیش", "۲ روز پیش". */
export function describeAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return "همین حالا";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  return `${toPersianDigits(Math.floor(hours / 24))} روز پیش`;
}

/** "۱,۲۵۰" / "۱۲.۵" — grouped, at most three decimals (a gram of gold is rarely a round number), Persian digits. */
export function formatQuantity(quantity: number): string {
  const rounded = Math.round(quantity * 1000) / 1000;
  return toPersianDigits(rounded.toLocaleString("en-US", { maximumFractionDigits: 3 }));
}

/** What a person typed into the quantity field, or null when it is not a positive number the basket accepts. */
export function parseQuantityInput(text: string): number | null {
  const value = parseVisionNumber(text);
  return value !== null && value > 0 && value <= MAX_BASKET_QUANTITY ? value : null;
}
