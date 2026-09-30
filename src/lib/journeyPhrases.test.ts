import { describe, expect, it } from "vitest";
import { naturalPhrase } from "./journeyPhrases";
import { buildChapter } from "./journeyEngine";
import { EMPTY_JOURNEY_ROWS, type JourneyDay, type JourneyRows } from "./journeyTypes";
import { pickDefaultAccount } from "./defaultAccount";

describe("everyday entries said in their own words", () => {
  it("turns a trip into a sentence about going, whatever the category", () => {
    expect(naturalPhrase("حرکت از تهران به قم", "رفت و آمد")).toEqual({ text: "از تهران به قم حرکت کردم", travel: true });
    expect(naturalPhrase("حرکت از تهران به قم", null)).toEqual({ text: "از تهران به قم حرکت کردم", travel: true });
    expect(naturalPhrase("رفتن به دفتر", null)?.text).toBe("به دفتر رفتم");
    expect(naturalPhrase("برگشت از شیراز", null)?.text).toBe("از شیراز برگشتم");
    expect(naturalPhrase("سفر به مشهد", null)?.text).toBe("به مشهد سفر کردم");
  });

  it("lets the commute category supply the verb the title left out", () => {
    expect(naturalPhrase("از خانه به دفتر", "رفت و آمد")).toEqual({ text: "از خانه به دفتر رفتم", travel: true });
    expect(naturalPhrase("تهران به قم", "رفت‌وآمد")?.text).toBe("از تهران به قم رفتم");
    expect(naturalPhrase("به فرودگاه", "رفت وآمد")?.text).toBe("به فرودگاه رفتم");
    // Not a route: told the ordinary way rather than guessed at.
    expect(naturalPhrase("تاکسی", "رفت و آمد")).toBeNull();
    expect(naturalPhrase("از خانه به دفتر", "کار")).toBeNull();
  });

  it("knows the verbal nouns people open a title with, with or without an ezafe", () => {
    expect(naturalPhrase("خرید نان و شیر", null)?.text).toBe("نان و شیر خریدم");
    expect(naturalPhrase("مطالعه کتاب", null)?.text).toBe("کتاب را مطالعه کردم");
    expect(naturalPhrase("مطالعهٔ کتاب", null)?.text).toBe("کتاب را مطالعه کردم");
    expect(naturalPhrase("مطالعه‌ی کتاب", null)?.text).toBe("کتاب را مطالعه کردم");
    expect(naturalPhrase("تماس با بانک", null)?.text).toBe("با بانک تماس گرفتم");
    expect(naturalPhrase("جلسه با رها", null)?.text).toBe("با رها جلسه داشتم");
    expect(naturalPhrase("پرداخت قبض برق", null)?.text).toBe("قبض برق را پرداخت کردم");
  });

  it("says a one-word activity as something done", () => {
    expect(naturalPhrase("ورزش", null)?.text).toBe("ورزش کردم");
    expect(naturalPhrase("پیاده‌روی", null)?.text).toBe("پیاده‌روی کردم");
    expect(naturalPhrase("  خرید ", null)?.text).toBe("خرید کردم");
  });

  it("uses the shopping category for a bare item, and leaves everything else alone", () => {
    expect(naturalPhrase("کفش", "خرید")?.text).toBe("«کفش» خریدم");
    expect(naturalPhrase("طرح صفحهٔ اصلی", "کار")).toBeNull();
    expect(naturalPhrase("تماس", null)).toBeNull(); // «تماس» needs someone to have been called
    expect(naturalPhrase("حرکت", null)).toBeNull();
    expect(naturalPhrase("", null)).toBeNull();
  });
});

describe("the journey tells them that way", () => {
  const NOW = new Date(2026, 8, 26, 15, 0);
  const MEHR = { jy: 1405, jm: 7 };
  const at = (day: number, hour = 0, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
  const rows = (partial: Partial<JourneyRows>): JourneyRows => ({ ...EMPTY_JOURNEY_ROWS, earliestDay: "2026-09-23", ...partial });
  const textOf = (r: JourneyRows, key: string) => {
    const day = buildChapter({ month: MEHR, rows: r, now: NOW }).entries.find((e): e is JourneyDay => e.kind === "day" && e.key === key)!;
    return day.paragraphs.join("\n");
  };

  it("writes «از تهران به قم حرکت کردم» with the time on the road, not «کار … را تمام کردم»", () => {
    const text = textOf(
      rows({ tasks: [{ id: "t1", title: "حرکت از تهران به قم", at: at(24, 8), minutes: 120, project: null, category: "رفت و آمد" }] }),
      "2026-09-24"
    );
    expect(text).toContain("از تهران به قم حرکت کردم و دو ساعت در راه بودم.");
    expect(text).not.toContain("«حرکت از تهران به قم»");
    expect(text).not.toContain("تمام کردم");
    expect(text).not.toContain("کار کردم"); // two hours on the road are not two hours of work
  });

  it("keeps project work and unknown titles in the ordinary telling, and says nothing twice", () => {
    const text = textOf(
      rows({
        tasks: [
          { id: "t1", title: "خرید نان", at: at(24, 9), minutes: null, project: null, category: null },
          { id: "t2", title: "طرح صفحهٔ اصلی", at: at(24, 11), minutes: null, project: null, category: "کار" },
          { id: "t3", title: "خرید هاست", at: at(24, 12), minutes: null, project: "سایت آتلیه", category: null },
        ],
      }),
      "2026-09-24"
    );
    expect(text).toContain("نان خریدم.");
    expect(text.match(/نان/g)).toHaveLength(1);
    expect(text).toContain("«طرح صفحهٔ اصلی»");
    expect(text).toContain("«خرید هاست»"); // belongs to a project: stays with that project's work
  });

  it("tells the same trip once when it was logged both as a task and as tracked time", () => {
    const text = textOf(
      rows({
        tasks: [{ id: "t1", title: "حرکت از تهران به قم", at: at(24, 8), minutes: null, project: null, category: "رفت و آمد" }],
        work: [{ id: "w1", title: "حرکت از تهران به قم", startAt: at(24, 8), minutes: 90, project: null, category: "رفت و آمد" }],
      }),
      "2026-09-24"
    );
    expect(text.match(/حرکت کردم/g)).toHaveLength(1);
    expect(text).toContain("در راه بودم");
  });
});

describe("the default account", () => {
  const acc = (id: string, createdAt: string, over: Partial<{ isActive: boolean; isDefault: boolean }> = {}) => ({ id, createdAt, isActive: true, isDefault: false, ...over });

  it("is the one marked, when it is active", () => {
    expect(pickDefaultAccount([acc("a", "2026-01-01"), acc("b", "2026-02-01", { isDefault: true })])?.id).toBe("b");
  });

  it("falls back to the oldest active account", () => {
    expect(pickDefaultAccount([acc("b", "2026-02-01"), acc("a", "2026-01-01")])?.id).toBe("a");
    expect(pickDefaultAccount([acc("a", "2026-01-01", { isActive: false, isDefault: true }), acc("b", "2026-02-01")])?.id).toBe("b");
    expect(pickDefaultAccount([])).toBeNull();
  });
});
