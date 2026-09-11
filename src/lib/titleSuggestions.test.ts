import { describe, it, expect } from "vitest";
import { rankTitleSuggestions, type TitleUsageStat } from "./titleSuggestions";

const NOW = new Date("2026-02-15T12:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

describe("rankTitleSuggestions", () => {
  it("ranks a frequently-and-recently-used title above a rarely-used one", () => {
    const candidates: TitleUsageStat[] = [
      { title: "خرید نان", count: 15, lastUsedAt: daysAgo(1) },
      { title: "تعمیر ماشین", count: 1, lastUsedAt: daysAgo(200) },
    ];
    const result = rankTitleSuggestions(candidates, "", NOW);
    expect(result.map((r) => r.title)).toEqual(["خرید نان", "تعمیر ماشین"]);
  });

  it("lets a newly-active title outrank an old high-count one — the 'new project' case", () => {
    const candidates: TitleUsageStat[] = [
      { title: "پروژه قدیمی", count: 50, lastUsedAt: daysAgo(120) }, // used a lot, long ago
      { title: "پروژه جدید", count: 3, lastUsedAt: daysAgo(0) }, // just started, used today
    ];
    const result = rankTitleSuggestions(candidates, "", NOW);
    expect(result[0].title).toBe("پروژه جدید");
  });

  it("filters to titles containing the query, case-insensitively", () => {
    const candidates: TitleUsageStat[] = [
      { title: "خرید نان", count: 5, lastUsedAt: daysAgo(1) },
      { title: "خرید شیر", count: 5, lastUsedAt: daysAgo(1) },
      { title: "تماس با دکتر", count: 5, lastUsedAt: daysAgo(1) },
    ];
    const result = rankTitleSuggestions(candidates, "خرید", NOW);
    expect(result.map((r) => r.title).sort()).toEqual(["خرید شیر", "خرید نان"]);
  });

  it("returns everything, ranked, when the query is empty", () => {
    const candidates: TitleUsageStat[] = [
      { title: "الف", count: 1, lastUsedAt: daysAgo(1) },
      { title: "ب", count: 1, lastUsedAt: daysAgo(2) },
    ];
    expect(rankTitleSuggestions(candidates, "", NOW)).toHaveLength(2);
  });

  it("caps results to the given limit", () => {
    const candidates: TitleUsageStat[] = Array.from({ length: 20 }, (_, i) => ({
      title: `عنوان ${i}`,
      count: 1,
      lastUsedAt: daysAgo(i),
    }));
    expect(rankTitleSuggestions(candidates, "", NOW, 8)).toHaveLength(8);
  });
});
