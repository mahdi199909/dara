import { describe, expect, it } from "vitest";
import { presentSearchResult, SEARCH_GROUPS } from "./searchPresenter";
import { queryTerms, type NoteSearchResult, type PlanSearchResult, type SearchResult, type StatsSearchResult, type TimedSearchResult } from "./searchEngine";

const money = (n: number) => `${n} تومان`;
const terms = queryTerms("مطالعه");
const facts = (r: SearchResult) => Object.fromEntries(presentSearchResult(r, terms, money).facts.map((f) => [f.label, f.value]));

const task: TimedSearchResult = {
  key: "TASK-1",
  type: "TASK",
  id: "1",
  title: "مطالعه کتاب",
  href: "/calendar?day=2026-09-21&item=1",
  day: "2026-09-21",
  start: new Date(2026, 8, 21, 9).toISOString(),
  end: new Date(2026, 8, 21, 10, 30).toISOString(),
  durationMin: 90,
  done: true,
  recurring: false,
  category: { name: "کار", icon: "💼" },
  directCost: 50_000,
  incomeAmount: 0,
  timeCost: 0,
  hiddenCost: 50_000,
};

describe("presentSearchResult", () => {
  it("shows a task's day and hours, length, money and category — and marks the matched words", () => {
    const card = presentSearchResult(task, terms, money);
    expect(card.titleParts).toEqual([
      { text: "مطالعه", match: true },
      { text: " کتاب", match: false },
    ]);
    expect(card.badges).toEqual(["انجام‌شده"]);
    expect(card.icon).toBe("💼");
    expect(card.href).toBe(task.href);
    const f = facts(task);
    expect(f["زمان"]).toContain("۳۰ شهریور ۱۴۰۵");
    expect(f["زمان"]).toContain("۰۹:۰۰");
    expect(f["زمان"]).toContain("۱۰:۳۰");
    expect(f["مدت"]).toBe("۱ ساعت و ۳۰ دقیقه");
    expect(f["هزینه"]).toBe("50000 تومان");
    expect(f["دسته‌بندی"]).toBe("کار");
  });

  it("names a hidden cost only when the time has a value — never the same sum twice under two names", () => {
    expect(facts(task)).not.toHaveProperty("هزینه پنهان");
    const priced = facts({ ...task, timeCost: 180_000, hiddenCost: 230_000 });
    expect(priced["هزینه پنهان"]).toBe("230000 تومان");
    expect(priced["هزینه"]).toBe("50000 تومان");
  });

  it("shows income for a task that earned, and leaves out what is zero", () => {
    const f = facts({ ...task, directCost: 0, hiddenCost: 0, incomeAmount: 200_000, durationMin: null, start: null, end: null });
    expect(f["درآمد"]).toBe("200000 تومان");
    expect(f).not.toHaveProperty("هزینه");
    expect(f).not.toHaveProperty("مدت");
    expect(f["زمان"]).not.toContain(":");
  });

  it("gives a habit or category its days and time", () => {
    const habit: StatsSearchResult = { key: "HABIT-h", type: "HABIT", id: "h", title: "مطالعه روزانه", href: "/habits", icon: "📚", doneDays: 12, totalMinutes: 360, lastDay: "2026-09-11" };
    const card = presentSearchResult(habit, terms, money);
    expect(card.icon).toBe("📚");
    const f = facts(habit);
    expect(f["روزهای انجام"]).toBe("۱۲ روز");
    expect(f["مجموع زمان"]).toBe("۶ ساعت");
    expect(f["آخرین بار"]).toContain("۲۰ شهریور ۱۴۰۵");
    expect(facts({ ...habit, doneDays: 0, totalMinutes: 0, lastDay: null })["مجموع زمان"]).toBe("—");
  });

  it("gives an installment plan its total, paid, unpaid and nearest due date", () => {
    const plan: PlanSearchResult = {
      key: "INSTALLMENT-p",
      type: "INSTALLMENT",
      id: "p",
      title: "وام",
      href: "/finance?tab=installments&plan=p",
      totalAmount: 300,
      paidAmount: 100,
      unpaidAmount: 200,
      paidCount: 1,
      totalCount: 3,
      nextDueDate: new Date(2026, 9, 5).toISOString(),
    };
    const f = facts(plan);
    expect(f["مجموع اقساط"]).toBe("300 تومان");
    expect(f["پرداخت‌شده (۱ از ۳)"]).toBe("100 تومان");
    expect(f["پرداخت‌نشده"]).toBe("200 تومان");
    expect(f["نزدیک‌ترین سررسید"]).toBe("۱۳ مهر ۱۴۰۵");
  });

  it("puts a note's day where a title would be and its words in the snippet", () => {
    const note: NoteSearchResult = { key: "NOTE-n", type: "NOTE", id: "n", title: "امروز", href: "/calendar?day=2026-09-21&item=n", day: "2026-09-21", snippet: "امروز مطالعه کردم" };
    const card = presentSearchResult(note, terms, money);
    expect(card.titleParts.map((p) => p.text).join("")).toContain("۳۰ شهریور ۱۴۰۵");
    expect(card.snippetParts).toEqual([
      { text: "امروز ", match: false },
      { text: "مطالعه", match: true },
      { text: " کردم", match: false },
    ]);
  });

  it("lists the kinds in a fixed order, each with a heading", () => {
    expect(SEARCH_GROUPS.map((g) => g.type)).toEqual(["TASK", "EVENT", "ACTIVITY", "NOTE", "HABIT", "CATEGORY", "INSTALLMENT", "TRANSACTION", "PROJECT", "ASSET"]);
    expect(SEARCH_GROUPS.every((g) => g.heading.length > 0)).toBe(true);
  });
});
