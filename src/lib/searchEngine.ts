// The search, minus the database. Three steps, the two in the middle shared by the server (Prisma) and
// the phone (SQLite) so they answer identically:
//   1. each side lists LIGHT candidates (id, title, a date to rank by) — pickCandidateIds below chooses
//      which ones match, comparing NORMALIZED text (Arabic ي/ك written as ی/ک, Persian and Arabic digits
//      as ASCII, half-spaces and diacritics dropped, upper case lowered), so «میخوانم» finds «می‌خوانم»;
//   2. each side loads the full rows of just those;
//   3. buildSearchResults turns them into what the screen shows: for a task or event its day, hours,
//      length, hidden cost and money; for a habit or category the days done and time spent; for an
//      installment plan what is paid, what is left and when the next one falls due; for a note the
//      words around the match — and where tapping it should go.
import { dayKeyIso } from "./calendarGrid";
import { computeTimeCost } from "./timeCost";
import { summarizeInstallments } from "./installments";

// ---------------------------------------------------------------------------------------------
// Normalisation

const LETTER_MAP: Record<string, string> = {
  "ي": "ی",
  "ى": "ی",
  "ئ": "ی",
  "ك": "ک",
  "ۀ": "ه",
  "ة": "ه",
  "أ": "ا",
  "إ": "ا",
  "ٱ": "ا",
  "آ": "ا",
  "ؤ": "و",
};

/** One character's normal form; "" drops it (half-space, tatweel, marks and diacritics). */
function normalizeChar(ch: string): string {
  const code = ch.charCodeAt(0);
  if (ch === "‌" || ch === "‍" || ch === "‎" || ch === "‏" || ch === "ـ") return "";
  if ((code >= 0x064b && code <= 0x065f) || code === 0x0670) return "";
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  return LETTER_MAP[ch] ?? ch.toLowerCase();
}

/** The normal form of `text`, and for every character of it where that character sits in the original. */
export function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let lastWasSpace = true; // also trims leading white space
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        out += " ";
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    const normal = normalizeChar(ch);
    for (const piece of normal) {
      out += piece;
      map.push(i);
    }
    if (normal) lastWasSpace = false;
  }
  if (out.endsWith(" ")) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

export function normalizeSearchText(text: string): string {
  return normalizeWithMap(text).text;
}

/** The words of a query, normalized; an empty list when there is nothing to look for. */
export function queryTerms(query: string): string[] {
  return Array.from(new Set(normalizeSearchText(query).split(" ").filter(Boolean)));
}

/** Every term of the query appears somewhere in the (normalized) text of the given fields. */
export function matchesTerms(terms: string[], ...texts: Array<string | null | undefined>): boolean {
  if (terms.length === 0) return false;
  const haystack = normalizeSearchText(texts.filter(Boolean).join(" "));
  return terms.every((t) => haystack.includes(t));
}

/** 0 the title IS the query, 1 it starts with it, 2 a word of it does, 3 it merely contains it. Lower is better. */
export function relevance(terms: string[], title: string): number {
  const normal = normalizeSearchText(title);
  const phrase = terms.join(" ");
  if (normal === phrase) return 0;
  if (normal.startsWith(terms[0])) return 1;
  if (terms.some((t) => normal.includes(` ${t}`))) return 2;
  return 3;
}

/** Where the terms sit in the ORIGINAL text, as sorted, non-overlapping [start, end) ranges. */
export function matchRanges(text: string, terms: string[]): Array<[number, number]> {
  const { text: normal, map } = normalizeWithMap(text);
  const found: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = normal.indexOf(term, from);
      if (at < 0) break;
      found.push([map[at], map[at + term.length - 1] + 1]);
      from = at + term.length;
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

/** `text` cut into pieces, the ones that match the query flagged — for drawing the match highlighted. */
export function highlightParts(text: string, terms: string[]): Array<{ text: string; match: boolean }> {
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of matchRanges(text, terms)) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

/** A few words either side of the first match, with … where the text was cut. */
export function snippetAround(text: string, terms: string[], radius = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const [first] = matchRanges(flat, terms);
  if (!first) return flat.slice(0, radius * 2);
  const from = Math.max(0, first[0] - radius);
  const to = Math.min(flat.length, first[1] + radius);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------------------------
// Step 1 — which candidates match

type DateLike = Date | string;

export interface SearchCandidates {
  tasks: Array<{ id: string; title: string; description?: string | null; sortAt: DateLike }>;
  events: Array<{ id: string; title: string; description?: string | null; location?: string | null; sortAt: DateLike }>;
  activities: Array<{ id: string; title: string; notes?: string | null; sortAt: DateLike }>;
  notes: Array<{ id: string; day: string; content: string }>;
  transactions: Array<{ id: string; description?: string | null; sortAt: DateLike }>;
  habits: Array<{ id: string; title: string }>;
  categories: Array<{ id: string; name: string }>;
  plans: Array<{ id: string; title: string; notes?: string | null }>;
  projects: Array<{ id: string; name: string }>;
  assets: Array<{ id: string; name: string }>;
}

export interface MatchedIds {
  tasks: string[];
  events: string[];
  activities: string[];
  notes: string[];
  transactions: string[];
  habits: string[];
  categories: string[];
  plans: string[];
  projects: string[];
  assets: string[];
}

/** How many of each kind one search returns. */
export const SEARCH_LIMITS = { tasks: 8, events: 6, activities: 5, notes: 6, transactions: 5, habits: 5, categories: 5, plans: 5, projects: 3, assets: 3 } as const;

function time(value: DateLike): number {
  return new Date(value).getTime();
}

function pick<T extends { id: string }>(terms: string[], rows: T[], texts: (row: T) => Array<string | null | undefined>, title: (row: T) => string, limit: number, recency?: (row: T) => number): string[] {
  return rows
    .filter((row) => matchesTerms(terms, ...texts(row)))
    .map((row) => ({ id: row.id, rank: relevance(terms, title(row)), at: recency ? recency(row) : 0 }))
    .sort((a, b) => a.rank - b.rank || b.at - a.at)
    .slice(0, limit)
    .map((row) => row.id);
}

export function pickCandidateIds(query: string, c: SearchCandidates): MatchedIds {
  const terms = queryTerms(query);
  if (terms.length === 0) return { tasks: [], events: [], activities: [], notes: [], transactions: [], habits: [], categories: [], plans: [], projects: [], assets: [] };
  return {
    tasks: pick(terms, c.tasks, (r) => [r.title, r.description], (r) => r.title, SEARCH_LIMITS.tasks, (r) => time(r.sortAt)),
    events: pick(terms, c.events, (r) => [r.title, r.description, r.location], (r) => r.title, SEARCH_LIMITS.events, (r) => time(r.sortAt)),
    activities: pick(terms, c.activities, (r) => [r.title, r.notes], (r) => r.title, SEARCH_LIMITS.activities, (r) => time(r.sortAt)),
    notes: pick(terms, c.notes, (r) => [r.content], (r) => r.content, SEARCH_LIMITS.notes, (r) => time(`${r.day}T00:00:00`)),
    transactions: pick(terms, c.transactions, (r) => [r.description], (r) => r.description ?? "", SEARCH_LIMITS.transactions, (r) => time(r.sortAt)),
    habits: pick(terms, c.habits, (r) => [r.title], (r) => r.title, SEARCH_LIMITS.habits),
    categories: pick(terms, c.categories, (r) => [r.name], (r) => r.name, SEARCH_LIMITS.categories),
    plans: pick(terms, c.plans, (r) => [r.title, r.notes], (r) => r.title, SEARCH_LIMITS.plans),
    projects: pick(terms, c.projects, (r) => [r.name], (r) => r.name, SEARCH_LIMITS.projects),
    assets: pick(terms, c.assets, (r) => [r.name], (r) => r.name, SEARCH_LIMITS.assets),
  };
}

// ---------------------------------------------------------------------------------------------
// Step 3 — what the screen shows

export interface SearchCategoryRef {
  name: string;
  icon: string | null;
}

export interface SearchRows {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: DateLike | null;
    startAt: DateLike | null;
    endAt: DateLike | null;
    createdAt: DateLike;
    directCost: number;
    incomeAmount: number;
    category?: SearchCategoryRef | null;
  }>;
  events: Array<{
    id: string;
    title: string;
    allDay: boolean;
    startAt: DateLike;
    endAt: DateLike;
    recurrenceFreq: string;
    directCost: number;
    incomeAmount: number;
    isDone?: boolean;
    category?: SearchCategoryRef | null;
  }>;
  activities: Array<{ id: string; title: string; totalDurationMin: number; directCost: number; category?: SearchCategoryRef | null }>;
  notes: Array<{ id: string; day: string; content: string }>;
  transactions: Array<{ id: string; type: string; amount: number; date: DateLike; description?: string | null; category?: SearchCategoryRef | null }>;
  habits: Array<{ id: string; title: string; icon?: string | null; categoryId?: string | null; category?: SearchCategoryRef | null }>;
  categories: Array<{ id: string; name: string; icon?: string | null }>;
  plans: Array<{ id: string; title: string; installments: Array<{ amount: number; status: string; dueDate: DateLike }> }>;
  projects: Array<{ id: string; name: string }>;
  assets: Array<{ id: string; name: string }>;
  /** Every finished time entry of the matched activities. */
  activityEntries: Array<{ activityId: string; date: DateLike; minutes: number }>;
  /** Every check-in of the matched habits. */
  habitCheckIns: Array<{ habitId: string; date: DateLike; durationMin: number | null }>;
  /** Every stretch of logged time in the matched categories (tasks, finished events, time entries, habit check-ins). */
  categoryLogs: Array<{ categoryId: string; date: DateLike; minutes: number }>;
  /** Toman per hour, for what an hour of the person's time costs. */
  hourlyValue: number;
}

interface ResultBase {
  key: string;
  id: string;
  title: string;
  /** Where tapping it goes. */
  href: string;
}

/** A task or an event: what it was, when, for how long, what it cost and what it cost in time. */
export interface TimedSearchResult extends ResultBase {
  type: "TASK" | "EVENT";
  /** The local day (YYYY-MM-DD) it belongs to. */
  day: string;
  start: string | null;
  end: string | null;
  durationMin: number | null;
  done: boolean;
  recurring: boolean;
  category: SearchCategoryRef | null;
  directCost: number;
  incomeAmount: number;
  /** What the time it took is worth at the person's hourly value. */
  timeCost: number;
  /** "هزینه پنهان": the money spent plus the value of the time (see computeHiddenCostReport). */
  hiddenCost: number;
}

/** An activity (a timed piece of work started from a timer): its total time and the money it cost. */
export interface ActivitySearchResult extends ResultBase {
  type: "ACTIVITY";
  doneDays: number;
  totalMinutes: number;
  lastDay: string | null;
  category: SearchCategoryRef | null;
  directCost: number;
  timeCost: number;
  hiddenCost: number;
}

export interface NoteSearchResult extends ResultBase {
  type: "NOTE";
  day: string;
  snippet: string;
}

/** A habit or a category, with how much of the person's life it holds. */
export interface StatsSearchResult extends ResultBase {
  type: "HABIT" | "CATEGORY";
  icon: string | null;
  /** Distinct days something was done. */
  doneDays: number;
  totalMinutes: number;
  /** The last day something was done (YYYY-MM-DD), for opening the calendar on the right month. */
  lastDay: string | null;
}

export interface PlanSearchResult extends ResultBase {
  type: "INSTALLMENT";
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  paidCount: number;
  totalCount: number;
  nextDueDate: string | null;
}

export interface TransactionSearchResult extends ResultBase {
  type: "TRANSACTION";
  txType: string;
  amount: number;
  day: string;
  category: SearchCategoryRef | null;
}

export interface SimpleSearchResult extends ResultBase {
  type: "PROJECT" | "ASSET";
}

export type SearchResult = TimedSearchResult | ActivitySearchResult | NoteSearchResult | StatsSearchResult | PlanSearchResult | TransactionSearchResult | SimpleSearchResult;

const iso = (value: DateLike): string => new Date(value).toISOString();
const minutesBetween = (a: DateLike, b: DateLike): number => Math.max(0, Math.round((time(b) - time(a)) / 60000));
const calendarHref = (day: string, id?: string) => `/calendar?day=${day}${id ? `&item=${encodeURIComponent(id)}` : ""}`;

function statsFor(days: Set<string>, minutes: number): { doneDays: number; totalMinutes: number; lastDay: string | null } {
  const sorted = Array.from(days).sort();
  return { doneDays: days.size, totalMinutes: minutes, lastDay: sorted.length ? sorted[sorted.length - 1] : null };
}

function calendarOf(categoryId: string | null | undefined, lastDay: string | null): string | null {
  if (!categoryId) return null;
  return `/reports?tab=categoryCalendar&category=${encodeURIComponent(categoryId)}${lastDay ? `&day=${lastDay}` : ""}`;
}

export function buildSearchResults(query: string, rows: SearchRows): SearchResult[] {
  const terms = queryTerms(query);
  const results: SearchResult[] = [];

  for (const t of rows.tasks) {
    const timed = t.startAt && t.endAt ? minutesBetween(t.startAt, t.endAt) : null;
    const durationMin = timed && timed > 0 ? timed : null;
    const timeCost = durationMin ? computeTimeCost(durationMin, rows.hourlyValue) : 0;
    const day = dayKeyIso(new Date(t.startAt ?? t.dueDate ?? t.createdAt));
    results.push({
      key: `TASK-${t.id}`,
      type: "TASK",
      id: t.id,
      title: t.title,
      href: calendarHref(day, t.id),
      day,
      start: t.startAt ? iso(t.startAt) : null,
      end: t.endAt ? iso(t.endAt) : null,
      durationMin,
      done: t.status === "DONE",
      recurring: false,
      category: t.category ?? null,
      directCost: t.directCost,
      incomeAmount: t.incomeAmount,
      timeCost,
      hiddenCost: t.directCost + timeCost,
    });
  }

  for (const e of rows.events) {
    const durationMin = e.allDay ? null : minutesBetween(e.startAt, e.endAt) || null;
    const timeCost = durationMin ? computeTimeCost(durationMin, rows.hourlyValue) : 0;
    const day = dayKeyIso(new Date(e.startAt));
    results.push({
      key: `EVENT-${e.id}`,
      type: "EVENT",
      id: e.id,
      title: e.title,
      href: calendarHref(day, e.id),
      day,
      start: e.allDay ? null : iso(e.startAt),
      end: e.allDay ? null : iso(e.endAt),
      durationMin,
      done: !!e.isDone,
      recurring: e.recurrenceFreq !== "NONE",
      category: e.category ?? null,
      directCost: e.directCost,
      incomeAmount: e.incomeAmount,
      timeCost,
      hiddenCost: e.directCost + timeCost,
    });
  }

  const entriesByActivity = new Map<string, Array<{ date: DateLike; minutes: number }>>();
  for (const e of rows.activityEntries) {
    const list = entriesByActivity.get(e.activityId) ?? [];
    list.push(e);
    entriesByActivity.set(e.activityId, list);
  }
  for (const a of rows.activities) {
    const entries = entriesByActivity.get(a.id) ?? [];
    const stats = statsFor(new Set(entries.map((e) => dayKeyIso(new Date(e.date)))), a.totalDurationMin || entries.reduce((sum, e) => sum + e.minutes, 0));
    const timeCost = computeTimeCost(stats.totalMinutes, rows.hourlyValue);
    results.push({
      key: `ACTIVITY-${a.id}`,
      type: "ACTIVITY",
      id: a.id,
      title: a.title,
      href: stats.lastDay ? calendarHref(stats.lastDay) : "/calendar",
      ...stats,
      category: a.category ?? null,
      directCost: a.directCost,
      timeCost,
      hiddenCost: a.directCost + timeCost,
    });
  }

  for (const n of rows.notes) {
    results.push({ key: `NOTE-${n.id}`, type: "NOTE", id: n.id, title: snippetTitle(n.content), href: calendarHref(n.day, n.id), day: n.day, snippet: snippetAround(n.content, terms) });
  }

  const checkInsByHabit = new Map<string, Array<{ date: DateLike; durationMin: number | null }>>();
  for (const c of rows.habitCheckIns) {
    const list = checkInsByHabit.get(c.habitId) ?? [];
    list.push(c);
    checkInsByHabit.set(c.habitId, list);
  }
  for (const h of rows.habits) {
    const list = checkInsByHabit.get(h.id) ?? [];
    const stats = statsFor(new Set(list.map((c) => dayKeyIso(new Date(c.date)))), list.reduce((sum, c) => sum + (c.durationMin ?? 0), 0));
    results.push({
      key: `HABIT-${h.id}`,
      type: "HABIT",
      id: h.id,
      title: h.title,
      icon: h.icon ?? null,
      // Into the category the habit belongs to, on the calendar of that category; a habit with no category has no such calendar.
      href: calendarOf(h.categoryId, stats.lastDay) ?? "/habits",
      ...stats,
    });
  }

  const logsByCategory = new Map<string, Array<{ date: DateLike; minutes: number }>>();
  for (const l of rows.categoryLogs) {
    const list = logsByCategory.get(l.categoryId) ?? [];
    list.push(l);
    logsByCategory.set(l.categoryId, list);
  }
  for (const c of rows.categories) {
    const list = (logsByCategory.get(c.id) ?? []).filter((l) => l.minutes > 0);
    const stats = statsFor(new Set(list.map((l) => dayKeyIso(new Date(l.date)))), list.reduce((sum, l) => sum + l.minutes, 0));
    results.push({
      key: `CATEGORY-${c.id}`,
      type: "CATEGORY",
      id: c.id,
      title: c.name,
      icon: c.icon ?? null,
      href: calendarOf(c.id, stats.lastDay) ?? "/settings?tab=categories",
      ...stats,
    });
  }

  for (const p of rows.plans) {
    const summary = summarizeInstallments(p.installments.map((i) => ({ amount: i.amount, status: i.status, dueDate: new Date(i.dueDate) })));
    results.push({
      key: `INSTALLMENT-${p.id}`,
      type: "INSTALLMENT",
      id: p.id,
      title: p.title,
      href: `/finance?tab=installments&plan=${encodeURIComponent(p.id)}`,
      totalAmount: summary.totalAmount,
      paidAmount: summary.paidAmount,
      unpaidAmount: summary.remainingAmount,
      paidCount: summary.paidCount,
      totalCount: summary.totalCount,
      nextDueDate: summary.nextDueDate ? summary.nextDueDate.toISOString() : null,
    });
  }

  for (const t of rows.transactions) {
    const day = dayKeyIso(new Date(t.date));
    results.push({
      key: `TRANSACTION-${t.id}`,
      type: "TRANSACTION",
      id: t.id,
      title: t.description || t.category?.name || "تراکنش",
      href: calendarHref(day),
      txType: t.type,
      amount: t.amount,
      day,
      category: t.category ?? null,
    });
  }

  for (const p of rows.projects) results.push({ key: `PROJECT-${p.id}`, type: "PROJECT", id: p.id, title: p.name, href: `/projects/detail?id=${encodeURIComponent(p.id)}` });
  for (const a of rows.assets) results.push({ key: `ASSET-${a.id}`, type: "ASSET", id: a.id, title: a.name, href: `/assets?highlight=${encodeURIComponent(a.id)}` });

  return results;
}

/** A note has no title: its first line stands in for one. */
function snippetTitle(content: string): string {
  const first = content.split("\n").find((line) => line.trim()) ?? "";
  return first.trim().slice(0, 60);
}
