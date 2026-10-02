// «حسابرسی ۵ دقیقه‌ای» (parvaapp.ir/checkup) — the rules shared by the server and the owner's dashboard.
//
// The static page computes the same numbers in the browser (doc/landing/site/checkup/calc.js) so a
// respondent sees their report even when this server is down; checkup.parity.test.ts runs both on the same
// fixtures, so the number a person saw is the number the dashboard counts. The server never trusts the
// browser's numbers: every derived column is recomputed here from the raw answers.
//
// Question wording and option text are copied verbatim from doc/checkup/market-test-kit.md §4 — changing a
// word changes the data. Pure module: no Prisma, no Node APIs (the dashboard page imports it).
import { z } from "zod";

// ---------------------------------------------------------------------------
// Options (key → the kit's exact label)
// ---------------------------------------------------------------------------

export const OPTIONS = {
  rest: {
    scattered: "کارهای ریز و پراکنده",
    phone: "موبایل و شبکه‌های اجتماعی",
    commute: "رفت‌وآمد",
    rest: "استراحت و کارهای شخصی",
    forgot: "راستش دقیق یادم نیست",
    unsure: "مطمئن نیستم چطور گذشت",
  },
  monthSpend: {
    exact: "عدد دقیقش رو می‌گم، چون ثبت می‌کنم",
    memory: "یه عدد تقریبی از حافظه می‌گم",
    bank: "باید اپ بانکم رو باز کنم و جمع بزنم",
    dontknow: "راستش نمی‌دونم",
  },
  tools: {
    paper: "دفتر یا کاغذ",
    sheet: "اکسل / گوگل‌شیت",
    notes: "یادداشت گوشی",
    saved: "سیو مسیج تلگرام",
    iranApp: "اپ حسابداری شخصی ایرانی",
    foreignApp: "اپ خارجی",
    gcal: "تقویم گوگل",
    notion: "نوشن / تودویست / تراِلو و مشابه",
    none: "هیچ‌کدوم",
  },
  toolLastOpened: {
    today: "امروز",
    week: "این هفته",
    month: "این ماه",
    older: "بیشتر از یک ماه پیش",
    stopped: "دیگه اصلاً استفاده نمی‌کنم",
  },
  paid: {
    several: "آره، چند بار",
    once: "آره، یک بار",
    almost: "نه، ولی نزدیک بود",
    never: "نه، هیچ‌وقت",
  },
  builtHours: {
    approx: "عدد تقریبی دارم",
    guess: "می‌تونم حدس بزنم ولی مطمئن نیستم",
    dontknow: "اصلاً نمی‌دونم",
  },
  lastEmpty: {
    thisMonth: "همین ماه",
    months: "چند ماه پیش",
    longAgo: "خیلی وقت پیش",
    never: "این حس رو ندارم",
  },
  income: {
    salary: "حقوق ثابت ماهانه",
    project: "پروژه‌ای و متغیر",
    mixed: "ترکیبی از هر دو",
    none: "هنوز درآمد مستقل ندارم",
  },
  dependents: {
    self: "فقط خودم",
    family: "خانواده",
    team: "یه تیم کوچک",
    more: "بیشتر",
  },
  interview: {
    yes: "بله",
    no: "نه",
  },
} as const;

type Key<T extends keyof typeof OPTIONS> = keyof (typeof OPTIONS)[T] & string;
const keysOf = <T extends keyof typeof OPTIONS>(q: T) => Object.keys(OPTIONS[q]) as [Key<T>, ...Key<T>[]];

/** س۳ answers that mean «I can't account for it» — the kit's headline measure for ت۱. */
export const FORGOT_KEYS = ["forgot", "unsure"] as const;
/** س۸ answers that mean the tool was dropped (ت۳ «داشته و رها کرده»; also what opens س۹). */
export const ABANDONED_KEYS = ["older", "stopped"] as const;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const TEXT_MAX = 1000;
export const SHORT_TEXT_MAX = 120;
export const BODY_MAX_BYTES = 16 * 1024;
/** A row stops accepting page saves this long after it was created (or as soon as it is completed). */
export const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Report events are accepted for this long after the row was created. */
export const EVENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PAGES = 5;
export const MAX_HOURLY_TOMAN = 1_000_000_000;

export const EVENT_TYPES = ["report_viewed", "share", "download", "invite_telegram", "invite_app"] as const;
export type CheckupEventType = (typeof EVENT_TYPES)[number];
export const EVENT_COLUMN: Record<CheckupEventType, "reportViewedAt" | "sharedAt" | "downloadedAt" | "inviteTelegramAt" | "inviteAppAt"> = {
  report_viewed: "reportViewedAt",
  share: "sharedAt",
  download: "downloadedAt",
  invite_telegram: "inviteTelegramAt",
  invite_app: "inviteAppAt",
};

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = z.string().max(TEXT_MAX);
const short = z.string().max(SHORT_TEXT_MAX);
const opt = <T extends keyof typeof OPTIONS>(q: T) => z.enum(keysOf(q)).nullable().optional();

export const answersSchema = z
  .object({
    wake: clock.nullable().optional(),
    sleep: clock.nullable().optional(),
    tasks: z
      .array(z.object({ title: short.optional().default(""), hours: z.number().min(0).max(24).nullable().optional() }).strict())
      .max(3)
      .optional(),
    rest: z.array(z.enum(keysOf("rest"))).max(6).optional(),
    hourly: z.number().int().min(0).max(MAX_HOURLY_TOMAN).nullable().optional(),
    hourlyNever: z.boolean().optional(),
    regret: text.optional(),
    regretNone: z.boolean().optional(),
    monthSpend: opt("monthSpend"),
    tools: z.array(z.enum(keysOf("tools"))).max(9).optional(),
    toolIran: short.optional(),
    toolForeign: short.optional(),
    toolLastOpened: opt("toolLastOpened"),
    toolWhyLeft: text.optional(),
    paid: opt("paid"),
    paidWhat: text.optional(),
    built: text.optional(),
    builtNone: z.boolean().optional(),
    builtHours: opt("builtHours"),
    lastEmpty: opt("lastEmpty"),
    income: opt("income"),
    dependents: opt("dependents"),
    age: z.number().int().min(10).max(100).nullable().optional(),
    city: short.optional(),
    contactTelegram: z.string().max(64).optional(),
    contactBale: z.string().max(32).optional(),
    contactEmail: z.string().max(254).optional(),
    interview: opt("interview"),
  })
  .strict();

export type CheckupAnswers = z.infer<typeof answersSchema>;

export const submissionSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    page: z.number().int().min(1).max(PAGES),
    answers: answersSchema,
    source: z.string().max(200).optional(),
    completed: z.boolean().optional(),
    durationSec: z.number().int().min(0).max(7 * 24 * 3600).nullable().optional(),
    hp: z.string().max(500).optional(),
  })
  .strict();

export const eventSchema = z
  .object({
    id: submissionSchema.shape.id,
    type: z.enum(EVENT_TYPES),
  })
  .strict();

// ---------------------------------------------------------------------------
// Pure calculations — mirrored line for line by calc.js
// ---------------------------------------------------------------------------

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits → Latin; the Persian decimal mark (and "/") → "."; separators dropped. */
export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0x06f0 && code <= 0x06f9) out += String(code - 0x06f0);
    else if (code >= 0x0660 && code <= 0x0669) out += String(code - 0x0660);
    else if (code === 0x066b || ch === "/") out += ".";
    else if (code === 0x066c || ch === "," || ch === " " || code === 0x060c || code === 0x200c) continue;
    else out += ch;
  }
  return out.trim();
}

/** A whole Toman amount typed in any digits, or null. */
export function parseAmount(input: string): number | null {
  const s = normalizeDigits(input).replace(/\.\d*$/, "");
  if (!/^\d{1,13}$/.test(s)) return null;
  return Number(s);
}

/** Hours typed in any digits, decimals allowed (۱٫۵ / 1.5 / ۱/۵); null when not a number in 0–24. */
export function parseHours(input: string): number | null {
  const s = normalizeDigits(input);
  if (!/^\d{1,2}(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 24 ? n : null;
}

/** "HH:MM" → minutes after midnight, or null. */
export function clockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Minutes awake between waking and going to sleep. Sleeping after midnight wraps around (woke 08:00,
 * slept 01:00 → 17 hours). The same time twice says nothing usable, so it is null rather than 0 or 24.
 */
export function awakeMinutes(wake: string | null | undefined, sleep: string | null | undefined): number | null {
  const w = clockMinutes(wake);
  const s = clockMinutes(sleep);
  if (w === null || s === null || w === s) return null;
  return (s - w + 1440) % 1440;
}

export interface DayNumbers {
  /** Waking minutes yesterday (س۱), or null when not given. */
  awake: number | null;
  /** Minutes the three named tasks took (س۲). */
  named: number;
  /** awake − named, never negative; null without س۱. */
  hidden: number | null;
  /** The three tasks add up to more than the waking day (shown as a gentle note, hidden = 0). */
  overflow: boolean;
  /** At least one task hour was given — the report's first act needs س۱ and this. */
  hasTasks: boolean;
}

export function dayNumbers(answers: Pick<CheckupAnswers, "wake" | "sleep" | "tasks">): DayNumbers {
  const awake = awakeMinutes(answers.wake, answers.sleep);
  let named = 0;
  let hasTasks = false;
  for (const task of answers.tasks ?? []) {
    if (typeof task.hours === "number" && task.hours > 0) {
      named += Math.round(task.hours * 60);
      hasTasks = true;
    }
  }
  if (awake === null) return { awake, named, hidden: null, overflow: false, hasTasks };
  return { awake, named, hidden: Math.max(0, awake - named), overflow: named > awake, hasTasks };
}

/** The hidden hours priced at the person's own hourly value — null without a value (never an invented one). */
export function hiddenValueToman(hiddenMinutes: number | null, hourly: number | null | undefined): number | null {
  if (hiddenMinutes === null || !hourly || hourly <= 0) return null;
  return Math.round((hiddenMinutes / 60) * hourly);
}

/** The `src` query parameter, reduced to [a-z0-9-] and 40 characters; "direct" when nothing is left. */
export function sanitizeSource(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return s || "direct";
}

export type SourceGroup = "blind" | "branded" | "unknown";

/**
 * blind: the respondent arrived without seeing the brand (the kit's group posts, the Telegram poll);
 * branded: from the brand's own Instagram, channel or site; unknown: direct or an unrecognised tag.
 */
export function sourceGroup(source: string): SourceGroup {
  if (source.startsWith("grp-") || source === "tg-poll") return "blind";
  if (source.startsWith("ig-") || source === "tg-channel" || source === "site") return "branded";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Normalising the answers and deriving the queryable columns
// ---------------------------------------------------------------------------

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cleanBlock = (s: string | undefined) => (s ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/**
 * Applies the kit's conditions on the server too, so a skipped question never carries a stale answer: س۸
 * only with a tool, س۹ only when the tool was dropped, س۱۰'s detail only after «آره», س۱۲ only with an
 * answer to س۱۱. «هیچ‌کدوم» stands alone in س۷.
 */
export function normalizeAnswers(input: CheckupAnswers): CheckupAnswers {
  const a: CheckupAnswers = { ...input };
  a.tasks = (a.tasks ?? []).map((t) => ({ title: clean(t.title), hours: t.hours ?? null }));
  a.rest = [...new Set(a.rest ?? [])];
  if (a.hourlyNever) a.hourly = null;
  a.regret = cleanBlock(a.regret);
  if (a.regretNone) a.regret = "";
  let tools = [...new Set(a.tools ?? [])];
  if (tools.includes("none")) tools = ["none"];
  a.tools = tools;
  a.toolIran = tools.includes("iranApp") ? clean(a.toolIran) : "";
  a.toolForeign = tools.includes("foreignApp") ? clean(a.toolForeign) : "";
  const hasTool = tools.length > 0 && !tools.includes("none");
  if (!hasTool) a.toolLastOpened = null;
  a.toolWhyLeft = a.toolLastOpened && (ABANDONED_KEYS as readonly string[]).includes(a.toolLastOpened) ? cleanBlock(a.toolWhyLeft) : "";
  a.paidWhat = a.paid === "several" || a.paid === "once" ? cleanBlock(a.paidWhat) : "";
  a.built = cleanBlock(a.built);
  if (a.builtNone) a.built = "";
  if (!a.built) a.builtHours = null;
  a.city = clean(a.city);
  a.contactTelegram = clean(a.contactTelegram).replace(/^@/, "");
  a.contactBale = normalizeDigits(clean(a.contactBale)).replace(/[^\d+]/g, "");
  a.contactEmail = clean(a.contactEmail).toLowerCase();
  return a;
}

export interface CheckupColumns {
  awakeMinutes: number | null;
  namedMinutes: number | null;
  hiddenMinutes: number | null;
  restOfDayForgot: boolean;
  hourlyValue: number | null;
  hourlyNeverThought: boolean;
  monthSpendAnswer: string | null;
  toolsUsed: string | null;
  toolLastOpened: string | null;
  paidBefore: string | null;
  builtHoursKnown: string | null;
  lastEmptyMonth: string | null;
  incomeShape: string | null;
  dependents: string | null;
  age: number | null;
  city: string | null;
  contactTelegram: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  interviewOk: boolean | null;
}

const orNull = (s: string | null | undefined) => (s ? s : null);

/** The columns the dashboard queries, from already-normalised answers. */
export function deriveColumns(a: CheckupAnswers): CheckupColumns {
  const day = dayNumbers(a);
  const telegram = a.contactTelegram && /^[A-Za-z0-9_]{3,32}$/.test(a.contactTelegram) ? a.contactTelegram : null;
  const phone = a.contactBale && /^\+?\d{8,15}$/.test(a.contactBale) ? a.contactBale : null;
  const email = a.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.contactEmail) ? a.contactEmail : null;
  return {
    awakeMinutes: day.awake,
    namedMinutes: day.hasTasks ? day.named : null,
    hiddenMinutes: day.hasTasks ? day.hidden : null,
    restOfDayForgot: (a.rest ?? []).some((k) => (FORGOT_KEYS as readonly string[]).includes(k)),
    hourlyValue: a.hourly && a.hourly > 0 ? a.hourly : null,
    hourlyNeverThought: !!a.hourlyNever,
    monthSpendAnswer: orNull(a.monthSpend),
    toolsUsed: a.tools && a.tools.length ? a.tools.join(",") : null,
    toolLastOpened: orNull(a.toolLastOpened),
    paidBefore: orNull(a.paid),
    builtHoursKnown: orNull(a.builtHours),
    lastEmptyMonth: orNull(a.lastEmpty),
    incomeShape: orNull(a.income),
    dependents: orNull(a.dependents),
    age: a.age ?? null,
    city: orNull(a.city),
    contactTelegram: telegram,
    contactPhone: phone,
    contactEmail: email,
    interviewOk: a.interview === "yes" ? true : a.interview === "no" ? false : null,
  };
}

// ---------------------------------------------------------------------------
// The owner's dashboard
// ---------------------------------------------------------------------------

/**
 * The kit's decision thresholds (market-test-kit.md §8) and the dashboard's own guards.
 * قفل‌شده پیش از دیدن داده؛ تغییر فقط با تصمیم مکتوب.
 */
export const CHECKUP_THRESHOLDS = Object.freeze({
  /** Below this many completed answers in the current filter: counts and texts only, no percentage. */
  minForPercentages: 80,
  /** The kit's smallest sample a decision may rest on. */
  decisionSample: 120,
  /** ت۱ headline (س۳ «یادم نیست / مطمئن نیستم»): ≥ this confirms the hypothesis… */
  forgotConfirmed: 0.55,
  /** …below this it is weak; between the two the pain exists but is not acute. */
  forgotWeak: 0.35,
  /** ت۱ confirming measure: س۱۳ = «همین ماه» at or above this. */
  thisMonthConfirms: 0.4,
  /** ت۱ counter-measure: س۴ «فکر نکرده‌ام» above this → the product builds the hourly value itself. */
  neverThoughtMax: 0.75,
  /** Reaction to the report (share or save its card) below this: the problem is deeper than the message. */
  reactionAlarm: 0.3,
  /** A completed answer faster than this is flagged as suspicious. */
  suspiciousDurationSec: 60,
  /** More completed answers than this from one address (hashed) within 24 hours are flagged. */
  suspiciousSameIp: 5,
});

export type T1Status = "confirmed" | "mild" | "weak";

export interface MetricRow {
  id: string;
  createdAt: Date;
  completedAt: Date | null;
  lastPage: number;
  durationSec: number | null;
  ipHash: string | null;
  sourceGroup: string;
  restOfDayForgot: boolean;
  hourlyValue: number | null;
  hourlyNeverThought: boolean;
  monthSpendAnswer: string | null;
  toolsUsed: string | null;
  toolLastOpened: string | null;
  paidBefore: string | null;
  lastEmptyMonth: string | null;
  incomeShape: string | null;
  reportViewedAt: Date | null;
  sharedAt: Date | null;
  downloadedAt: Date | null;
  inviteTelegramAt: Date | null;
  inviteAppAt: Date | null;
  /** Did س۳ get any answer (from the raw answers; restOfDayForgot alone cannot tell «no» from «skipped»). */
  answeredRest: boolean;
}

/** A share in [0, 1] with its base; `pct` is null while percentages are withheld (fewer than 80 completed). */
export interface Rate {
  count: number;
  base: number;
  pct: number | null;
}

export interface CheckupMetrics {
  thresholds: typeof CHECKUP_THRESHOLDS;
  /** True while completed < minForPercentages: «فقط کیفی بخوان». */
  qualitativeOnly: boolean;
  decisionReady: boolean;
  funnel: { started: number; reachedPage: number[]; completed: number; medianDurationSec: number | null };
  t1: { forgot: Rate; status: T1Status | null; thisMonth: Rate; neverThought: Rate; neverThoughtTriggered: boolean | null };
  t2: { segment: string; completed: number; forgot: Rate; spendUnknown: Rate; paid: Rate }[];
  t3: { abandoned: Rate; active: Rate; never: Rate };
  report: { viewed: Rate; reacted: Rate; shared: Rate; downloaded: Rate; inviteTelegram: Rate; inviteApp: Rate; reactionAlarm: boolean | null };
  suspiciousIds: string[];
}

/** Ids of completed answers that look automated: too fast, or too many from one hashed address in a day. */
export function suspiciousIds(rows: Pick<MetricRow, "id" | "completedAt" | "durationSec" | "ipHash">[]): Set<string> {
  const flagged = new Set<string>();
  const byIp = new Map<string, { id: string; at: number }[]>();
  for (const r of rows) {
    if (!r.completedAt) continue;
    if (r.durationSec !== null && r.durationSec < CHECKUP_THRESHOLDS.suspiciousDurationSec) flagged.add(r.id);
    if (r.ipHash) byIp.set(r.ipHash, [...(byIp.get(r.ipHash) ?? []), { id: r.id, at: r.completedAt.getTime() }]);
  }
  const day = 24 * 60 * 60 * 1000;
  for (const list of byIp.values()) {
    if (list.length <= CHECKUP_THRESHOLDS.suspiciousSameIp) continue;
    list.sort((x, y) => x.at - y.at);
    for (let i = 0; i < list.length; i++) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].at - list[i].at <= day) j++;
      if (j - i + 1 > CHECKUP_THRESHOLDS.suspiciousSameIp) for (let k = i; k <= j; k++) flagged.add(list[k].id);
    }
  }
  return flagged;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computeCheckupMetrics(rows: MetricRow[]): CheckupMetrics {
  const T = CHECKUP_THRESHOLDS;
  const done = rows.filter((r) => r.completedAt);
  const qualitativeOnly = done.length < T.minForPercentages;
  const rate = (count: number, base: number): Rate => ({ count, base, pct: qualitativeOnly || base === 0 ? null : count / base });
  const share = (list: MetricRow[], test: (r: MetricRow) => boolean) => rate(list.filter(test).length, list.length);

  const restBase = done.filter((r) => r.answeredRest);
  const forgot = share(restBase, (r) => r.restOfDayForgot);
  const status: T1Status | null = forgot.pct === null ? null : forgot.pct >= T.forgotConfirmed ? "confirmed" : forgot.pct >= T.forgotWeak ? "mild" : "weak";
  const thisMonth = share(done.filter((r) => r.lastEmptyMonth), (r) => r.lastEmptyMonth === "thisMonth");
  const neverThought = share(done.filter((r) => r.hourlyNeverThought || r.hourlyValue !== null), (r) => r.hourlyNeverThought);

  const t2 = Object.keys(OPTIONS.income).map((segment) => {
    const seg = done.filter((r) => r.incomeShape === segment);
    return {
      segment,
      completed: seg.length,
      forgot: share(seg.filter((r) => r.answeredRest), (r) => r.restOfDayForgot),
      spendUnknown: share(seg.filter((r) => r.monthSpendAnswer), (r) => r.monthSpendAnswer === "dontknow" || r.monthSpendAnswer === "bank"),
      paid: share(seg.filter((r) => r.paidBefore), (r) => r.paidBefore === "several" || r.paidBefore === "once"),
    };
  });

  const toolBase = done.filter((r) => r.toolsUsed);
  const hasNone = (r: MetricRow) => r.toolsUsed === "none";
  const t3 = {
    abandoned: share(toolBase, (r) => !hasNone(r) && (ABANDONED_KEYS as readonly (string | null)[]).includes(r.toolLastOpened)),
    active: share(toolBase, (r) => !hasNone(r) && (r.toolLastOpened === "today" || r.toolLastOpened === "week" || r.toolLastOpened === "month")),
    never: share(toolBase, hasNone),
  };

  const viewedRows = done.filter((r) => r.reportViewedAt);
  const reacted = share(viewedRows, (r) => !!(r.sharedAt || r.downloadedAt));

  return {
    thresholds: T,
    qualitativeOnly,
    decisionReady: done.length >= T.decisionSample,
    funnel: {
      started: rows.length,
      reachedPage: Array.from({ length: PAGES }, (_, i) => rows.filter((r) => r.lastPage >= i + 1).length),
      completed: done.length,
      medianDurationSec: median(done.map((r) => r.durationSec).filter((d): d is number => d !== null)),
    },
    t1: { forgot, status, thisMonth, neverThought, neverThoughtTriggered: neverThought.pct === null ? null : neverThought.pct > T.neverThoughtMax },
    t2,
    t3,
    report: {
      viewed: share(done, (r) => !!r.reportViewedAt),
      reacted,
      shared: share(viewedRows, (r) => !!r.sharedAt),
      downloaded: share(viewedRows, (r) => !!r.downloadedAt),
      inviteTelegram: share(viewedRows, (r) => !!r.inviteTelegramAt),
      inviteApp: share(viewedRows, (r) => !!r.inviteAppAt),
      reactionAlarm: reacted.pct === null ? null : reacted.pct < T.reactionAlarm,
    },
    suspiciousIds: [...suspiciousIds(rows)],
  };
}
