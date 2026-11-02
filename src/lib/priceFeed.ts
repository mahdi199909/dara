// Live prices for the asset basket. SERVER ONLY: the phone and the web page both ask our own /api/prices, which
// answers from this module's cache, so the market site is read at most once every few minutes however many people
// open the basket — and a phone never needs to reach it (or hold any key) itself.
//
// The source is tgju.org's public price feed (the JSON its own front page reads). It is an unofficial endpoint:
// no key, no published terms, and the owner of it can change or close it. Everything that depends on its shape is
// in parseTgjuFeed below, covered by a test built from a real response, so a change breaks one test rather than
// quietly showing a wrong number. PRICE_FEED_URLS (comma-separated) replaces the addresses without a deploy of code.
//
// Its prices are in RIAL; the app's unit is the Toman (÷ 10). A row whose own timestamp is old is a dead
// indicator (the feed still lists some from 2021) and is dropped, never shown as today's price.
import { BASKET_ASSETS } from "@/lib/basketCatalog";
import { getLogger } from "@/lib/observability/root";
import type { PricesResponse } from "@/lib/schemas/basket";

const log = getLogger("prices", "feed");

export const PRICE_SOURCE = "tgju";

const DEFAULT_FEED_URLS = ["https://call2.tgju.org/ajax.json", "https://call5.tgju.org/ajax.json", "https://call4.tgju.org/ajax.json"];

/** Which row of the feed prices each asset of the catalog. */
export const TGJU_ROWS: Readonly<Record<string, string>> = {
  usd: "price_dollar_rl",
  eur: "price_eur",
  gbp: "price_gbp",
  aed: "price_aed",
  try: "price_try",
  gold18: "geram18",
  gold24: "geram24",
  coin_emami: "sekee",
  coin_bahar: "sekeb",
  coin_half: "nim",
  coin_quarter: "rob",
  coin_gram: "gerami",
  silver999: "silver_999",
};

/** Answered from memory this long before the market is read again. */
export const PRICES_FRESH_FOR_MS = 5 * 60_000;
/** When the market cannot be read, the last good copy is still served for this long (the answer says how old it is). */
export const PRICES_SERVE_STALE_FOR_MS = 24 * 3_600_000;
/** After a failed read, wait this long before trying again, so an outage is not hammered by every request. */
export const PRICES_RETRY_AFTER_FAILURE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 7_000;
/** A row whose own timestamp is older than this is a dead indicator. */
const ROW_MAX_AGE_MS = 14 * 86_400_000;
/** The feed's timestamps are Tehran local time; Iran has stayed on UTC+3:30 since it dropped daylight saving in 2022. */
const TEHRAN_OFFSET_MS = (3 * 60 + 30) * 60_000;

export interface ParsedFeed {
  /** Toman for one unit, by asset id. */
  prices: Record<string, number>;
  /** Assets with no usable row in this response. */
  missing: string[];
}

function rialOf(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const number = Number(String(value).replace(/[,\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** "2026-11-01 00:08:17" (Tehran time) as a UTC millisecond count; null when the row has none or in another shape. */
function rowTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) - TEHRAN_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

export function parseTgjuFeed(json: unknown, nowMs: number): ParsedFeed {
  const current = (json as { current?: unknown } | null)?.current;
  const rows = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
  const prices: Record<string, number> = {};
  const missing: string[] = [];

  for (const asset of BASKET_ASSETS) {
    const row = rows[TGJU_ROWS[asset.id]] as { p?: unknown; ts?: unknown } | undefined;
    const rial = rialOf(row?.p);
    const at = rowTime(row?.ts);
    // No timestamp at all means we cannot judge its age, so the price stands; a timestamp that is too old does not.
    const dead = at !== null && nowMs - at > ROW_MAX_AGE_MS;
    const toman = rial === null ? null : Math.round(rial / 10);
    if (toman === null || dead || toman < 1 || toman > 1e12) {
      missing.push(asset.id);
      continue;
    }
    prices[asset.id] = toman;
  }
  return { prices, missing };
}

interface Cached {
  prices: Record<string, number>;
  fetchedAt: number;
}

export interface PriceFeedDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  urls?: readonly string[];
}

let cache: Cached | null = null;
let inflight: Promise<Cached | null> | null = null;
let nextAttemptAt = 0;

/** Tests: forget what an earlier test cached. */
export function resetPriceFeed(): void {
  cache = null;
  inflight = null;
  nextAttemptAt = 0;
}

function feedUrls(): readonly string[] {
  const configured = (process.env.PRICE_FEED_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_FEED_URLS;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

async function readOnce(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "parva-price-proxy/1.0 (+https://parvaapp.ir)" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the market from the first address that answers with at least one usable price. Never throws. */
async function refresh(deps: PriceFeedDeps): Promise<Cached | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  for (const url of deps.urls ?? feedUrls()) {
    try {
      const parsed = parseTgjuFeed(await readOnce(url, fetchImpl), now());
      if (Object.keys(parsed.prices).length === 0) throw new Error("the response had no usable price");
      cache = { prices: parsed.prices, fetchedAt: now() };
      nextAttemptAt = 0;
      log.debug("PRICE_FEED_REFRESHED", { host: hostOf(url), priced: Object.keys(parsed.prices).length, missing: parsed.missing });
      return cache;
    } catch (error) {
      log.warn("PRICE_FEED_FAILED", { host: hostOf(url), reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    }
  }
  nextAttemptAt = now() + PRICES_RETRY_AFTER_FAILURE_MS;
  return null;
}

/** One read at a time, however many requests are waiting for it. */
function startRefresh(deps: PriceFeedDeps): Promise<Cached | null> {
  if (!inflight) {
    inflight = refresh(deps).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function respond(data: Cached, nowMs: number): PricesResponse {
  return {
    prices: { ...data.prices },
    fetchedAt: new Date(data.fetchedAt).toISOString(),
    ageSeconds: Math.max(0, Math.round((nowMs - data.fetchedAt) / 1000)),
    source: PRICE_SOURCE,
  };
}

/**
 * The current prices, or null when there is nothing to show (the market cannot be read and there is no copy
 * younger than a day). A copy that is merely a few minutes old is answered at once while a new read happens in
 * the background; only the very first request after a start waits for the market.
 */
export async function getPrices(deps: PriceFeedDeps = {}): Promise<PricesResponse | null> {
  const now = deps.now ?? Date.now;
  const nowMs = now();
  const age = cache ? nowMs - cache.fetchedAt : Infinity;

  if (cache && age <= PRICES_FRESH_FOR_MS) return respond(cache, nowMs);

  if (cache && age <= PRICES_SERVE_STALE_FOR_MS) {
    if (nowMs >= nextAttemptAt) void startRefresh(deps);
    return respond(cache, nowMs);
  }

  if (nowMs < nextAttemptAt) return null;
  const fresh = await startRefresh(deps);
  return fresh ? respond(fresh, now()) : null;
}
