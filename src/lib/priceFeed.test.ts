import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASKET_ASSETS } from "./basketCatalog";
import {
  PRICES_FRESH_FOR_MS,
  PRICES_RETRY_AFTER_FAILURE_MS,
  PRICES_SERVE_STALE_FOR_MS,
  TGJU_ROWS,
  getPrices,
  parseTgjuFeed,
  resetPriceFeed,
} from "./priceFeed";

const row = (p: string, ts = "2026-11-01 00:00:00") => ({ p, h: p, l: p, d: "0", dp: 0, dt: "", t: "", ts });

// The rows below are copied from a real response of the feed (https://call2.tgju.org/ajax.json, 2026-11-02 00:23
// Tehran time), trimmed to the rows the basket reads. Prices are in rials, as strings with thousands separators.
const REAL_FEED = {
  current: {
    price_dollar_rl: row("2,715,000"),
    price_eur: row("3,035,300"),
    price_gbp: row("3,635,800"),
    price_aed: row("742,590"),
    price_try: row("54,300"),
    geram18: row("255,792,000"),
    geram24: row("341,052,000"),
    sekee: row("2,614,200,000"),
    sekeb: row("2,519,400,000"),
    nim: row("1,387,200,000"),
    rob: row("743,800,000"),
    gerami: row("374,000,000"),
    silver_999: row("4,786,700", "2026-11-02 00:08:17"),
    // A dead indicator the feed still lists, to show unrelated rows are ignored.
    zinc: row("2575.6", "2021-06-28 14:00:00"),
  },
  tolerance_low: {},
  tolerance_high: {},
  last: {},
};

// 2026-11-02 00:23 in Tehran (UTC+3:30).
const NOW = Date.UTC(2026, 10, 1, 20, 53, 0);

const EXPECTED_TOMAN = {
  usd: 271_500,
  eur: 303_530,
  gbp: 363_580,
  aed: 74_259,
  try: 5_430,
  gold18: 25_579_200,
  gold24: 34_105_200,
  coin_emami: 261_420_000,
  coin_bahar: 251_940_000,
  coin_half: 138_720_000,
  coin_quarter: 74_380_000,
  coin_gram: 37_400_000,
  silver999: 478_670,
};

describe("parseTgjuFeed", () => {
  it("turns a real response into Toman for every asset of the catalog (rial ÷ 10)", () => {
    const parsed = parseTgjuFeed(REAL_FEED, NOW);
    expect(parsed.prices).toEqual(EXPECTED_TOMAN);
    expect(parsed.missing).toEqual([]);
  });

  it("maps every catalog asset to a row, and no two assets to the same row", () => {
    const rows = BASKET_ASSETS.map((asset) => TGJU_ROWS[asset.id]);
    expect(rows.every(Boolean)).toBe(true);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("drops a row whose own timestamp is older than two weeks, but keeps one with no timestamp", () => {
    const feed = { current: { ...REAL_FEED.current, price_try: row("54,300", "2026-09-01 00:00:00"), price_aed: { p: "742,590" } } };
    const parsed = parseTgjuFeed(feed, NOW);
    expect(parsed.missing).toEqual(["try"]);
    expect(parsed.prices.aed).toBe(74_259);
  });

  it("does not take a zero, negative, empty or non-numeric price for a price", () => {
    const feed = { current: { ...REAL_FEED.current, price_eur: row("0"), price_gbp: row("-5"), price_aed: row(""), price_try: row("n/a"), geram24: { p: null } } };
    expect(parseTgjuFeed(feed, NOW).missing.sort()).toEqual(["aed", "eur", "gbp", "gold24", "try"]);
  });

  it("refuses a price that is absurdly large", () => {
    const feed = { current: { ...REAL_FEED.current, price_dollar_rl: row("99,999,999,999,999,999") } };
    expect(parseTgjuFeed(feed, NOW).missing).toEqual(["usd"]);
  });

  it("copes with a response that is not in the shape at all", () => {
    for (const junk of [null, undefined, 5, "text", [], {}, { current: null }, { current: 7 }, { current: [] }]) {
      const parsed = parseTgjuFeed(junk, NOW);
      expect(parsed.prices).toEqual({});
      expect(parsed.missing).toHaveLength(BASKET_ASSETS.length);
    }
  });
});

describe("getPrices", () => {
  let clock = NOW;
  const now = () => clock;
  const okResponse = (body: unknown = REAL_FEED) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  const URLS = ["https://one.test/ajax.json", "https://two.test/ajax.json"];

  beforeEach(() => {
    clock = NOW;
    resetPriceFeed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PRICE_FEED_URLS;
  });

  it("reads the market once and answers from memory for five minutes", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const first = await getPrices({ fetchImpl, now, urls: URLS });
    expect(first).toMatchObject({ prices: EXPECTED_TOMAN, ageSeconds: 0, source: "tgju", fetchedAt: new Date(NOW).toISOString() });

    clock += PRICES_FRESH_FOR_MS - 1_000;
    const second = await getPrices({ fetchImpl, now, urls: URLS });
    expect(second?.prices).toEqual(EXPECTED_TOMAN);
    expect(second?.ageSeconds).toBe(Math.round((PRICES_FRESH_FOR_MS - 1_000) / 1000));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks the market only once when many requests arrive together", async () => {
    let release: (value: Response) => void = () => {};
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const all = Promise.all([getPrices({ fetchImpl, now, urls: URLS }), getPrices({ fetchImpl, now, urls: URLS }), getPrices({ fetchImpl, now, urls: URLS })]);
    release(okResponse());
    const results = await all;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result?.prices).toEqual(EXPECTED_TOMAN);
  });

  it("answers at once from the older copy and refreshes in the background", async () => {
    const newer = { current: { ...REAL_FEED.current, price_dollar_rl: row("2,800,000") } };
    const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse()).mockResolvedValueOnce(okResponse(newer));
    await getPrices({ fetchImpl, now, urls: URLS });

    clock += PRICES_FRESH_FOR_MS + 60_000;
    const stale = await getPrices({ fetchImpl, now, urls: URLS });
    expect(stale?.prices.usd).toBe(271_500); // the copy it had, not the new one
    expect(stale?.ageSeconds).toBe((PRICES_FRESH_FOR_MS + 60_000) / 1000);

    // The background read finishes a moment later; asking again meanwhile joins it rather than starting another.
    await vi.waitFor(async () => expect((await getPrices({ fetchImpl, now, urls: URLS }))?.prices.usd).toBe(280_000));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await getPrices({ fetchImpl, now, urls: URLS }))?.ageSeconds).toBe(0);
  });

  it("tries the next address when one cannot be read, or has nothing usable", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      if (calls.length === 1) throw new TypeError("network down");
      return okResponse();
    });
    const result = await getPrices({ fetchImpl, now, urls: URLS });
    expect(calls).toEqual(URLS);
    expect(result?.prices).toEqual(EXPECTED_TOMAN);

    resetPriceFeed();
    const empties = vi.fn().mockResolvedValueOnce(okResponse({ current: {} })).mockResolvedValueOnce(okResponse());
    expect((await getPrices({ fetchImpl: empties, now, urls: URLS }))?.prices).toEqual(EXPECTED_TOMAN);
  });

  it("treats an HTTP error as a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockResolvedValueOnce(okResponse());
    expect((await getPrices({ fetchImpl, now, urls: URLS }))?.prices).toEqual(EXPECTED_TOMAN);
  });

  it("answers null when nothing can be read and there is no copy, and does not hammer the market for a minute", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    });
    expect(await getPrices({ fetchImpl, now, urls: URLS })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(URLS.length);

    clock += PRICES_RETRY_AFTER_FAILURE_MS - 1_000;
    expect(await getPrices({ fetchImpl, now, urls: URLS })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(URLS.length); // still backing off

    clock += 2_000;
    await getPrices({ fetchImpl, now, urls: URLS });
    expect(fetchImpl).toHaveBeenCalledTimes(URLS.length * 2);
  });

  it("keeps serving the last copy, saying how old it is, while the market is down — for a day, then gives up", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okResponse());
    await getPrices({ fetchImpl, now, urls: URLS });
    fetchImpl.mockRejectedValue(new TypeError("network down"));

    clock += 3 * 3_600_000;
    const old = await getPrices({ fetchImpl, now, urls: URLS });
    expect(old?.prices).toEqual(EXPECTED_TOMAN);
    expect(old?.ageSeconds).toBe(3 * 3600);

    clock += PRICES_SERVE_STALE_FOR_MS; // now well past a day
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(1));
    expect(await getPrices({ fetchImpl, now, urls: URLS })).toBeNull();
  });

  it("reads the addresses from PRICE_FEED_URLS when it is set", async () => {
    process.env.PRICE_FEED_URLS = " https://mirror.test/a.json , https://mirror.test/b.json ";
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return okResponse();
    });
    await getPrices({ fetchImpl, now });
    expect(seen).toEqual(["https://mirror.test/a.json"]);
  });

  it("hands out a copy, so a caller cannot change what the next one gets", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const first = await getPrices({ fetchImpl, now, urls: URLS });
    first!.prices.usd = 1;
    expect((await getPrices({ fetchImpl, now, urls: URLS }))?.prices.usd).toBe(271_500);
  });
});
