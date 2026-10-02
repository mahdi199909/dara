// «حسابرسی ۵ دقیقه‌ای» — the calculation rules, in the browser.
//
// A line-for-line mirror of src/lib/checkup.ts in the app's repository (which the server uses to recompute
// every number). src/lib/checkup.parity.test.ts runs both on the same fixtures: change one, change the other.
// Pure functions only — no DOM, no storage, no network.

/** Option keys → the kit's exact wording (doc/checkup/market-test-kit.md §4). */
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
};

export const FORGOT_KEYS = ["forgot", "unsure"];
export const ABANDONED_KEYS = ["older", "stopped"];

/**
 * Persian and Arabic-Indic digits → Latin; the Persian decimal mark (and "/") → "."; separators dropped.
 * @param {string} input
 * @returns {string}
 */
export function normalizeDigits(input) {
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

/**
 * A whole Toman amount typed in any digits, or null.
 * @param {string} input
 * @returns {number | null}
 */
export function parseAmount(input) {
  const s = normalizeDigits(input).replace(/\.\d*$/, "");
  if (!/^\d{1,13}$/.test(s)) return null;
  return Number(s);
}

/**
 * Hours typed in any digits, decimals allowed; null when not a number in 0–24.
 * @param {string} input
 * @returns {number | null}
 */
export function parseHours(input) {
  const s = normalizeDigits(input);
  if (!/^\d{1,2}(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 24 ? n : null;
}

/**
 * @param {string | null | undefined} value "HH:MM"
 * @returns {number | null} minutes after midnight
 */
export function clockMinutes(value) {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Minutes awake; sleeping after midnight wraps around. The same time twice → null.
 * @param {string | null | undefined} wake
 * @param {string | null | undefined} sleep
 * @returns {number | null}
 */
export function awakeMinutes(wake, sleep) {
  const w = clockMinutes(wake);
  const s = clockMinutes(sleep);
  if (w === null || s === null || w === s) return null;
  return (s - w + 1440) % 1440;
}

/**
 * @param {{ wake?: string | null, sleep?: string | null, tasks?: { title?: string, hours?: number | null }[] }} answers
 * @returns {{ awake: number | null, named: number, hidden: number | null, overflow: boolean, hasTasks: boolean }}
 */
export function dayNumbers(answers) {
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

/**
 * The hidden hours priced at the person's own hourly value — null without one (never an invented value).
 * @param {number | null} hiddenMinutes
 * @param {number | null | undefined} hourly
 * @returns {number | null}
 */
export function hiddenValueToman(hiddenMinutes, hourly) {
  if (hiddenMinutes === null || !hourly || hourly <= 0) return null;
  return Math.round((hiddenMinutes / 60) * hourly);
}

/**
 * @param {string | null | undefined} raw the `src` query parameter
 * @returns {string}
 */
export function sanitizeSource(raw) {
  const s = (raw ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return s || "direct";
}

/**
 * @param {string} source
 * @returns {"blind" | "branded" | "unknown"}
 */
export function sourceGroup(source) {
  if (source.startsWith("grp-") || source === "tg-poll") return "blind";
  if (source.startsWith("ig-") || source === "tg-channel" || source === "site") return "branded";
  return "unknown";
}

const clean = (/** @type {string | undefined} */ s) => (s ?? "").replace(/\s+/g, " ").trim();
const cleanBlock = (/** @type {string | undefined} */ s) =>
  (s ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/**
 * The kit's conditions, applied before sending: a skipped question never carries a stale answer.
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function normalizeAnswers(input) {
  const a = { ...input };
  a.tasks = (a.tasks ?? []).map((/** @type {any} */ t) => ({ title: clean(t.title), hours: t.hours ?? null }));
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
  a.toolWhyLeft = a.toolLastOpened && ABANDONED_KEYS.includes(a.toolLastOpened) ? cleanBlock(a.toolWhyLeft) : "";
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

// ---------------------------------------------------------------------------
// Display helpers (browser only)
// ---------------------------------------------------------------------------

/** @param {number} n */
export function faNumber(n) {
  return n.toLocaleString("fa-IR");
}

/**
 * Minutes as hours with at most one decimal, in Persian digits ("۱۶٫۵").
 * @param {number} minutes
 */
export function faHours(minutes) {
  return (Math.round(minutes / 6) / 10).toLocaleString("fa-IR", { maximumFractionDigits: 1 });
}
