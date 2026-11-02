// The basket page's side of the price feed: ask our own server for the current prices and remember the last good
// answer on this device, so the basket still shows something (and says how old it is) with no network.
//
// Prices are not the person's data, so they are NOT stored in the database or synced: a copy in localStorage is
// enough (losing it only means the next online visit fetches again). Everything here tolerates storage being
// unavailable — a private window, blocked site data — by simply not remembering.
import { isNativePlatform } from "./apiClient";
import { pricesResponseSchema } from "./schemas/basket";
import type { PriceMap } from "./basket";

// A relative fetch on the phone resolves against the app's bundled-asset origin, not the internet (see
// src/lib/remoteAuth.ts and dailyQuote.ts), so it builds an absolute URL there.
const REMOTE_API_BASE = process.env.NEXT_PUBLIC_REMOTE_API_BASE ?? "https://my.parvaapp.ir";

const CACHE_KEY = "parva_basket_prices_v1";
const FETCH_TIMEOUT_MS = 10_000;

/** An answer whose market reading is no older than this counts as live (a snapshot of the day may be recorded from it). */
export const LIVE_WITHIN_SECONDS = 30 * 60;

export interface PriceBook {
  prices: PriceMap;
  /** When the market was read, on this device's clock (arrival time minus the age the server reported). */
  asOf: number;
}

export interface FetchedPrices extends PriceBook {
  /** The server's own account of how old the reading is. */
  ageSeconds: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadCachedPrices(): PriceBook | null {
  try {
    const raw = storage()?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { prices?: unknown; asOf?: unknown };
    if (typeof parsed.asOf !== "number" || !Number.isFinite(parsed.asOf) || !parsed.prices || typeof parsed.prices !== "object") return null;
    const prices: Record<string, number> = {};
    for (const [id, price] of Object.entries(parsed.prices as Record<string, unknown>)) {
      if (typeof price === "number" && Number.isFinite(price) && price > 0) prices[id] = price;
    }
    return { prices, asOf: parsed.asOf };
  } catch {
    return null;
  }
}

function saveCachedPrices(book: PriceBook): void {
  try {
    storage()?.setItem(CACHE_KEY, JSON.stringify(book));
  } catch {
    // Not remembering is fine.
  }
}

/** True when a reading is recent enough to record the day's value from. */
export function isLive(ageSeconds: number): boolean {
  return ageSeconds <= LIVE_WITHIN_SECONDS;
}

/** Asks the server for the current prices; null when offline, slow, refused or not in the shape we expect. */
export async function fetchLivePrices(): Promise<FetchedPrices | null> {
  const url = isNativePlatform() ? `${REMOTE_API_BASE}/api/prices` : "/api/prices";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    const parsed = pricesResponseSchema.safeParse(await response.json());
    if (!parsed.success || Object.keys(parsed.data.prices).length === 0) return null;
    const book: PriceBook = { prices: parsed.data.prices, asOf: Date.now() - parsed.data.ageSeconds * 1000 };
    saveCachedPrices(book);
    return { ...book, ageSeconds: parsed.data.ageSeconds };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
