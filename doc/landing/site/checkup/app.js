// «حسابرسی ۵ دقیقه‌ای» — the page: five pages of the kit's questions, the report, the result card.
//
// The report is computed here, in the browser, so a respondent always sees it — even when the app server
// is down for weeks. Every save goes through a small queue kept in localStorage: a save that fails stays
// there and is sent on the next try or the next visit. Only the respondent's own answers are ever shown;
// user text reaches the page through textContent only, never as HTML.
import {
  OPTIONS,
  ABANDONED_KEYS,
  normalizeDigits,
  parseAmount,
  parseHours,
  dayNumbers,
  hiddenValueToman,
  sanitizeSource,
  normalizeAnswers,
  faNumber,
  faHours,
} from "./calc.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** The app server that stores the answers. A local preview (localhost) talks to a local dev server. */
const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:3000" : "https://my.parvaapp.ir";
/** PLACEHOLDER — the Telegram channel's link (https://t.me/…). While empty, the channel invite is not shown. */
const TELEGRAM_CHANNEL_URL = "";
const APP_URL = "https://my.parvaapp.ir/register?src=checkup";
const QUEUE_KEY = "parva-checkup-queue-v1";
const PAGES = 5;
const RETRY_MS = 15000;

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const form = $("form");
const source = sanitizeSource(new URLSearchParams(location.search).get("src"));

// ---------------------------------------------------------------------------
// Storage (every access may throw: private windows, blocked site data)
// ---------------------------------------------------------------------------

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch (e) {
    return null;
  }
}
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* the queue then lives only as long as this tab */
  }
}

// ---------------------------------------------------------------------------
// The send queue
// ---------------------------------------------------------------------------

/** @type {{ subs: Record<string, any>, events: { id: string, type: string }[] }} */
const queue = (() => {
  const stored = load(QUEUE_KEY);
  return {
    subs: stored && typeof stored.subs === "object" && stored.subs ? stored.subs : {},
    events: stored && Array.isArray(stored.events) ? stored.events : [],
  };
})();
function saveQueue() {
  // Bounded, so a long outage on a shared device cannot grow storage without limit.
  const ids = Object.keys(queue.subs);
  for (const id of ids.slice(0, Math.max(0, ids.length - 20))) delete queue.subs[id];
  queue.events = queue.events.slice(-50);
  persist(QUEUE_KEY, queue);
}

/** "ok": stored (or answered); "drop": refused for good (bad shape, locked, unknown); "retry": try again later. */
async function post(path, body) {
  try {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      // text/plain keeps this a "simple" request: no preflight round trip on a slow mobile connection.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
      mode: "cors",
      credentials: "omit",
      keepalive: true,
    });
    if (res.ok) return "ok";
    if (res.status === 429 || res.status >= 500) return "retry";
    return "drop";
  } catch (e) {
    return "retry";
  }
}

let flushing = false;
let retryTimer = 0;
async function flush() {
  if (flushing) return;
  flushing = true;
  let failed = false;
  try {
    for (;;) {
      const id = Object.keys(queue.subs)[0];
      if (!id) break;
      const payload = queue.subs[id];
      const outcome = await post("/api/checkup", payload);
      if (outcome === "retry") {
        failed = true;
        break;
      }
      // A newer save of the same sheet may have replaced it while this one was in flight.
      if (queue.subs[id] === payload) delete queue.subs[id];
      saveQueue();
    }
    while (!failed && queue.events.length) {
      const event = queue.events[0];
      const outcome = await post("/api/checkup/event", event);
      if (outcome === "retry") {
        failed = true;
        break;
      }
      queue.events.shift();
      saveQueue();
    }
  } finally {
    flushing = false;
  }
  clearTimeout(retryTimer);
  if (failed) retryTimer = window.setTimeout(flush, RETRY_MS);
  renderSaveStatus();
}
window.addEventListener("online", () => flush());

function enqueue(payload) {
  queue.subs[payload.id] = payload;
  saveQueue();
  flush();
}

function track(type) {
  if (!state.id) return;
  if (state.tracked.has(type)) return;
  state.tracked.add(type);
  queue.events.push({ id: state.id, type });
  saveQueue();
  flush();
}

// ---------------------------------------------------------------------------
// State and helpers
// ---------------------------------------------------------------------------

const state = { id: "", startedAt: 0, step: 0, tracked: new Set() };

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faDigits = (/** @type {string} */ s) => s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
/** A paragraph from pieces: strings are plain text, [text, class] pairs are emphasised spans. */
function para(...parts) {
  const p = el("p");
  for (const part of parts) {
    if (Array.isArray(part)) p.append(el("span", part[1], part[0]));
    else p.append(document.createTextNode(part));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Building the options
// ---------------------------------------------------------------------------

function buildChoices() {
  document.querySelectorAll("[data-single],[data-multi]").forEach((box) => {
    const multi = box.hasAttribute("data-multi");
    const q = box.getAttribute(multi ? "data-multi" : "data-single");
    for (const [key, label] of Object.entries(OPTIONS[q])) {
      const lab = el("label", "choice" + (q === "rest" && (key === "forgot" || key === "unsure") ? " em" : ""));
      const input = el("input");
      input.type = multi ? "checkbox" : "radio";
      input.name = q;
      input.value = key;
      lab.append(input, document.createTextNode(label));
      box.append(lab);
    }
  });
  const times = [];
  for (let m = 0; m < 1440; m += 30) times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  const fill = (select, list) => {
    select.append(new Option("انتخاب کن", ""));
    for (const t of list) select.append(new Option(faDigits(t), t));
  };
  fill($("wake"), times);
  // Bedtimes start in the evening, so "after midnight" sits right where people look for it.
  fill($("sleep"), [...times.slice(36), ...times.slice(0, 36)]);
}

// ---------------------------------------------------------------------------
// Reading the answers
// ---------------------------------------------------------------------------

const checked = (name) => Array.from(form.querySelectorAll(`input[name="${name}"]:checked`), (i) => i.value);
const radio = (name) => checked(name)[0] ?? null;
const val = (id) => $(id).value;

function collect() {
  const tasks = [1, 2, 3]
    .map((n) => ({ title: val("t" + n).slice(0, 120), hours: parseHours(val("h" + n + "v")) }))
    .filter((t) => t.title.trim() || t.hours !== null);
  const hourly = parseAmount(val("hourly"));
  const age = parseAmount(val("age"));
  return {
    wake: val("wake") || null,
    sleep: val("sleep") || null,
    tasks,
    rest: checked("rest"),
    hourly: hourly !== null && hourly <= 1e9 ? hourly : null,
    hourlyNever: $("hourlyNever").checked,
    regret: val("regret").slice(0, 1000),
    regretNone: $("regretNone").checked,
    monthSpend: radio("monthSpend"),
    tools: checked("tools"),
    toolIran: val("toolIran").slice(0, 120),
    toolForeign: val("toolForeign").slice(0, 120),
    toolLastOpened: radio("toolLastOpened"),
    toolWhyLeft: val("toolWhyLeft").slice(0, 1000),
    paid: radio("paid"),
    paidWhat: val("paidWhat").slice(0, 1000),
    built: val("built").slice(0, 1000),
    builtNone: $("builtNone").checked,
    builtHours: radio("builtHours"),
    lastEmpty: radio("lastEmpty"),
    income: radio("income"),
    dependents: radio("dependents"),
    age: age !== null && age >= 10 && age <= 100 ? age : null,
    city: val("city").slice(0, 120),
    contactTelegram: val("contactTelegram").slice(0, 64),
    contactBale: val("contactBale").slice(0, 32),
    contactEmail: val("contactEmail").slice(0, 254),
    interview: radio("interview"),
  };
}

function payload(page, completed) {
  return {
    id: state.id,
    page,
    answers: normalizeAnswers(collect()),
    source,
    completed,
    durationSec: Math.min(7 * 24 * 3600, Math.max(0, Math.round((Date.now() - state.startedAt) / 1000))),
    hp: val("website").slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Conditions and the live number in question 3
// ---------------------------------------------------------------------------

function update() {
  const a = collect();
  const day = dayNumbers(a);
  $("xHours").textContent = `${faHours(day.named)} ساعت`;
  $("overflowNote").hidden = !day.overflow;
  $("sameTimeNote").hidden = !(a.wake && a.sleep && a.wake === a.sleep);

  $("hourly").disabled = a.hourlyNever;
  $("regret").disabled = a.regretNone;
  $("built").disabled = a.builtNone;

  const tools = a.tools;
  $("toolIranWrap").hidden = !tools.includes("iranApp");
  $("toolForeignWrap").hidden = !tools.includes("foreignApp");
  const hasTool = tools.length > 0 && !tools.includes("none");
  $("q8").hidden = !hasTool;
  $("q9").hidden = !(hasTool && a.toolLastOpened && ABANDONED_KEYS.includes(a.toolLastOpened));
  $("paidWhatWrap").hidden = !(a.paid === "several" || a.paid === "once");
  $("q12").hidden = !(a.built.trim() && !a.builtNone);
}

form.addEventListener("submit", (e) => e.preventDefault());
form.addEventListener("input", update);
form.addEventListener("change", (e) => {
  const t = e.target;
  // «هیچ‌کدوم» stands alone in question 7.
  if (t.name === "tools" && t.checked) {
    form.querySelectorAll('input[name="tools"]').forEach((i) => {
      if (t.value === "none" ? i.value !== "none" : i.value === "none") i.checked = false;
    });
  }
  update();
});

$("hourly").addEventListener("input", () => {
  const digits = normalizeDigits($("hourly").value).replace(/\D/g, "").slice(0, 13);
  $("hourly").value = digits ? Number(digits).toLocaleString("fa-IR") : "";
});
$("age").addEventListener("input", () => {
  $("age").value = faDigits(normalizeDigits($("age").value).replace(/\D/g, "").slice(0, 3));
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function showStep(n) {
  state.step = n;
  form.querySelectorAll("section[data-step]").forEach((s) => (s.hidden = Number(s.getAttribute("data-step")) !== n));
  $("nav").hidden = n === 0;
  $("backBtn").hidden = n <= 1;
  $("nextBtn").textContent = n === PAGES ? "نتیجه‌ام را نشان بده" : "بعدی";
  $("stepLabel").textContent = n >= 1 ? `${faNumber(n)} از ${faNumber(PAGES)}` : "";
  $("bar").style.width = `${(Math.max(0, n) / PAGES) * 100}%`;
  window.scrollTo(0, 0);
  const heading = $("h" + n);
  if (heading) heading.focus({ preventScroll: true });
}

$("startBtn").addEventListener("click", () => {
  state.id = newId();
  state.startedAt = Date.now();
  state.tracked = new Set();
  enqueue(payload(1, false));
  showStep(1);
});
$("backBtn").addEventListener("click", () => showStep(Math.max(1, state.step - 1)));
$("nextBtn").addEventListener("click", () => {
  if (state.step < PAGES) {
    enqueue(payload(state.step + 1, false));
    showStep(state.step + 1);
  } else {
    finish();
  }
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function excerpt(text, max) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trim() + "…" : t;
}

function finish() {
  const sent = payload(PAGES, true);
  enqueue(sent);
  const a = sent.answers;
  const day = dayNumbers(a);
  const value = hiddenValueToman(day.hidden, a.hourly);

  // Act 1 — what was spent
  const act1 = $("act1Body");
  act1.replaceChildren();
  if (day.awake !== null && day.hasTasks) {
    act1.append(para("دیروز ", [faHours(day.awake), "big num"], " ساعت بیدار بودی."));
    if (day.overflow) {
      act1.append(para("سه کاری که نوشتی حدود ", [faHours(day.named), "big num"], " ساعت شد؛ یعنی تقریباً همهٔ روزت نام دارد."));
    } else {
      act1.append(para([faHours(day.named), "big num"], " ساعتش را نام بردی. ", [faHours(day.hidden), "big num waste"], " ساعت باقی‌مانده جایی ثبت نشده."));
    }
  } else if (day.awake !== null) {
    act1.append(para("دیروز ", [faHours(day.awake), "big num"], " ساعت بیدار بودی. کارهایت را با ساعت ننوشتی، پس اینجا همین یک عدد هست."));
  } else if (day.hasTasks) {
    act1.append(para("سه کاری که نوشتی حدود ", [faHours(day.named), "big num"], " ساعت شد. ساعت بیداری و خوابت را ننوشتی، پس بقیهٔ روز حساب نشد."));
  } else {
    act1.append(para("دیروز را ننوشتی، پس این بخش عددی ندارد."));
  }

  // Act 2 — what was not visible (only with hidden hours; Toman only with the person's own hourly value)
  const act2 = $("act2Body");
  act2.replaceChildren();
  const showAct2 = day.hasTasks && day.hidden !== null && day.hidden > 0;
  $("act2").hidden = !showAct2;
  if (showAct2) {
    if (value !== null) {
      act2.append(para("با ارزش ساعتی‌ای که خودت گفتی، آن ", [faHours(day.hidden), "num"], " ساعت معادل ", [faNumber(value) + " تومان", "big num waste"], " بود — عددی که در هیچ حسابی ظاهر نمی‌شود."));
    } else {
      act2.append(para("آن ", [faHours(day.hidden), "num"], " ساعت در هیچ حسابی ظاهر نمی‌شود. ارزش ساعتی‌ات را ننوشتی، پس اینجا فقط ساعت می‌آید، نه تومان."));
    }
  }

  // Act 3 — what was built (always last, never ends on a negative)
  const act3 = $("act3Body");
  act3.replaceChildren();
  if (a.built) {
    act3.append(para("نوشتی که در ۱۲ ماه گذشته این را یاد گرفتی یا ساختی: ", ["«" + excerpt(a.built, 140) + "»", "big"]));
    if (a.builtHours === "approx") act3.append(para("و یک عدد تقریبی از ساعت‌هایی که رویش گذاشتی داری."));
    else if (a.builtHours === "guess") act3.append(para("و فقط می‌توانی حدس بزنی چند ساعت رویش گذاشتی."));
    else act3.append(para("و نمی‌دانی دقیقاً چند ساعت رویش گذاشتی."));
    act3.append(para("اگر هفته‌ای ۳ ساعت بوده، الان حدود ", ["۱۵۰ ساعت", "big num"], " روی آن سرمایه‌گذاری کرده‌ای."));
  } else {
    act3.append(para("هر چیزی که در این یک سال یاد گرفتی یا ساختی، حتی اگر الان اسمش به ذهنت نمی‌رسد، ساعت‌هایی است که روی خودت سرمایه‌گذاری کرده‌ای."));
  }

  form.hidden = true;
  $("report").hidden = false;
  $("stepLabel").textContent = "";
  $("bar").style.width = "100%";
  window.scrollTo(0, 0);
  $("hr").focus({ preventScroll: true });
  track("report_viewed");
  drawCard(a, day, value);

  if (TELEGRAM_CHANNEL_URL) {
    $("telegramLink").href = TELEGRAM_CHANNEL_URL;
    $("inviteTelegram").hidden = false;
  }
  $("appLink").href = APP_URL;
}

$("telegramLink").addEventListener("click", () => track("invite_telegram"));
$("appLink").addEventListener("click", () => track("invite_app"));

function renderSaveStatus() {
  const pending = state.id && (queue.subs[state.id] || queue.events.some((e) => e.id === state.id));
  $("saveStatus").textContent = pending && !$("report").hidden ? "پاسخ‌هایت روی همین دستگاه مانده و هر وقت اتصال برقرار شد فرستاده می‌شود. نتیجه‌ات همین است که می‌بینی." : "";
}

// ---------------------------------------------------------------------------
// The result card (a PNG drawn on a canvas, in the hero receipt's style)
// ---------------------------------------------------------------------------

/** @type {Blob | null} */
let cardBlob = null;

async function drawCard(a, day, value) {
  try {
    await Promise.all([document.fonts.load('700 48px "VazirLocal"'), document.fonts.load('400 36px "VazirLocal"')]);
  } catch (e) {
    /* falls back to the system font */
  }
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const C = { canvas: "#EFF2EE", surface: "#FBFCFA", ink: "#14181A", muted: "#5C6360", line: "#DCE3DE", accent: "#0E5F54", soft: "#E3EEEB", waste: "#A8473B" };
  const font = (w, px) => `${w} ${px}px "VazirLocal", Tahoma, sans-serif`;

  ctx.fillStyle = C.canvas;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(14,95,84,.08)";
  ctx.lineWidth = 2;
  for (let y = 54; y < H; y += 54) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // receipt with a torn bottom edge
  const L = 110;
  const R = W - 110;
  const T = 130;
  const B = 1120;
  ctx.save();
  ctx.translate(W / 2, T);
  ctx.rotate((-1 * Math.PI) / 180);
  ctx.translate(-W / 2, -T);
  ctx.shadowColor = "rgba(10,31,27,.18)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = C.surface;
  ctx.beginPath();
  ctx.moveTo(L + 28, T);
  ctx.lineTo(R - 28, T);
  ctx.quadraticCurveTo(R, T, R, T + 28);
  ctx.lineTo(R, B);
  for (let x = R; x > L; x -= 24) ctx.arc(x - 12, B, 12, 0, Math.PI, false);
  ctx.lineTo(L, T + 28);
  ctx.quadraticCurveTo(L, T, L + 28, T);
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.direction = "rtl";
  const right = R - 56;
  const left = L + 56;
  let y = T + 110;
  ctx.textAlign = "right";
  ctx.fillStyle = C.accent;
  ctx.font = font(700, 52);
  ctx.fillText("حسابرسی ۵ دقیقه‌ای", right, y);
  y += 62;
  ctx.fillStyle = C.muted;
  ctx.font = font(400, 34);
  ctx.fillText("صورت‌حساب دیروزِ من", right, y);
  y += 50;

  const dashed = () => {
    ctx.save();
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.restore();
  };
  const row = (label, valueText, color) => {
    y += 92;
    ctx.textAlign = "right";
    ctx.fillStyle = C.ink;
    ctx.font = font(400, 40);
    ctx.fillText(label, right, y);
    ctx.textAlign = "left";
    ctx.fillStyle = color || C.ink;
    ctx.font = font(700, 46);
    ctx.fillText(valueText, left, y);
    y += 34;
    dashed();
  };
  dashed();
  if (day.awake !== null) row("بیدار بودم", `${faHours(day.awake)} ساعت`);
  if (day.hasTasks) row("نام بردم", `${faHours(day.named)} ساعت`);
  if (day.hasTasks && day.hidden !== null) row("جایی ثبت نشده", `${faHours(day.hidden)} ساعت`, C.waste);
  if (day.hasTasks && value !== null && day.hidden) row("ارزشش به نرخ خودم", `${faNumber(value)} تومان`, C.waste);
  if (day.awake === null && !day.hasTasks) row("دیروز", "ننوشتم", C.muted);

  // what was built, last and in the brand's soft green
  y += 60;
  const boxTop = y;
  const boxH = 200;
  ctx.fillStyle = C.soft;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(left, boxTop, right - left, boxH, 24) : ctx.rect(left, boxTop, right - left, boxH);
  ctx.fill();
  ctx.textAlign = "right";
  ctx.fillStyle = C.accent;
  ctx.font = font(700, 38);
  ctx.fillText("ستون دیگر: آنچه ساختم", right - 32, boxTop + 66);
  ctx.font = font(400, 34);
  const builtLine = a.built ? `«${excerpt(a.built, 38)}»` : "ساعت‌هایی که روی خودم گذاشتم";
  ctx.fillText(builtLine, right - 32, boxTop + 130);
  ctx.restore();

  ctx.direction = "ltr";
  ctx.textAlign = "center";
  ctx.fillStyle = C.muted;
  ctx.font = font(500, 36);
  ctx.fillText("parvaapp.ir/checkup", W / 2, H - 90);

  canvas.toBlob((blob) => {
    if (!blob) return;
    cardBlob = blob;
    const img = $("cardImg");
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    const file = new File([blob], "checkup.png", { type: "image/png" });
    $("shareBtn").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  }, "image/png");
}

$("shareBtn").addEventListener("click", async () => {
  if (!cardBlob) return;
  const file = new File([cardBlob], "checkup.png", { type: "image/png" });
  try {
    await navigator.share({ files: [file], title: "حسابرسی ۵ دقیقه‌ای", text: "حسابرسی ۵ دقیقه‌ای: parvaapp.ir/checkup" });
    track("share");
  } catch (e) {
    /* cancelled */
  }
});
$("downloadBtn").addEventListener("click", () => {
  if (!cardBlob) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(cardBlob);
  link.download = "checkup.png";
  document.body.append(link);
  link.click();
  link.remove();
  track("download");
});

// ---------------------------------------------------------------------------
// Theme toggle (same stored choice as the landing page)
// ---------------------------------------------------------------------------

const root = document.documentElement;
const isDark = () => {
  const t = root.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
const paintThemeLabel = () => $("themeBtn").setAttribute("aria-label", isDark() ? "رفتن به تم روشن" : "رفتن به تم تیره");
$("themeBtn").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem("parva-lp-theme", next);
  } catch (e) {
    /* this tab only */
  }
  paintThemeLabel();
});

// ---------------------------------------------------------------------------

buildChoices();
paintThemeLabel();
update();
showStep(0);
flush(); // anything left from an earlier visit
