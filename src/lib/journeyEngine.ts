// «مسیر» — turns what a person recorded into the story of their days, in their own voice.
//
// Pure: rows in (src/lib/journeyTypes.ts), prose out. No clock except the `now` it is handed, no randomness
// (wording varies from day to day through a hash of the date, so a day reads the same every time it is opened),
// no data access. The web app and the phone feed it the same rows, so the story is the same everywhere.
//
// The voice is first person — an autobiography, not a report about someone: «ساعت ۹ صبح جلسه داشتم»,
// ««ورزش» را هم انجام دادم». Persian verbs carry no gender, so nothing here needs to know who is reading. It states
// what was recorded and never judges what was not: a habit that was skipped is simply not mentioned, and an empty
// stretch is «یک روز بدون ثبت», not «تنبلی».
import { dayKeyIso, parseDayKey } from "./calendarGrid";
import { MONTHS_FA, WEEKDAYS_FA, jalaliMonthRange, toJalali } from "./jalali";
import { toPersianDigits } from "./money";
import { faCount, joinFa, partOfDay, pickBySeed, quote, spokenDuration, spokenTime, tidy } from "./journeySpoken";
import type {
  JourneyChapter,
  JourneyDay,
  JourneyEntry,
  JourneyEventRow,
  JourneyGap,
  JourneyHabitRow,
  JourneyMilestoneRow,
  JourneyNoteBlock,
  JourneyNoteRow,
  JourneyRows,
  JourneyTaskRow,
  JourneyWorkRow,
} from "./journeyTypes";
import { naturalPhrase } from "./journeyPhrases";

// ---------------------------------------------------------------------------------------------
// Months

export interface JalaliMonth {
  jy: number;
  jm: number;
}

export function jalaliMonthOf(date: Date): JalaliMonth {
  const { jy, jm } = toJalali(date);
  return { jy, jm };
}

export function previousJalaliMonth({ jy, jm }: JalaliMonth): JalaliMonth {
  return jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
}

export function monthKey({ jy, jm }: JalaliMonth): string {
  return `${jy}-${String(jm).padStart(2, "0")}`;
}

/** The instants to ask the data loaders for one month: local midnight of its first day to the last millisecond of its last. */
export function monthRangeIso({ jy, jm }: JalaliMonth): { from: string; to: string } {
  const { start, end } = jalaliMonthRange(jy, jm);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** True when `dayKey` ("YYYY-MM-DD") lies before the first day of the month — used to know when the top of the story is reached. */
export function isBeforeMonth(dayKey: string, { jy, jm }: JalaliMonth): boolean {
  const day = parseDayKey(dayKey);
  if (!day) return false;
  return day.getTime() < jalaliMonthRange(jy, jm).start.getTime();
}

// ---------------------------------------------------------------------------------------------
// Grouping the rows into days (in the reader's own time zone — the calendar's rule)

interface DayBucket {
  events: JourneyEventRow[];
  tasks: JourneyTaskRow[];
  work: JourneyWorkRow[];
  habits: JourneyHabitRow[];
  notes: JourneyNoteRow[];
  milestones: JourneyMilestoneRow[];
}

const emptyBucket = (): DayBucket => ({ events: [], tasks: [], work: [], habits: [], notes: [], milestones: [] });

function groupByDay(rows: JourneyRows): Map<string, DayBucket> {
  const days = new Map<string, DayBucket>();
  const bucket = (key: string) => {
    let b = days.get(key);
    if (!b) days.set(key, (b = emptyBucket()));
    return b;
  };
  for (const e of rows.events) bucket(dayKeyIso(new Date(e.startAt))).events.push(e);
  for (const t of rows.tasks) bucket(dayKeyIso(new Date(t.at))).tasks.push(t);
  for (const w of rows.work) bucket(dayKeyIso(new Date(w.startAt))).work.push(w);
  for (const h of rows.habits) bucket(dayKeyIso(new Date(h.date))).habits.push(h);
  for (const n of rows.notes) bucket(n.day).notes.push(n);
  for (const m of rows.milestones) bucket(dayKeyIso(new Date(m.at))).milestones.push(m);
  return days;
}

const hasContent = (b: DayBucket | undefined): b is DayBucket =>
  !!b && (b.events.length > 0 || b.tasks.length > 0 || b.work.length > 0 || b.habits.length > 0 || b.notes.length > 0 || b.milestones.length > 0);

// ---------------------------------------------------------------------------------------------
// Small building blocks

/** A day's heading: «شنبه ۲۵ مهر». */
export function dayLabel(date: Date): string {
  const { jd, jm } = toJalali(date);
  return `${WEEKDAYS_FA[date.getDay()]} ${toPersianDigits(jd)} ${MONTHS_FA[jm - 1]}`;
}

const cleanTitle = (title: string) => tidy(title) || "بدون عنوان";
const minutesBetween = (start: Date, end: Date) => Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
const dayBefore = (key: string): string | null => {
  const day = parseDayKey(key);
  return day ? dayKeyIso(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1)) : null;
};

/** Wording is picked by the day and the slot, so it varies down the page but never between two renders of the same day. */
const choose = <T>(dayKey: string, slot: string, options: readonly T[]): T => pickBySeed(options, `${dayKey}|${slot}`);

/** A location, set in brackets — it may be «کافه‌ی هشت» or «آنلاین», and brackets read right for both. */
const where = (location: string | null, title: string) => {
  const spot = location ? tidy(location) : "";
  return spot && !tidy(title).includes(spot) ? ` (${spot})` : ""; // «تحویل سایت آتلیه» at «آتلیه» needs no brackets
};

// ---------------------------------------------------------------------------------------------
// Events

const SOCIAL_CATEGORIES = new Set(["خانواده", "تفریح"]);
const SOCIAL_TITLE = /تولد|شام|ناهار|دورهمی|مهمانی|افتتاحیه|سفر|عید|دیدوبازدید/;
/** A family lunch or a birthday is not «time I set aside for» — it just was. */
const isSocial = (e: JourneyEventRow) => (!!e.category && SOCIAL_CATEGORIES.has(e.category)) || SOCIAL_TITLE.test(e.title);

function eventSentence(e: JourneyEventRow, index: number, total: number, dayKey: string, now: Date): string {
  const title = quote(cleanTitle(e.title));
  const place = where(e.location, e.title);
  const start = new Date(e.startAt);
  const end = new Date(e.endAt);
  const future = start.getTime() > now.getTime();
  const social = isSocial(e);
  const slot = `event${index}`;

  if (e.allDay) {
    return future
      ? choose(dayKey, slot, [`${title}${place} امروز در برنامه‌ام است (تمام‌روز).`, `تمام روز ${title}${place} را در پیش دارم.`])
      : choose(dayKey, slot, [`تمام روز ${title}${place} بود.`, `${title}${place} را تمام روز در برنامه داشتم.`, `امروز ${title}${place} داشتم؛ تمام‌روز.`]);
  }

  const time = spokenTime(start);
  const part = partOfDay(start.getHours());
  const duration = spokenDuration(minutesBetween(start, end));

  if (future) {
    const tail = duration ? ` (${duration})` : "";
    return choose(dayKey, slot, [
      `ساعت ${time} ${title}${place} دارم${tail}.`,
      `${title}${place} ساعت ${time} در برنامه‌ام است${tail}.`,
      `${part === "شب" || part === "عصر" ? "بعدتر، " : ""}ساعت ${time} هم ${title}${place} در پیش دارم${tail}.`,
    ]);
  }

  // The first event of a busy morning is what the day started with.
  if (index === 0 && total > 1 && start.getHours() < 11) {
    const tail = duration ? ` و ${duration} طول کشید` : "";
    return `روز با ${title}${place} شروع شد؛ ساعت ${time} بود${tail}.`;
  }

  const after = duration ? `؛ ${duration} طول کشید` : "";
  const andAfter = duration ? ` و ${duration} طول کشید` : "";
  const dash = duration ? ` — ${duration}` : "";
  const connector = index === 0 ? "" : choose(dayKey, `${slot}c`, ["", "", "بعدتر، ", "بعد از آن، ", "سپس "]);
  const variants = social
    ? [`ساعت ${time} ${title}${place} بود${andAfter}.`, `${part} ${title}${place} بود${duration ? `؛ ${duration}` : ""}.`, `ساعت ${time}، ${title}${place}${dash}.`]
    : [
        `ساعت ${time} ${title}${place} داشتم${after}.`,
        `${title}${place} ساعت ${time} بود${andAfter}.`,
        `${part} ${title}${place} داشتم${duration ? `؛ ${duration}` : ""}.`,
        `برای ${title}${place} ساعت ${time} وقت گذاشتم${duration ? `؛ ${duration}` : ""}.`,
      ];
  return connector + choose(dayKey, slot, variants);
}

function eventSentences(events: JourneyEventRow[], dayKey: string, now: Date): string[] {
  const ordered = [...events].sort((a, b) => (a.allDay === b.allDay ? a.startAt.localeCompare(b.startAt) : a.allDay ? -1 : 1));
  return ordered.map((e, i) => eventSentence(e, i, ordered.length, dayKey, now));
}

// ---------------------------------------------------------------------------------------------
// Work and tasks

interface ProjectGroup {
  name: string | null;
  minutes: number;
  tasks: string[];
  sessions: string[];
}

function groupWork(bucket: DayBucket): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const group = (name: string | null) => {
    const key = name ?? "";
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: name ? tidy(name) : null, minutes: 0, tasks: [], sessions: [] }));
    return g;
  };
  for (const w of bucket.work) {
    const g = group(w.project);
    g.minutes += w.minutes;
    const title = cleanTitle(w.title);
    if (!g.sessions.includes(title)) g.sessions.push(title);
  }
  for (const t of bucket.tasks) {
    const g = group(t.project);
    if (t.minutes) g.minutes += t.minutes;
    const title = cleanTitle(t.title);
    if (!g.tasks.includes(title)) g.tasks.push(title);
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes || b.tasks.length - a.tasks.length);
}

const totalMinutes = (groups: ProjectGroup[]) => groups.reduce((sum, g) => sum + g.minutes, 0);

/** How a stretch of work is named: the project when there is one, otherwise what was actually being done. */
const nameOf = (g: ProjectGroup) => (g.name ? quote(g.name) : g.sessions.length > 0 ? quote(g.sessions[0]) : "کارهای دیگر");

/** «حدود سه ساعت روی «سایت آتلیه» کار کردم.» — how the day's tracked time is told. */
function timeSentence(groups: ProjectGroup[], dayKey: string, eventCount: number): string {
  const timed = groups.filter((g) => g.minutes >= 15);
  if (timed.length === 0) return "";
  const lead =
    eventCount === 0
      ? ""
      : eventCount === 1
        ? choose(dayKey, "workLead", ["", "بقیه‌ی روز، ", ""])
        : choose(dayKey, "workLead", ["", "بقیه‌ی روز، ", "در فاصله‌ی این‌ها، ", ""]);

  if (timed.length === 1) {
    const g = timed[0];
    const dur = spokenDuration(g.minutes);
    if (g.name) {
      return lead + choose(dayKey, "work1", [`${dur} روی ${quote(g.name)} کار کردم.`, `${quote(g.name)} ${dur} از وقتم را گرفت.`, `${dur} را به ${quote(g.name)} دادم.`]);
    }
    const titles = g.sessions.slice(0, 3).map(quote);
    return lead + (titles.length > 0 ? `${dur} روی ${joinFa(titles)} کار کردم.` : `${dur} کار کردم.`);
  }

  const [first, second, third] = timed;
  const thirdPart = third ? ` و ${spokenDuration(third.minutes)} روی ${nameOf(third)}` : "";
  // Two stretches of about the same length: nothing was "the most".
  if (second.minutes >= first.minutes * 0.8) {
    return `${lead}${spokenDuration(first.minutes)} روی ${nameOf(first)} و ${spokenDuration(second.minutes)} روی ${nameOf(second)} کار کردم${thirdPart}.`;
  }
  return `${lead}بیشترین وقتم، ${spokenDuration(first.minutes)}، صرف ${nameOf(first)} شد؛ ${spokenDuration(second.minutes)} هم روی ${nameOf(second)} کار کردم${thirdPart}.`;
}

/** ««الف»، «ب» و «ج» را تمام کردم.» — the tasks closed that day, without turning a long list into a wall. */
function tasksSentence(titles: string[], dayKey: string, hasTimeSentence: boolean): string {
  if (titles.length === 0) return "";
  const quoted = titles.map(quote);
  const also = hasTimeSentence ? "هم " : "";
  if (titles.length === 1) {
    return choose(dayKey, "task1", [`${quoted[0]} را ${also}تمام کردم.`, `${quoted[0]} هم از فهرست کارهایم خط خورد.`, `${quoted[0]} را ${also}بستم.`, `یک کار از فهرستم کم شد: ${quoted[0]}.`]);
  }
  if (titles.length <= 4) {
    const list = joinFa(quoted);
    return choose(dayKey, "tasks", [
      `${list} را ${also}تمام کردم.`,
      `از فهرست کارهایم این‌ها خط خورد: ${list}.`,
      `${list} را ${also}بستم.`,
      `کارهای تمام‌شده‌ی امروز: ${list}.`,
      `این‌ها را از سر راه برداشتم: ${list}.`,
    ]);
  }
  const shown = joinFa(quoted.slice(0, 3));
  const rest = titles.length - 3;
  return `${shown} را تمام کردم، و ${faCount(rest)} کار کوچک‌تر دیگر هم بسته شد.`;
}

// ---------------------------------------------------------------------------------------------
// Everyday entries, said the way a person would (see ./journeyPhrases.ts)

interface EverydayEntry {
  text: string;
  travel: boolean;
  minutes: number;
  at: string;
}

/** At most this many are told one by one; a day with more keeps the rest in the ordinary list of finished tasks. */
const MAX_EVERYDAY = 4;

/**
 * Pulls out of the day's tasks and tracked time the entries that read better as a plain sentence — a trip, a
 * purchase, a call — and leaves everything else (anything tied to a project, anything the lexicon does not
 * know) to be told as work. The two halves never overlap, so nothing is said twice.
 */
function splitEveryday(bucket: DayBucket): { everyday: EverydayEntry[]; rest: DayBucket } {
  const everyday: EverydayEntry[] = [];
  const tasks: JourneyTaskRow[] = [];
  const work: JourneyWorkRow[] = [];
  const seen = new Set<string>();
  const take = (title: string, category: string | null, project: string | null, minutes: number, at: string): boolean => {
    if (project || everyday.length >= MAX_EVERYDAY) return false;
    const phrase = naturalPhrase(title, category);
    if (!phrase) return false;
    // The same trip logged as a task and as tracked time is one trip.
    const twin = everyday.find((e) => e.text === phrase.text);
    if (twin) twin.minutes = Math.max(twin.minutes, minutes);
    else if (!seen.has(phrase.text)) everyday.push({ ...phrase, minutes, at });
    seen.add(phrase.text);
    return true;
  };
  for (const t of [...bucket.tasks].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!take(t.title, t.category, t.project, t.minutes ?? 0, t.at)) tasks.push(t);
  }
  for (const w of [...bucket.work].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    if (!take(w.title, w.category, w.project, w.minutes, w.startAt)) work.push(w);
  }
  everyday.sort((a, b) => a.at.localeCompare(b.at));
  return { everyday, rest: { ...bucket, tasks, work } };
}

/** «از تهران به قم حرکت کردم و حدود دو ساعت در راه بودم.» */
function everydaySentences(entries: EverydayEntry[]): string[] {
  return entries.map((e) => {
    if (e.minutes < 15) return `${e.text}.`;
    const dur = spokenDuration(e.minutes);
    return e.travel ? `${e.text} و ${dur} در راه بودم.` : `${e.text}؛ ${dur} طول کشید.`;
  });
}

// ---------------------------------------------------------------------------------------------
// Habits

/** A streak is worth saying aloud at these lengths, not on every single day of it. */
export function isNotableStreak(days: number): boolean {
  return [3, 5, 7, 10, 14, 21].includes(days) || (days >= 30 && days % 30 === 0) || (days >= 50 && days % 50 === 0);
}

const habitKey = (habits: JourneyHabitRow[]) =>
  [...new Set(habits.map((h) => cleanTitle(h.title)))]
    .sort()
    .join("|");

/** The day's habits, in the order they were ticked; and, when it is the same set as yesterday's, said shorter so a good routine does not read like a copy-paste. */
function habitsSentence(habits: JourneyHabitRow[], dayKey: string, sameAsYesterday: boolean, hasActivity: boolean): string {
  if (habits.length === 0) return "";
  const ordered = [...habits].sort((a, b) => a.at.localeCompare(b.at) || a.title.localeCompare(b.title, "fa"));
  const list = joinFa(ordered.map((h) => quote(cleanTitle(h.title))));
  const many = ordered.length >= 2;

  // «هم» and «در کنار کارها» lean on something said before them; on a day with nothing else, the habits are where the day starts.
  let main: string;
  if (sameAsYesterday) {
    main = many
      ? choose(
          dayKey,
          "habitsSame",
          hasActivity
            ? [`${list} هم مثل دیروز انجام شد`, `عادت‌ها هم مثل دیروز: ${list}`, `همان عادت‌های دیروز — ${list} — امروز هم سر جایشان بود`]
            : [`عادت‌ها مثل دیروز: ${list}`, `همان عادت‌های دیروز — ${list} — امروز هم سر جایشان بود`]
        )
      : choose(dayKey, "habitSame", hasActivity ? [`${list} را امروز هم انجام دادم`, `${list} هم مثل دیروز انجام شد`] : [`${list} را امروز هم انجام دادم`, `${list} مثل دیروز انجام شد`]);
  } else if (many) {
    main = choose(
      dayKey,
      "habits",
      hasActivity
        ? [`از عادت‌هایم ${list} را انجام دادم`, `عادت‌هایی که امروز انجام دادم: ${list}`, `${list} را هم انجام دادم`, `در کنار کارها، ${list} هم انجام شد`, `عادت‌های امروزم: ${list}`]
        : [`از عادت‌هایم ${list} را انجام دادم`, `عادت‌هایی که امروز انجام دادم: ${list}`, `عادت‌های امروزم: ${list}`]
    );
  } else {
    main = choose(
      dayKey,
      "habit1",
      hasActivity ? [`${list} را هم انجام دادم`, `از عادت‌هایم ${list} را انجام دادم`, `${list} هم انجام شد`] : [`از عادت‌هایم ${list} را انجام دادم`, `${list} را انجام دادم`, `امروز ${list} را انجام دادم`]
    );
  }

  const notable = [...ordered].sort((a, b) => b.streak - a.streak).find((h) => isNotableStreak(h.streak));
  let streak = "";
  if (notable) {
    const name = quote(cleanTitle(notable.title));
    const n = faCount(notable.streak);
    // With one habit in the sentence the streak is obviously its own: naming it again would say the same word twice.
    const clause = many
      ? choose(dayKey, "streak", [`${name} ${n} روز است که پشت‌سر هم ادامه دارد`, `${name} حالا ${n} روز پیاپی شده است`, `${n} روز است که ${name} را یک روز هم جا نینداخته‌ام`])
      : choose(dayKey, "streak1", [`${n} روز است که پشت‌سر هم ادامه دارد`, `حالا ${n} روز پیاپی شده است`, `${n} روز است که یک روز هم جایش را خالی نگذاشته‌ام`]);
    streak = `؛ ${clause}`;
  }
  return `${main}${streak}.`;
}

// ---------------------------------------------------------------------------------------------
// Landmarks and openings

function milestoneSentence(m: JourneyMilestoneRow, dayKey: string): string {
  const name = quote(cleanTitle(m.name));
  return m.kind === "STARTED"
    ? choose(dayKey, `start-${m.id}`, [`امروز پروژه‌ی ${name} را شروع کردم.`, `${name} از امروز رسماً شروع شد.`, `پروژه‌ی تازه‌ی ${name} را امروز راه انداختم.`])
    : choose(dayKey, `end-${m.id}`, [`پروژه‌ی ${name} به پایان رسید.`, `${name} را تحویل دادم و پروژه بسته شد.`, `امروز پروژه‌ی ${name} را بستم.`]);
}

type DayWeight = "busy" | "normal" | "light";

function weightOf(workMinutes: number, bucket: DayBucket): DayWeight {
  const meetingMinutes = bucket.events.filter((e) => !e.allDay).reduce((sum, e) => sum + minutesBetween(new Date(e.startAt), new Date(e.endAt)), 0);
  if (workMinutes + meetingMinutes >= 360 || bucket.events.length >= 4) return "busy";
  if (workMinutes < 60 && bucket.events.length === 0 && bucket.tasks.length <= 1) return "light";
  return "normal";
}

/** A short lead sentence that gives the day its shape — used on about half the days, so it stays a touch, not a tic. */
function openingSentence(dayKey: string, date: Date, weight: DayWeight, workMinutes: number): string {
  const friday = date.getDay() === 5;
  if (friday) {
    if (workMinutes >= 60) return choose(dayKey, "open", ["جمعه بود، ولی سراغ کار رفتم.", "جمعه بود و با این حال کار کردم."]);
    return choose(dayKey, "open", ["جمعه بود؛ روز تعطیل.", "جمعه بود.", ""]);
  }
  if (weight === "busy") return choose(dayKey, "open", ["روز شلوغی بود.", "امروز سرم حسابی شلوغ بود.", "روز پرکاری داشتم.", "", ""]);
  if (weight === "light") return choose(dayKey, "open", ["روز آرامی بود.", "امروز سرم شلوغ نبود.", "روز سبکی داشتم.", "", ""]);
  return "";
}

// ---------------------------------------------------------------------------------------------
// Notes — the person's own words, kept exactly, introduced by where in the day they were written

function noteBlocks(notes: JourneyNoteRow[], dayKey: string): JourneyNoteBlock[] {
  const ordered = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return ordered.map((n, i) => {
    const hour = new Date(n.createdAt).getHours();
    const part = partOfDay(hour);
    let lead: string;
    if (i > 0) {
      lead = choose(dayKey, `note${i}`, ["و یادداشتی دیگر نوشتم", "بعدتر باز نوشتم", "و باز برای خودم نوشتم"]);
    } else if (part === "بامداد" || (part === "شب" && hour >= 22)) {
      lead = choose(dayKey, "note0", ["آخر شب برای خودم نوشتم", "شبانه، پیش از خواب، نوشتم", "آخر شب در یادداشتم نوشتم"]);
    } else if (part === "شب") {
      lead = choose(dayKey, "note0", ["شب برای خودم نوشتم", "شب که نشستم، نوشتم"]);
    } else if (part === "عصر") {
      lead = choose(dayKey, "note0", ["عصر برای خودم نوشتم", "عصر که فرصتی شد، نوشتم"]);
    } else if (part === "صبح") {
      lead = choose(dayKey, "note0", ["صبح که بلند شدم، نوشتم", "صبح برای خودم نوشتم"]);
    } else {
      lead = choose(dayKey, "note0", ["وسط روز برای خودم نوشتم", "بعدازظهر یادداشتی نوشتم"]);
    }
    return { lead, text: n.text.trim() };
  });
}

// ---------------------------------------------------------------------------------------------
// One day

interface DayContext {
  now: Date;
  earliestDay: string | null;
  /** The day of this month with the most tracked work (at least six hours), when there is one. */
  busiestDay: string | null;
  /** The month is not over yet — «the busiest day so far». */
  partialMonth: boolean;
  /** What was recorded on a given day of the month (undefined outside it). */
  bucketOf: (key: string) => DayBucket | undefined;
}

function composeDay(dayKey: string, bucket: DayBucket, ctx: DayContext): JourneyDay | null {
  if (!hasContent(bucket)) return null;
  const date = parseDayKey(dayKey);
  if (!date) return null;

  const todayKey = dayKeyIso(ctx.now);
  const yesterday = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() - 1);

  // A trip or a purchase is told in its own words and is not counted as «work» in this day's sentences.
  const { everyday, rest } = splitEveryday(bucket);
  const groups = groupWork(rest);
  const workMinutes = totalMinutes(groups);
  const weight = weightOf(workMinutes, bucket);

  // The first thing ever recorded is the birth of the path.
  const isFirstDay = ctx.earliestDay === dayKey;
  const lead: string[] = [];
  if (isFirstDay) lead.push("این اولین روزی است که در برنامه چیزی ثبت کردم؛ مسیر از همین‌جا شروع شد.");
  const opening = openingSentence(dayKey, date, weight, workMinutes);
  if (opening) lead.push(opening);
  for (const m of bucket.milestones) lead.push(milestoneSentence(m, dayKey));

  const calendar = bucket.events.length > 0 ? eventSentences(bucket.events, dayKey, ctx.now) : [];

  const time = timeSentence(groups, dayKey, calendar.length);
  const allTasks = groups.flatMap((g) => g.tasks);
  // A task closed inside tracked time is part of that stretch; the list still names it.
  const tasks = tasksSentence(allTasks, dayKey, time !== "");
  const workSentences = [time, tasks].filter(Boolean);
  const daily = everydaySentences(everyday);
  const hasActivity = calendar.length > 0 || daily.length > 0 || workSentences.length > 0 || bucket.milestones.length > 0;
  if (workSentences.length > 0 && workMinutes >= 240) {
    // One stretch of work already says the whole total: saying the number again would read like a stutter.
    const stretches = groups.filter((g) => g.minutes >= 15);
    const oneStretch = stretches.length === 1 && workMinutes - stretches[0].minutes < 15;
    const record = ctx.partialMonth ? "پرکارترین روز این ماه تا اینجا" : "پرکارترین روز این ماه";
    if (ctx.busiestDay === dayKey) {
      workSentences.push(oneStretch ? `${record} بود.` : `جمعاً ${spokenDuration(workMinutes)} کار ثبت شد — ${record}.`);
    } else if (!oneStretch) {
      const total = spokenDuration(workMinutes);
      workSentences.push(choose(dayKey, "total", [`جمعاً ${total} کار ثبت شد.`, `روی هم رفته ${total} کار کردم.`, `مجموع کار امروز ${total} شد.`]));
    }
  }

  const before = dayBefore(dayKey);
  const yesterdayBucket = before ? ctx.bucketOf(before) : undefined;
  const sameAsYesterday = !!yesterdayBucket && yesterdayBucket.habits.length > 0 && bucket.habits.length > 0 && habitKey(yesterdayBucket.habits) === habitKey(bucket.habits);
  const habit = habitsSentence(bucket.habits, dayKey, sameAsYesterday, hasActivity);

  // What is told about the day's doings flows as one paragraph when it is short, and splits at the calendar/work seam when it is long;
  // the habits always stand in a paragraph of their own. The lead-in never stands alone: it joins the first paragraph after it.
  const doings = [...lead, ...calendar, ...daily, ...workSentences];
  const paragraphs: string[] = [];
  if (doings.length <= 5) {
    if (doings.length > 0) paragraphs.push(doings.join(" "));
  } else {
    const head = [...lead, ...calendar, ...daily];
    if (head.length > 0) paragraphs.push(head.join(" "));
    if (workSentences.length > 0) paragraphs.push(workSentences.join(" "));
  }
  if (habit) paragraphs.push(habit);

  return {
    kind: "day",
    key: dayKey,
    label: dayLabel(date),
    relative: dayKey === todayKey ? "امروز" : dayKey === dayKeyIso(yesterday) ? "دیروز" : null,
    paragraphs,
    notes: noteBlocks(bucket.notes, dayKey),
    landmark: isFirstDay || bucket.milestones.length > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Silence

function gapEntry(fromKey: string, toKey: string, days: number): JourneyGap {
  const from = parseDayKey(fromKey)!;
  const to = parseDayKey(toKey)!;
  const { jd: d1, jm } = toJalali(from);
  const { jd: d2 } = toJalali(to);
  const month = MONTHS_FA[jm - 1];
  const text =
    days === 1
      ? `${toPersianDigits(d1)} ${month} — یک روز بدون ثبت.`
      : `${toPersianDigits(d1)} تا ${toPersianDigits(d2)} ${month} — ${faCount(days)} روز بدون ثبت.`;
  return { kind: "gap", from: fromKey, to: toKey, days, text };
}

// ---------------------------------------------------------------------------------------------
// One month — a chapter

interface MonthStats {
  activeDays: number;
  dayCount: number;
  tasks: number;
  workMinutes: number;
  events: number;
  notes: number;
  projectMinutes: Map<string, number>;
  habitCounts: Map<string, number>;
  longestStreak: { title: string; days: number } | null;
}

function statsOf(days: Array<{ key: string; bucket: DayBucket }>, dayCount: number): MonthStats {
  const stats: MonthStats = { activeDays: 0, dayCount, tasks: 0, workMinutes: 0, events: 0, notes: 0, projectMinutes: new Map(), habitCounts: new Map(), longestStreak: null };
  for (const { bucket } of days) {
    if (!hasContent(bucket)) continue;
    stats.activeDays++;
    stats.tasks += bucket.tasks.length;
    stats.events += bucket.events.length;
    stats.notes += bucket.notes.length;
    const groups = groupWork(bucket);
    stats.workMinutes += totalMinutes(groups);
    for (const g of groups) if (g.name) stats.projectMinutes.set(g.name, (stats.projectMinutes.get(g.name) ?? 0) + g.minutes);
    for (const h of bucket.habits) {
      const title = cleanTitle(h.title);
      stats.habitCounts.set(title, (stats.habitCounts.get(title) ?? 0) + 1);
      if (!stats.longestStreak || h.streak > stats.longestStreak.days) stats.longestStreak = { title, days: h.streak };
    }
  }
  return stats;
}

const topOf = (counts: Map<string, number>) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fa"))[0];

function subtitleOf(stats: MonthStats): string | null {
  const top = topOf(stats.projectMinutes);
  if (!top || stats.workMinutes < 600) return null;
  return top[1] >= stats.workMinutes * 0.45 ? `ماهِ ${quote(top[0])}` : null;
}

function summaryOf(stats: MonthStats, monthName: string, partial: boolean): string | null {
  if (stats.activeDays === 0) return null;
  const sentences: string[] = [];

  const scope = partial ? `در ${monthName}، تا امروز،` : `در ${monthName}`;
  const everyDay = stats.activeDays === stats.dayCount && stats.dayCount >= 5;
  const daysPart = everyDay ? `${scope} هر روز چیزی ثبت کردم` : `${scope} ${faCount(stats.activeDays)} روز چیزی ثبت کردم`;

  const top = topOf(stats.projectMinutes);
  const workDur = spokenDuration(stats.workMinutes);
  let workPart = "";
  if (stats.tasks > 0 && stats.workMinutes >= 60) {
    workPart = `؛ ${faCount(stats.tasks)} کار را تمام کردم و ${workDur} کار ثبت شد${top ? `، بیشترش روی ${quote(top[0])}` : ""}`;
  } else if (stats.tasks > 0) {
    workPart = `؛ ${faCount(stats.tasks)} کار را تمام کردم`;
  } else if (stats.workMinutes >= 60) {
    workPart = `؛ ${workDur} کار ثبت شد${top ? `، بیشترش روی ${quote(top[0])}` : ""}`;
  }
  sentences.push(`${daysPart}${workPart}.`);

  const habit = topOf(stats.habitCounts);
  if (habit) {
    let text = `${quote(habit[0])} ${faCount(habit[1])} بار انجام شد`;
    const streak = stats.longestStreak;
    if (streak && streak.days >= 7) {
      text +=
        streak.title === habit[0]
          ? ` و یک‌بار به ${faCount(streak.days)} روز پشت‌سر هم رسید`
          : `؛ ${quote(streak.title)} هم یک‌بار به ${faCount(streak.days)} روز پشت‌سر هم رسید`;
    }
    sentences.push(`${text}.`);
  }

  const tail: string[] = [];
  if (stats.events >= 3) tail.push(`${faCount(stats.events)} قرار و رویداد در تقویمم بود`);
  if (stats.notes > 0) tail.push(`${faCount(stats.notes)} یادداشت برای خودم نوشتم`);
  if (tail.length > 0) sentences.push(`${joinFa(tail)}.`);

  return sentences.join(" ");
}

export interface BuildChapterInput {
  month: JalaliMonth;
  rows: JourneyRows;
  now: Date;
}

/** One Jalali month as a chapter of the story: its days told in order, silent stretches folded, and a summary of the whole. */
export function buildChapter({ month, rows, now }: BuildChapterInput): JourneyChapter {
  const { start, end } = jalaliMonthRange(month.jy, month.jm);
  const grouped = groupByDay(rows);

  const todayKey = dayKeyIso(now);
  const firstKey = rows.earliestDay && rows.earliestDay > dayKeyIso(start) ? rows.earliestDay : dayKeyIso(start);
  const lastKey = dayKeyIso(end) < todayKey ? dayKeyIso(end) : todayKey;
  const partial = dayKeyIso(end) > todayKey;

  // The busiest day of the month, for the one sentence that says so.
  let busiestDay: string | null = null;
  let busiestMinutes = 0;
  for (const [key, bucket] of grouped) {
    if (key < firstKey || key > lastKey) continue;
    const minutes = totalMinutes(groupWork(bucket));
    if (minutes > busiestMinutes) {
      busiestMinutes = minutes;
      busiestDay = key;
    }
  }
  if (busiestMinutes < 360) busiestDay = null;

  const ctx: DayContext = { now, earliestDay: rows.earliestDay, busiestDay, partialMonth: partial, bucketOf: (key) => grouped.get(key) };

  // Nothing has ever been recorded: the story has not begun, and folding a whole month into «no records» would say nothing.
  const nothingYet = rows.earliestDay === null && grouped.size === 0;

  const entries: JourneyEntry[] = [];
  const perDay: Array<{ key: string; bucket: DayBucket }> = [];
  // Consecutive days with nothing recorded, folded into one quiet line when a day with something (or the end) comes.
  let silent: string[] = [];
  const flushSilence = () => {
    if (silent.length > 0) entries.push(gapEntry(silent[0], silent[silent.length - 1], silent.length));
    silent = [];
  };

  for (let cursor = nothingYet ? null : parseDayKey(firstKey); cursor && dayKeyIso(cursor) <= lastKey; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
    const key = dayKeyIso(cursor);
    const bucket = grouped.get(key) ?? emptyBucket();
    perDay.push({ key, bucket });
    const day = composeDay(key, bucket, ctx);
    if (day) {
      flushSilence();
      entries.push(day);
    } else if (key !== todayKey) {
      // Today with nothing yet is not a silence — the day is still going.
      silent.push(key);
    }
  }
  flushSilence();
  const dayCount = perDay.length;

  const stats = statsOf(perDay, dayCount);
  const monthName = MONTHS_FA[month.jm - 1];

  return {
    key: monthKey(month),
    jy: month.jy,
    jm: month.jm,
    title: `${monthName} ${toPersianDigits(month.jy)}`,
    subtitle: subtitleOf(stats),
    summary: summaryOf(stats, monthName, partial),
    entries,
    hasContent: stats.activeDays > 0,
  };
}
