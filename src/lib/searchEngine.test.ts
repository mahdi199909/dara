import { describe, expect, it } from "vitest";
import {
  buildSearchResults,
  highlightParts,
  matchesTerms,
  normalizeSearchText,
  pickCandidateIds,
  queryTerms,
  relevance,
  snippetAround,
  type ActivitySearchResult,
  type SearchCandidates,
  type SearchRows,
  type StatsSearchResult,
  type TimedSearchResult,
} from "./searchEngine";

describe("normalizeSearchText", () => {
  it("treats Arabic and Persian letters, digits and half-spaces as the same", () => {
    expect(normalizeSearchText("علي")).toBe(normalizeSearchText("علی"));
    expect(normalizeSearchText("كتاب")).toBe(normalizeSearchText("کتاب"));
    expect(normalizeSearchText("می‌خوانم")).toBe(normalizeSearchText("میخوانم"));
    expect(normalizeSearchText("۱۲۳")).toBe("123");
    expect(normalizeSearchText("١٢٣")).toBe("123");
    expect(normalizeSearchText("Hello  WORLD")).toBe("hello world");
    expect(normalizeSearchText("  مطالعه   کتاب ")).toBe("مطالعه کتاب");
  });

  it("drops diacritics and the elongation mark", () => {
    expect(normalizeSearchText("مُطَالَعه")).toBe(normalizeSearchText("مطالعه"));
    expect(normalizeSearchText("کـتاب")).toBe("کتاب");
  });
});

describe("matching", () => {
  it("needs every word of the query, in any order and in any field", () => {
    const terms = queryTerms("جلسه تیم");
    expect(matchesTerms(terms, "جلسه‌ی هفتگی تیم فروش")).toBe(true);
    expect(matchesTerms(terms, "جلسه", "با تیم")).toBe(true);
    expect(matchesTerms(terms, "جلسه فردا")).toBe(false);
    expect(matchesTerms([], "چیزی")).toBe(false);
  });

  it("finds a title typed without its half-space, and with Arabic letters", () => {
    expect(matchesTerms(queryTerms("میخوانم"), "می‌خوانم کتاب")).toBe(true);
    expect(matchesTerms(queryTerms("كتاب"), "خواندن کتاب")).toBe(true);
    expect(matchesTerms(queryTerms("12"), "۱۲ بهمن")).toBe(true);
  });

  it("ranks an exact title above a prefix above a word above a substring", () => {
    const terms = queryTerms("نان");
    expect(relevance(terms, "نان")).toBe(0);
    expect(relevance(terms, "نان سنگک")).toBe(1);
    expect(relevance(terms, "خرید نان")).toBe(2);
    expect(relevance(terms, "پروژه نان‌پزی".replace("‌", "")) ).toBeGreaterThanOrEqual(2);
    expect(relevance(terms, "خمیرنان")).toBe(3);
  });
});

describe("highlighting and snippets", () => {
  it("flags the matching stretches of the ORIGINAL text, even when normalization changed its length", () => {
    const parts = highlightParts("می‌خوانم کتاب", queryTerms("میخوانم"));
    expect(parts).toEqual([
      { text: "می‌خوانم", match: true },
      { text: " کتاب", match: false },
    ]);
  });

  it("merges neighbouring and overlapping matches", () => {
    const parts = highlightParts("abcd ab", queryTerms("ab bc"));
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["abc", "ab"]);
  });

  it("cuts a note down to a few words around the match", () => {
    const text = `${"الف ".repeat(40)}هزینه پنهان ${"ب ".repeat(40)}`;
    const snippet = snippetAround(text, queryTerms("پنهان"), 20);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("پنهان");
    expect(snippet.length).toBeLessThan(80);
  });

  it("keeps a short note whole", () => {
    expect(snippetAround("امروز خوب بود", queryTerms("خوب"))).toBe("امروز خوب بود");
  });
});

describe("pickCandidateIds", () => {
  const empty: SearchCandidates = { tasks: [], events: [], activities: [], notes: [], transactions: [], habits: [], categories: [], plans: [], projects: [], assets: [] };

  it("orders by relevance, then by recency, and cuts to the limit", () => {
    const tasks = [
      { id: "old-exact", title: "نان", sortAt: "2026-01-01T00:00:00Z" },
      { id: "new-word", title: "خرید نان", sortAt: "2026-09-01T00:00:00Z" },
      { id: "newer-word", title: "پخت نان", sortAt: "2026-09-10T00:00:00Z" },
      { id: "other", title: "شیر", sortAt: "2026-09-20T00:00:00Z" },
    ];
    expect(pickCandidateIds("نان", { ...empty, tasks }).tasks).toEqual(["old-exact", "newer-word", "new-word"]);

    const many = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `نان ${i}`, sortAt: new Date(2026, 0, i + 1) }));
    expect(pickCandidateIds("نان", { ...empty, tasks: many }).tasks).toHaveLength(8);
  });

  it("looks in descriptions, locations and note bodies too", () => {
    const ids = pickCandidateIds("کافه", {
      ...empty,
      tasks: [{ id: "t", title: "دیدار", description: "در کافه", sortAt: "2026-09-01T00:00:00Z" }],
      events: [{ id: "e", title: "قرار", location: "کافه مرکزی", sortAt: "2026-09-01T00:00:00Z" }],
      notes: [{ id: "n", day: "2026-09-01", content: "رفتیم کافه" }],
    });
    expect([ids.tasks, ids.events, ids.notes]).toEqual([["t"], ["e"], ["n"]]);
  });

  it("returns nothing for a blank query", () => {
    const ids = pickCandidateIds("   ", { ...empty, tasks: [{ id: "t", title: "نان", sortAt: "2026-09-01T00:00:00Z" }] });
    expect(Object.values(ids).flat()).toEqual([]);
  });
});

describe("buildSearchResults", () => {
  const baseRows: SearchRows = {
    tasks: [],
    events: [],
    activities: [],
    notes: [],
    transactions: [],
    habits: [],
    categories: [],
    plans: [],
    projects: [],
    assets: [],
    activityEntries: [],
    habitCheckIns: [],
    categoryLogs: [],
    hourlyValue: 120_000,
  };
  const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m);

  it("gives a task its day, hours, length, hidden cost and money — and a link to that day", () => {
    const [r] = buildSearchResults("مطالعه", {
      ...baseRows,
      tasks: [
        {
          id: "t1",
          title: "مطالعه کتاب",
          status: "DONE",
          dueDate: at(21, 0),
          startAt: at(21, 9),
          endAt: at(21, 10, 30),
          createdAt: at(20, 8),
          directCost: 50_000,
          incomeAmount: 0,
          category: { name: "کار", icon: "💼" },
        },
      ],
    }) as TimedSearchResult[];

    expect(r.type).toBe("TASK");
    expect(r.day).toBe("2026-09-21");
    expect(r.durationMin).toBe(90);
    expect(r.done).toBe(true);
    expect(r.timeCost).toBe(180_000); // 1.5 h × 120,000
    expect(r.hiddenCost).toBe(230_000); // 50,000 spent + 180,000 of time
    expect(r.href).toBe("/calendar?day=2026-09-21&item=t1");
    expect(r.category).toEqual({ name: "کار", icon: "💼" });
  });

  it("has no time cost for a task without times, and files it under its due day", () => {
    const [r] = buildSearchResults("x", {
      ...baseRows,
      tasks: [{ id: "t", title: "x", status: "TODO", dueDate: at(25, 0), startAt: null, endAt: null, createdAt: at(1, 8), directCost: 0, incomeAmount: 200_000 }],
    }) as TimedSearchResult[];
    expect(r.day).toBe("2026-09-25");
    expect(r.durationMin).toBeNull();
    expect(r.timeCost).toBe(0);
    expect(r.hiddenCost).toBe(0);
    expect(r.incomeAmount).toBe(200_000);
  });

  it("treats an all-day event as having no hours, and marks a repeating one", () => {
    const [r] = buildSearchResults("e", {
      ...baseRows,
      events: [{ id: "e", title: "e", allDay: true, startAt: at(21, 0), endAt: at(21, 23, 59), recurrenceFreq: "WEEKLY", directCost: 0, incomeAmount: 0 }],
    }) as TimedSearchResult[];
    expect(r.start).toBeNull();
    expect(r.durationMin).toBeNull();
    expect(r.recurring).toBe(true);
  });

  it("totals an activity's time and days, prices the time, and links to its last day", () => {
    const [r] = buildSearchResults("کدنویسی", {
      ...baseRows,
      activities: [{ id: "a", title: "کدنویسی", totalDurationMin: 150, directCost: 10_000, category: { name: "کار", icon: "💼" } }],
      activityEntries: [
        { activityId: "a", date: at(10, 9), minutes: 60 },
        { activityId: "a", date: at(10, 14), minutes: 30 },
        { activityId: "a", date: at(12, 9), minutes: 60 },
        { activityId: "other", date: at(13, 9), minutes: 999 },
      ],
    }) as ActivitySearchResult[];
    expect(r).toMatchObject({ type: "ACTIVITY", id: "a", doneDays: 2, totalMinutes: 150, lastDay: "2026-09-12", timeCost: 300_000, hiddenCost: 310_000 });
    expect(r.href).toBe("/calendar?day=2026-09-12");
  });

  it("counts a habit's distinct days and total time, and points at its category's calendar on the last month done", () => {
    const [r] = buildSearchResults("مطالعه", {
      ...baseRows,
      habits: [{ id: "h", title: "مطالعه روزانه", icon: "📚", categoryId: "cat1" }],
      habitCheckIns: [
        { habitId: "h", date: at(10, 0), durationMin: 30 },
        { habitId: "h", date: at(11, 0), durationMin: null },
        { habitId: "h", date: at(11, 12), durationMin: 15 }, // same day again
        { habitId: "other", date: at(12, 0), durationMin: 999 },
      ],
    }) as StatsSearchResult[];
    expect(r).toMatchObject({ type: "HABIT", doneDays: 2, totalMinutes: 45, lastDay: "2026-09-11" });
    expect(r.href).toBe("/reports?tab=categoryCalendar&category=cat1&day=2026-09-11");
  });

  it("sends a habit with no category to the habits page", () => {
    const [r] = buildSearchResults("ورزش", { ...baseRows, habits: [{ id: "h", title: "ورزش", categoryId: null }] });
    expect(r.href).toBe("/habits");
  });

  it("counts a category's logged days and time, ignoring empty stretches", () => {
    const [r] = buildSearchResults("کار", {
      ...baseRows,
      categories: [{ id: "c", name: "کار", icon: "💼" }],
      categoryLogs: [
        { categoryId: "c", date: at(3, 9), minutes: 60 },
        { categoryId: "c", date: at(3, 14), minutes: 30 },
        { categoryId: "c", date: at(5, 9), minutes: 0 },
        { categoryId: "c", date: at(7, 9), minutes: 45 },
        { categoryId: "zzz", date: at(8, 9), minutes: 500 },
      ],
    }) as StatsSearchResult[];
    expect(r).toMatchObject({ type: "CATEGORY", doneDays: 2, totalMinutes: 135, lastDay: "2026-09-07" });
    expect(r.href).toBe("/reports?tab=categoryCalendar&category=c&day=2026-09-07");
  });

  it("summarises an installment plan: total, paid, unpaid, and the nearest due date", () => {
    const [r] = buildSearchResults("وام", {
      ...baseRows,
      plans: [
        {
          id: "p",
          title: "وام خودرو",
          installments: [
            { amount: 100, status: "PAID", dueDate: at(1, 0) },
            { amount: 100, status: "PENDING", dueDate: at(28, 0) },
            { amount: 100, status: "PENDING", dueDate: at(29, 0) },
          ],
        },
      ],
    });
    expect(r).toMatchObject({ type: "INSTALLMENT", totalAmount: 300, paidAmount: 100, unpaidAmount: 200, paidCount: 1, totalCount: 3 });
    expect((r as { nextDueDate: string }).nextDueDate).toBe(at(28, 0).toISOString());
    expect(r.href).toBe("/finance?tab=installments&plan=p");
  });

  it("shows the words around a match in a note and links to its day", () => {
    const [r] = buildSearchResults("هزینه پنهان", { ...baseRows, notes: [{ id: "n", day: "2026-09-21", content: "امروز درباره‌ی هزینه پنهان حرف زدیم" }] });
    expect(r).toMatchObject({ type: "NOTE", day: "2026-09-21", href: "/calendar?day=2026-09-21&item=n" });
    expect((r as { snippet: string }).snippet).toContain("هزینه پنهان");
  });

  it("names a transaction by its description, or its category, and links to its day", () => {
    const results = buildSearchResults("قبض", {
      ...baseRows,
      transactions: [
        { id: "a", type: "EXPENSE", amount: 250_000, date: at(15, 12), description: "قبض برق" },
        { id: "b", type: "EXPENSE", amount: 1, date: at(16, 12), description: null, category: { name: "قبض", icon: null } },
      ],
    });
    expect(results.map((r) => r.title)).toEqual(["قبض برق", "قبض"]);
    expect(results[0].href).toBe("/calendar?day=2026-09-15");
  });

  it("emits the kinds in a fixed, useful order", () => {
    const results = buildSearchResults("x", {
      ...baseRows,
      assets: [{ id: "a", name: "x" }],
      projects: [{ id: "p", name: "x" }],
      notes: [{ id: "n", day: "2026-09-01", content: "x" }],
      tasks: [{ id: "t", title: "x", status: "TODO", dueDate: null, startAt: null, endAt: null, createdAt: at(1, 1), directCost: 0, incomeAmount: 0 }],
    });
    expect(results.map((r) => r.type)).toEqual(["TASK", "NOTE", "PROJECT", "ASSET"]);
  });
});
