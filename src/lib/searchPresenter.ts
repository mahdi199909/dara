// How a search result reads on screen: the kind, the title with the matched words marked, and the
// facts worth having in the list itself — so the person rarely has to open anything to learn what
// they were looking for. Pure (money formatting comes in as a function), so it is tested without a screen.
import { parseDayKey } from "./calendarGrid";
import { formatJalali, formatTime } from "./jalali";
import { formatDuration, toPersianDigits } from "./money";
import { highlightParts, type SearchResult } from "./searchEngine";

export type SearchFactTone = "positive" | "negative" | "accent";

export interface SearchFact {
  label: string;
  value: string;
  tone?: SearchFactTone;
}

export interface SearchCard {
  key: string;
  type: SearchResult["type"];
  typeLabel: string;
  /** An emoji or symbol drawn before the title, when the thing has one. */
  icon: string | null;
  titleParts: Array<{ text: string; match: boolean }>;
  /** Small marks beside the title ("انجام‌شده", "تکرارشونده"). */
  badges: string[];
  /** For a note: the words around the match. */
  snippetParts: Array<{ text: string; match: boolean }> | null;
  facts: SearchFact[];
  href: string;
}

export const SEARCH_TYPE_LABEL: Record<SearchResult["type"], string> = {
  TASK: "کار",
  EVENT: "رویداد",
  ACTIVITY: "فعالیت",
  NOTE: "نوت",
  HABIT: "عادت",
  CATEGORY: "دسته‌بندی",
  INSTALLMENT: "قسط",
  TRANSACTION: "تراکنش",
  PROJECT: "پروژه",
  ASSET: "دارایی",
};

/** The order the kinds are listed in, and the heading each group gets. */
export const SEARCH_GROUPS: Array<{ type: SearchResult["type"]; heading: string }> = [
  { type: "TASK", heading: "کارها" },
  { type: "EVENT", heading: "رویدادها" },
  { type: "ACTIVITY", heading: "فعالیت‌ها" },
  { type: "NOTE", heading: "نوت‌ها" },
  { type: "HABIT", heading: "عادت‌ها" },
  { type: "CATEGORY", heading: "دسته‌بندی‌ها" },
  { type: "INSTALLMENT", heading: "اقساط" },
  { type: "TRANSACTION", heading: "تراکنش‌ها" },
  { type: "PROJECT", heading: "پروژه‌ها" },
  { type: "ASSET", heading: "دارایی‌ها" },
];

function dayText(key: string): string {
  const date = parseDayKey(key);
  return date ? formatJalali(date, { withWeekday: true, long: true }) : key;
}

export function presentSearchResult(result: SearchResult, terms: string[], money: (amount: number) => string): SearchCard {
  const card: SearchCard = {
    key: result.key,
    type: result.type,
    typeLabel: SEARCH_TYPE_LABEL[result.type],
    icon: null,
    titleParts: highlightParts(result.title, terms),
    badges: [],
    snippetParts: null,
    facts: [],
    href: result.href,
  };

  switch (result.type) {
    case "TASK":
    case "EVENT": {
      const hours = result.start ? `${formatTime(new Date(result.start))}${result.end ? ` – ${formatTime(new Date(result.end))}` : ""}` : null;
      card.icon = result.category?.icon ?? null;
      if (result.done) card.badges.push("انجام‌شده");
      if (result.recurring) card.badges.push("تکرارشونده");
      card.facts.push({ label: "زمان", value: [dayText(result.day), hours].filter(Boolean).join(" · ") });
      if (result.durationMin) card.facts.push({ label: "مدت", value: formatDuration(result.durationMin) });
      // The hidden part is what the time was worth; with no hourly value set there is none, and the
      // "cost" below already says everything (repeating the same sum under two names would only confuse).
      if (result.timeCost > 0) card.facts.push({ label: "هزینه پنهان", value: money(result.hiddenCost), tone: "negative" });
      if (result.directCost > 0) card.facts.push({ label: "هزینه", value: money(result.directCost), tone: "negative" });
      if (result.incomeAmount > 0) card.facts.push({ label: "درآمد", value: money(result.incomeAmount), tone: "positive" });
      if (result.category) card.facts.push({ label: "دسته‌بندی", value: result.category.name });
      break;
    }
    case "ACTIVITY":
      card.icon = result.category?.icon ?? null;
      card.facts.push({ label: "روزهای ثبت", value: `${toPersianDigits(result.doneDays)} روز`, tone: result.doneDays > 0 ? "accent" : undefined });
      card.facts.push({ label: "مجموع زمان", value: result.totalMinutes > 0 ? formatDuration(result.totalMinutes) : "—" });
      if (result.timeCost > 0) card.facts.push({ label: "هزینه پنهان", value: money(result.hiddenCost), tone: "negative" });
      if (result.directCost > 0) card.facts.push({ label: "هزینه", value: money(result.directCost), tone: "negative" });
      if (result.lastDay) card.facts.push({ label: "آخرین بار", value: dayText(result.lastDay) });
      break;
    case "NOTE":
      card.snippetParts = highlightParts(result.snippet, terms);
      // A note has no title of its own; the snippet is the point, so the heading is the day.
      card.titleParts = [{ text: dayText(result.day), match: false }];
      break;
    case "HABIT":
    case "CATEGORY":
      card.icon = result.icon;
      card.facts.push({ label: "روزهای انجام", value: `${toPersianDigits(result.doneDays)} روز`, tone: result.doneDays > 0 ? "accent" : undefined });
      card.facts.push({ label: "مجموع زمان", value: result.totalMinutes > 0 ? formatDuration(result.totalMinutes) : "—" });
      if (result.lastDay) card.facts.push({ label: "آخرین بار", value: dayText(result.lastDay) });
      break;
    case "INSTALLMENT":
      card.facts.push({ label: "مجموع اقساط", value: money(result.totalAmount) });
      card.facts.push({ label: `پرداخت‌شده (${toPersianDigits(result.paidCount)} از ${toPersianDigits(result.totalCount)})`, value: money(result.paidAmount), tone: "positive" });
      card.facts.push({ label: "پرداخت‌نشده", value: money(result.unpaidAmount), tone: result.unpaidAmount > 0 ? "negative" : undefined });
      card.facts.push({ label: "نزدیک‌ترین سررسید", value: result.nextDueDate ? formatJalali(new Date(result.nextDueDate), { long: true }) : "—" });
      break;
    case "TRANSACTION":
      card.icon = result.category?.icon ?? null;
      card.facts.push({ label: result.txType === "INCOME" ? "درآمد" : result.txType === "EXPENSE" ? "هزینه" : "مبلغ", value: money(result.amount), tone: result.txType === "INCOME" ? "positive" : result.txType === "EXPENSE" ? "negative" : undefined });
      card.facts.push({ label: "تاریخ", value: dayText(result.day) });
      break;
    default:
      break;
  }

  return card;
}
