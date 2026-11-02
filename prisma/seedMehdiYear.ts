// One year of «مهدی» — the persona in doc/persona-mehdi (27, senior front-end freelancer, lives alone in Tehran,
// CrossFit 3–4 times a week, reads about behaviour and the mind, earns 55–80 million a month in uneven payments).
// He installed Parva exactly a year ago and logs about 90% of what he does, and every rial of his money.
//
// The year has a shape, so every page has something true to show:
//   • Aban–Dey 1404: two clients, then three, then four — over-committing for the money.
//   • Dey–Esfand: the crunch. Late nights, skipped workouts, YouTube/Twitter binges after hard weeks,
//     a Nowruz landing page on top of everything. «پول وارد شد، ولی ماه پیش هیچ زندگی‌ای نکردم.»
//   • Nowruz: a trip north, then a decision — at most two clients, 20% higher rates, a personal
//     investment fund, a savings account for a car, monthly budgets.
//   • Spring–summer: a calmer rhythm, his own small product starts, a three-day cold, a trip to Yazd.
//   • Autumn 1405: a Dutch client, the first subscription income from his own product, a long habit streak.
//
// Run:   TZ=Asia/Tehran npx tsx prisma/seedMehdiYear.ts
// Login: EMAIL / PASSWORD below (printed at the end too).
// Re-running deletes the account and writes it again, so the year always ends today.
// By default it only writes to a local SQLite file; set ALLOW_NON_SQLITE_DEMO=1 to write to another database.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../src/lib/defaults";
import { recalcActivityDuration } from "../src/lib/activityService";
import { createProjectCategory, syncProjectCompletionAsset } from "../src/lib/projectSync";
import { generateInstallmentSchedule } from "../src/lib/installments";
import { syncHabitCheckInVirtualAsset } from "../src/lib/habitSync";
import { syncEventDirectCostTransaction, syncTaskDirectCostTransaction, syncTaskVirtualAsset } from "../src/lib/directCostSync";
import { dayKeyIso } from "../src/lib/calendarGrid";
import { jalaliDateKey, toJalali } from "../src/lib/jalali";

export const EMAIL = "mehdi.demo@parvaapp.ir";
export const PASSWORD = "Mehdi@1405";
const NAME = "مهدی رضایی";
const USER_ID = "demo_persona_mehdi";
const WINDOW_DAYS = 365;

const prisma = new PrismaClient();

// Deterministic PRNG — the same year every run, sliding forward with today.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1405080501);
const chance = (p: number) => rand() < p;
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let roll = rand() * total;
  for (const i of items) {
    roll -= weight(i);
    if (roll <= 0) return i;
  }
  return items[items.length - 1];
}

// ------------------------------------------------------------------------------------------------------------
// The story as data
// ------------------------------------------------------------------------------------------------------------

interface ProjectDef {
  key: string;
  name: string;
  description: string;
  color: string;
  startAgo: number;
  endAgo: number | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  weight: number;
  tasks: string[];
  doneCount?: number;
  sessions: string[];
  payments: Array<{ ago: number; amount: number; note: string }>;
}

const PROJECTS: ProjectDef[] = [
  {
    key: "noa",
    name: "داشبورد فین‌تک نوآ",
    description: "قرارداد ریتینر ماهانه — توسعه‌ی فرانت‌اند داشبورد مشتریان و پنل معامله‌گری نوآ",
    color: "#2c7166",
    startAgo: 363,
    endAgo: null,
    status: "ACTIVE",
    weight: 1,
    tasks: [
      "بازنویسی جدول تراکنش‌ها با مجازی‌سازی",
      "صفحه‌ی خلاصه‌ی پرتفوی",
      "نمودار سود و زیان روزانه",
      "فیلترهای پیشرفته‌ی تاریخچه",
      "رفع نشت حافظه در صفحه‌ی بازار",
      "حالت تاریک داشبورد",
      "مهاجرت به React Query",
      "صفحه‌ی احراز هویت دومرحله‌ای",
      "کامپوننت انتخاب بازه‌ی تاریخ شمسی",
      "خروجی PDF صورت‌حساب",
      "بهینه‌سازی باندل (کاهش ۳۵٪)",
      "صفحه‌ی اعلان‌ها",
      "تست‌های E2E جریان واریز",
      "پنل تیکت پشتیبانی",
      "نسخه‌ی موبایل صفحه‌ی معامله",
      "ویجت قیمت لحظه‌ای با WebSocket",
      "صفحه‌ی گزارش مالیاتی",
      "رفع باگ گرد کردن ارقام",
      "داکیومنت کامپوننت‌ها در Storybook",
      "صفحه‌ی دعوت دوستان",
      "سیستم نقش‌ها در پنل ادمین",
      "بازطراحی صفحه‌ی ورود",
      "بهبود Core Web Vitals",
      "صفحه‌ی سبد سرمایه‌گذاری خودکار",
      "مهاجرت به Next.js App Router",
      "اسکلت لودینگ صفحه‌ها",
      "جریان برداشت وجه",
      "داشبورد ادمین — گزارش کاربران",
      "صفحه‌ی تنظیمات حساب",
      "صفحه‌ی بازار — جست‌وجوی نماد",
      "آنبوردینگ کاربر جدید",
      "رفع باگ‌های نسخه‌ی ۳.۲",
      "ماژول هشدار قیمت",
      "صفحه‌ی مقایسه‌ی صندوق‌ها",
      "نمودار تخصیص دارایی",
      "صفحه‌ی تاریخچه‌ی سفارش‌ها — نسخه‌ی جدید",
      "بازبینی دسترس‌پذیری فرم‌ها",
      "داشبورد مدیریت ریسک",
    ],
    doneCount: 34,
    sessions: ["توسعه‌ی داشبورد نوآ", "کامپوننت‌های پنل معامله", "رفع باگ‌های نوآ", "کد ریویو تیم نوآ", "بهینه‌سازی پرفورمنس نوآ", "پیاده‌سازی صفحه‌ی جدید نوآ"],
    payments: [],
  },
  {
    key: "ketab",
    name: "فروشگاه آنلاین کتاب‌باز",
    description: "فرانت‌اند فروشگاه کتاب با Next.js — پروژه‌ی مایلستونی",
    color: "#c9862e",
    startAgo: 352,
    endAgo: 268,
    status: "COMPLETED",
    weight: 0.85,
    tasks: [
      "جلسه‌ی نیازسنجی با تیم کتاب‌باز",
      "معماری کامپوننت‌ها",
      "صفحه‌ی اصلی فروشگاه",
      "صفحه‌ی محصول و نقدها",
      "سبد خرید و پرداخت",
      "جست‌وجو با فیلتر نویسنده و ناشر",
      "پنل کاربری و سفارش‌ها",
      "سئوی صفحات محصول",
      "تست و رفع باگ نهایی",
      "تحویل و آموزش به تیم",
    ],
    sessions: ["پیاده‌سازی فروشگاه کتاب‌باز", "سبد خرید کتاب‌باز", "سئوی کتاب‌باز", "رفع باگ کتاب‌باز"],
    payments: [
      { ago: 352, amount: 25_000_000, note: "پیش‌پرداخت فروشگاه کتاب‌باز" },
      { ago: 310, amount: 20_000_000, note: "مایلستون دوم کتاب‌باز" },
      { ago: 266, amount: 25_000_000, note: "تسویه‌ی نهایی کتاب‌باز" },
    ],
  },
  {
    key: "berlin",
    name: "پنل ادمین لجستیک (مشتری آلمانی)",
    description: "پنل مدیریت ناوگان و سفارش برای یک استارتاپ لجستیک در برلین — ریموت، ساعتی",
    color: "#4a90c9",
    startAgo: 300,
    endAgo: 190,
    status: "COMPLETED",
    weight: 1.15,
    tasks: [
      "جلسه‌ی آشنایی با تیم برلین",
      "راه‌اندازی مونوریپو و CI",
      "نقشه‌ی زنده‌ی ناوگان",
      "جدول سفارش‌ها با فیلتر و مرتب‌سازی",
      "صفحه‌ی جزئیات مسیر",
      "سیستم ترجمه‌ی آلمانی/انگلیسی",
      "داشبورد KPI راننده‌ها",
      "اتصال به API رهگیری",
      "تست‌های واحد ماژول قیمت‌گذاری",
      "بهینه‌سازی رندر نقشه",
      "صفحه‌ی گزارش ماهانه",
      "تحویل نسخه‌ی ۱.۰",
    ],
    sessions: ["پنل لجستیک برلین", "نقشه‌ی ناوگان", "جلسه‌ی همگام‌سازی با برلین", "رفع باگ پنل برلین"],
    payments: [
      { ago: 296, amount: 45_000_000, note: "صورت‌حساب ماه اول — مشتری آلمانی" },
      { ago: 245, amount: 48_000_000, note: "صورت‌حساب ماه دوم و سوم — مشتری آلمانی" },
      { ago: 190, amount: 52_000_000, note: "تسویه‌ی نهایی پنل لجستیک" },
    ],
  },
  {
    key: "lingo",
    name: "اپ آموزش زبان «واژه»",
    description: "PWA آموزش لغت — مشتری بودجه را قطع کرد و پروژه متوقف شد",
    color: "#8a7ac9",
    startAgo: 285,
    endAgo: 262,
    status: "ARCHIVED",
    weight: 0.45,
    tasks: ["طراحی جریان مرور لغت", "پیاده‌سازی فلش‌کارت‌ها", "حالت آفلاین"],
    doneCount: 2,
    sessions: ["پیاده‌سازی اپ واژه", "فلش‌کارت‌های واژه"],
    payments: [{ ago: 285, amount: 10_000_000, note: "پیش‌پرداخت اپ واژه" }],
  },
  {
    key: "nowruz",
    name: "لندینگ کمپین نوروزی دیجی‌پلاس",
    description: "لندینگ و صفحه‌های کمپین نوروز ۱۴۰۵ — ددلاین سفت، کار شبانه",
    color: "#c95a4c",
    startAgo: 248,
    endAgo: 226,
    status: "COMPLETED",
    weight: 1.35,
    tasks: [
      "دریافت بریف کمپین",
      "اسکلت لندینگ و انیمیشن‌ها",
      "صفحه‌ی قرعه‌کشی",
      "کدهای تخفیف و تایمر شمارش معکوس",
      "تست بار و بهینه‌سازی",
      "انتشار نهایی کمپین",
    ],
    sessions: ["لندینگ کمپین نوروزی", "انیمیشن‌های لندینگ", "تست بار کمپین"],
    payments: [
      { ago: 248, amount: 18_000_000, note: "پیش‌پرداخت لندینگ نوروزی" },
      { ago: 224, amount: 22_000_000, note: "تسویه‌ی لندینگ نوروزی" },
    ],
  },
  {
    key: "clinic",
    name: "ری‌دیزاین اپ نوبت‌دهی کلینیک سینا",
    description: "بازطراحی و پیاده‌سازی فرانت‌اند سامانه‌ی نوبت‌دهی — با ۲۰٪ نرخ بالاتر و زمان‌بندی منعطف",
    color: "#57a89c",
    startAgo: 238,
    endAgo: 150,
    status: "COMPLETED",
    weight: 0.9,
    tasks: [
      "بررسی سامانه‌ی فعلی",
      "صفحه‌ی انتخاب پزشک",
      "تقویم نوبت‌ها",
      "پرداخت آنلاین نوبت",
      "پنل منشی",
      "پیامک یادآوری",
      "نسخه‌ی موبایل",
      "رفع ایرادهای تست کاربر",
      "تحویل نهایی",
    ],
    sessions: ["اپ نوبت‌دهی سینا", "تقویم نوبت‌ها", "پنل منشی سینا"],
    payments: [
      { ago: 236, amount: 20_000_000, note: "پیش‌پرداخت کلینیک سینا" },
      { ago: 192, amount: 22_000_000, note: "مایلستون دوم کلینیک سینا" },
      { ago: 148, amount: 26_000_000, note: "تسویه‌ی کلینیک سینا" },
    ],
  },
  {
    key: "madar",
    name: "سیستم طراحی استارتاپ مدار",
    description: "کتابخانه‌ی کامپوننت و توکن‌های طراحی برای تیم محصول مدار",
    color: "#4f9c5c",
    startAgo: 175,
    endAgo: 62,
    status: "COMPLETED",
    weight: 0.9,
    tasks: [
      "ممیزی کامپوننت‌های موجود",
      "توکن‌های رنگ و تایپوگرافی",
      "دکمه‌ها و فرم‌ها",
      "جدول و صفحه‌بندی",
      "مودال و منوها",
      "داکیومنت در Storybook",
      "پکیج npm داخلی",
      "کارگاه آموزشی برای تیم",
    ],
    sessions: ["سیستم طراحی مدار", "کامپوننت‌های مدار", "مستندسازی مدار"],
    payments: [
      { ago: 173, amount: 30_000_000, note: "پیش‌پرداخت سیستم طراحی مدار" },
      { ago: 118, amount: 30_000_000, note: "مایلستون دوم مدار" },
      { ago: 60, amount: 35_000_000, note: "تسویه‌ی سیستم طراحی مدار" },
    ],
  },
  {
    key: "set",
    name: "محصول شخصی: اپ رزرو کلاس «سِت»",
    description: "SaaS کوچک رزرو کلاس برای باشگاه‌های کراس‌فیت — اولین قدم به سمت درآمد غیر از فروش ساعت",
    color: "#b0a24a",
    startAgo: 160,
    endAgo: null,
    status: "ACTIVE",
    weight: 0.45,
    tasks: [
      "مصاحبه با مربی باشگاه",
      "تعریف MVP",
      "صفحه‌ی برنامه‌ی کلاس‌ها",
      "رزرو و لغو کلاس",
      "پنل مربی",
      "پرداخت اشتراک ماهانه",
      "لندینگ معرفی",
      "اولین باشگاه آزمایشی",
      "اعلان یادآوری کلاس",
      "گزارش حضور ماهانه",
      "اپ اندروید با Capacitor",
      "پیدا کردن باشگاه دوم",
    ],
    doneCount: 9,
    sessions: ["کدنویسی اپ سِت", "طراحی پنل مربی سِت", "پشتیبانی باشگاه آزمایشی سِت"],
    payments: [
      { ago: 24, amount: 2_500_000, note: "اولین اشتراک ماهانه‌ی سِت — باشگاه آرنا" },
      { ago: 4, amount: 2_500_000, note: "اشتراک ماهانه‌ی سِت — باشگاه آرنا" },
    ],
  },
  {
    key: "dutch",
    name: "مهاجرت Next.js — مشتری هلندی",
    description: "مهاجرت فروشگاه یک برند هلندی از CRA به Next.js — ساعتی، ریموت",
    color: "#3a8d80",
    startAgo: 55,
    endAgo: null,
    status: "ACTIVE",
    weight: 1,
    tasks: [
      "ممیزی کد فعلی",
      "برنامه‌ی مهاجرت مرحله‌ای",
      "راه‌اندازی Next.js و مسیرها",
      "مهاجرت صفحه‌ی محصول",
      "مهاجرت سبد خرید",
      "SSR صفحه‌های دسته‌بندی",
      "اندازه‌گیری Lighthouse قبل و بعد",
      "مهاجرت حساب کاربری",
      "تست رگرسیون",
      "انتشار تدریجی",
    ],
    doneCount: 6,
    sessions: ["مهاجرت Next.js هلندی", "SSR صفحه‌های هلندی", "جلسه‌ی همگام‌سازی با آمستردام"],
    payments: [
      { ago: 53, amount: 40_000_000, note: "صورت‌حساب ماه اول — مشتری هلندی" },
      { ago: 18, amount: 42_000_000, note: "صورت‌حساب ماه دوم — مشتری هلندی" },
    ],
  },
];

const LEARNING_SESSIONS = [
  "دوره‌ی Advanced React Patterns",
  "مطالعه‌ی کتاب «تفکر، سریع و کند»",
  "دوره‌ی طراحی سیستم فرانت‌اند",
  "مطالعه‌ی کتاب «عادت‌های اتمی»",
  "یادگیری Rust — فصل‌های اول",
  "مطالعه‌ی مستندات React Server Components",
  "دوره‌ی تایپ‌اسکریپت پیشرفته",
  "مطالعه‌ی کتاب «طراحی اشیای روزمره»",
  "تمرین الگوریتم",
  "مطالعه‌ی کتاب «پول و روان»",
];
const ADMIN_SESSIONS = ["پاسخ به ایمیل مشتری‌ها", "صدور فاکتور", "برآورد زمان پروژه‌ی جدید", "برنامه‌ریزی هفته", "نوشتن پروپوزال"];
const SOCIAL_SESSIONS = ["یوتیوب", "توییتر (ایکس)", "اینستاگرام", "یوتیوب — ویدیوهای پشت‌سرهم", "ردیت"];
const FUN_SESSIONS = ["سریال", "فیلم", "بازی پلی‌استیشن"];
const REST_SESSIONS = ["پیاده‌روی پارک بدون گوشی", "آشپزی آرام", "قدم زدن عصرگاهی"];
const PERSONAL_TASKS = [
  "خرید هفتگی",
  "تمدید اشتراک باشگاه",
  "سفارش مکمل پروتئین",
  "شستن ماشین لباسشویی",
  "پرداخت شارژ ساختمان",
  "تماس با مامان",
  "تعمیر شیر آشپزخانه",
  "بک‌آپ گرفتن از لپ‌تاپ",
  "مرتب کردن میز کار",
  "پیگیری بیمه‌ی تکمیلی",
  "رزرو نوبت آرایشگاه",
  "سفارش کتاب جدید",
  "آپدیت رزومه",
  "مرور اشتراک‌های ماهانه",
  "خرید هدیه‌ی تولد",
];

// ------------------------------------------------------------------------------------------------------------

async function assertAllowedDatabase() {
  if (process.env.ALLOW_NON_SQLITE_DEMO === "1") return;
  try {
    await prisma.$queryRawUnsafe("SELECT sqlite_version()");
  } catch {
    console.error("Refusing to run against a non-SQLite database. Set ALLOW_NON_SQLITE_DEMO=1 if you really mean it.");
    process.exit(1);
  }
}

async function main() {
  await assertAllowedDatabase();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayStart = (ago: number) => new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - ago);
  const atExact = (ago: number, hour: number, minute = 0) => {
    const d = dayStart(ago);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const at = (ago: number, hour: number, minute = 0) => {
    const d = atExact(ago, hour, minute);
    return d > now ? new Date(now) : d;
  };
  const weekdayOf = (ago: number) => dayStart(ago).getDay(); // 0 Sun … 5 Fri, 6 Sat

  // Periods of the year
  const sick = new Set([112, 111, 110]);
  const trip = new Set([221, 220, 219, 218, 217, 97, 96, 95]); // Nowruz up north, then Yazd
  const offDesk = (ago: number) => sick.has(ago) || trip.has(ago);
  const crunch = (ago: number) => ago <= 300 && ago >= 224; // the over-committed winter
  const deadlineDays = new Set([268, 267, 252, 241, 233, 229, 228, 227, 226, 191, 190, 151, 150, 63, 62]);

  // --- clean slate ---------------------------------------------------------------------------------------------
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: EMAIL }, { id: USER_ID }] } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("Removed the previous Mehdi demo account.");
  }

  const user = await prisma.user.create({
    data: {
      id: USER_ID,
      name: NAME,
      email: EMAIL,
      emailVerifiedAt: dayStart(WINDOW_DAYS),
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      createdAt: dayStart(WINDOW_DAYS),
      settings: {
        create: { monthlyIncome: 68_000_000, workingHoursMonth: 150, dailyProductiveTargetMin: 360, wakeHour: 7, sleepHour: 23 },
      },
      license: { create: { status: "LIFETIME" } },
    },
  });

  // --- categories ----------------------------------------------------------------------------------------------
  await prisma.category.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: user.id, createdAt: dayStart(WINDOW_DAYS) })) });
  await prisma.category.createMany({
    data: [
      { userId: user.id, name: "خوراک", icon: "🍲", color: "#c97a3a", kind: "NEUTRAL", valueType: "EXPENSE", createdAt: dayStart(WINDOW_DAYS) },
      { userId: user.id, name: "اشتراک و ابزار کاری", icon: "🧰", color: "#5a6bc9", kind: "PRODUCTIVE", valueType: "EXPENSE", createdAt: dayStart(WINDOW_DAYS) },
      { userId: user.id, name: "خانه", icon: "🏠", color: "#9c7a6b", kind: "NEUTRAL", valueType: "EXPENSE", createdAt: dayStart(WINDOW_DAYS) },
    ],
  });
  let categories = await prisma.category.findMany({ where: { userId: user.id } });
  const cat = (name: string) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`no category named ${name}`);
    return found;
  };
  await prisma.category.update({ where: { id: cat("یادگیری").id }, data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 350_000 } });
  await prisma.category.update({ where: { id: cat("ورزش").id }, data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 120_000 } });
  await prisma.category.update({ where: { id: cat("استراحت بدون تکنولوژی").id }, data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 80_000 } });
  const reading = await prisma.category.create({
    data: { userId: user.id, name: "کتاب‌خوانی", icon: "📖", color: "#4c8577", kind: "PRODUCTIVE", valueType: "ASSET", parentCategoryId: cat("یادگیری").id, generatesVirtualAsset: true, virtualAssetValuePerHour: 300_000, createdAt: dayStart(WINDOW_DAYS - 3) },
  });
  categories = await prisma.category.findMany({ where: { userId: user.id } });

  // --- accounts ------------------------------------------------------------------------------------------------
  const card = await prisma.financeAccount.create({ data: { userId: user.id, name: "کارت ملت (حساب جاری)", type: "BANK_CARD", initialBalance: 41_000_000, isDefault: true, createdAt: dayStart(WINDOW_DAYS) } });
  const cash = await prisma.financeAccount.create({ data: { userId: user.id, name: "کیف پول نقدی", type: "CASH", initialBalance: 1_200_000, createdAt: dayStart(WINDOW_DAYS) } });
  const fund = await prisma.financeAccount.create({ data: { userId: user.id, name: "صندوق سرمایه‌گذاری شخصی", type: "INVESTMENT", initialBalance: 0, createdAt: dayStart(198) } });
  const carAcc = await prisma.financeAccount.create({ data: { userId: user.id, name: "حساب پس‌انداز ماشین", type: "BANK_ACCOUNT", initialBalance: 0, createdAt: dayStart(198) } });
  const emergency = await prisma.financeAccount.create({ data: { userId: user.id, name: "صندوق اضطراری", type: "BANK_ACCOUNT", initialBalance: 15_000_000, createdAt: dayStart(WINDOW_DAYS - 10) } });

  // --- projects & tasks ----------------------------------------------------------------------------------------
  const projectRows = new Map<string, { row: { id: string }; categoryId: string; def: ProjectDef }>();
  for (const def of PROJECTS) {
    const row = await prisma.project.create({
      data: { userId: user.id, name: def.name, description: def.description, color: def.color, status: "ACTIVE", createdAt: at(Math.min(WINDOW_DAYS, def.startAgo), 9, 30) },
    });
    const pc = await createProjectCategory(row);
    projectRows.set(def.key, { row, categoryId: pc.id, def });
  }
  const proj = (key: string) => projectRows.get(key)!;

  function workableDay(ago: number, lo: number, hi: number): number {
    for (const delta of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const c = ago + delta;
      if (c < lo || c > hi) continue;
      if (offDesk(c) || weekdayOf(c) === 5) continue;
      return c;
    }
    return Math.min(hi, Math.max(lo, ago));
  }

  let taskCount = 0;
  for (const { row, categoryId, def } of projectRows.values()) {
    const windowEnd = def.endAgo ?? 1;
    const doneCount = def.doneCount ?? def.tasks.length;
    for (let i = 0; i < def.tasks.length; i++) {
      const title = def.tasks[i];
      if (i >= doneCount) {
        await prisma.task.create({
          data: {
            userId: user.id,
            title,
            status: def.status === "ARCHIVED" ? "CANCELLED" : "TODO",
            categoryId,
            projectId: row.id,
            dueDate: def.status === "ARCHIVED" ? null : dayStart(-(2 + 4 * (i - doneCount))),
            createdAt: at(Math.max(2, Math.min(def.startAgo, 40)), 10),
          },
        });
        taskCount++;
        continue;
      }
      const isFinal = def.endAgo !== null && i === doneCount - 1;
      const planned = isFinal ? def.endAgo! : Math.round(Math.min(def.startAgo, WINDOW_DAYS) - ((i + 0.6) / doneCount) * (Math.min(def.startAgo, WINDOW_DAYS) - windowEnd)) + randInt(-1, 1);
      const ago = isFinal ? planned : workableDay(planned, windowEnd, Math.min(def.startAgo, WINDOW_DAYS));
      const timed = chance(0.4);
      const startAt = timed ? at(ago, randInt(9, 16), randInt(0, 45)) : null;
      const endAt = startAt ? new Date(startAt.getTime() + randInt(4, 12) * 15 * 60_000) : null;
      await prisma.task.create({
        data: {
          userId: user.id,
          title,
          status: "DONE",
          categoryId,
          projectId: row.id,
          valueType: "ASSET",
          startAt,
          endAt,
          dueDate: dayStart(ago - randInt(0, 2)),
          completedAt: endAt ?? at(ago, randInt(10, 20), randInt(0, 59)),
          createdAt: at(Math.min(WINDOW_DAYS, ago + randInt(2, 10)), 10),
        },
      });
      taskCount++;
    }
  }
  for (const { row, def } of projectRows.values()) {
    if (def.status === "COMPLETED") {
      await prisma.project.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: at(def.endAgo!, 18) } });
    } else if (def.status === "ARCHIVED") {
      await prisma.project.update({ where: { id: row.id }, data: { status: "ARCHIVED" } });
    }
  }

  // --- tracked time ------------------------------------------------------------------------------------------
  function dayFactor(ago: number): number {
    if (offDesk(ago)) return 0;
    const wd = weekdayOf(ago);
    let f = wd === 5 ? 0.12 : wd === 4 ? 0.5 : 1;
    if (crunch(ago)) f *= wd === 5 ? 3 : 1.25; // even Fridays in the crunch
    if (ago <= 216 && ago >= 205) f *= 0.75; // back from the trip, deciding
    if (ago <= 109 && ago >= 106) f *= 0.7; // after the cold
    if (deadlineDays.has(ago)) f = Math.max(f, 1.4);
    return f;
  }
  // He logs about 90% of his days: the rest happen, but are not written down.
  const unlogged = new Set<number>();
  for (let ago = WINDOW_DAYS; ago >= 1; ago--) if (chance(0.09)) unlogged.add(ago);
  for (const d of deadlineDays) unlogged.delete(d);

  async function trackSession(o: { title: string; categoryId: string; projectId?: string | null; ago: number; startMinute: number; duration: number }) {
    const start = atExact(o.ago, Math.floor(o.startMinute / 60), o.startMinute % 60);
    if (start > now) return false;
    const activity = await prisma.activity.create({ data: { userId: user.id, title: o.title, categoryId: o.categoryId, projectId: o.projectId ?? null, createdAt: start } });
    const end = new Date(Math.min(start.getTime() + o.duration * 60_000, now.getTime()));
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
    await prisma.timeEntry.create({ data: { activityId: activity.id, startAt: start, endAt: end, durationMin: minutes, isRunning: false } });
    await recalcActivityDuration(activity.id);
    return true;
  }

  let sessionCount = 0;
  let wasteCount = 0;
  const heavyDays = new Set<number>(); // days that ended after 20:30 at the desk
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    if (unlogged.has(ago)) continue;
    const f = dayFactor(ago);
    const active = [...projectRows.values()].filter(({ def }) => Math.min(def.startAgo, WINDOW_DAYS) >= ago && (def.endAgo === null || ago >= def.endAgo));
    if (f > 0) {
      const count = f >= 1.2 ? pick([5, 5, 6]) : f >= 0.9 ? pick([3, 4, 4, 5]) : f >= 0.4 ? pick([1, 2, 2]) : pick([0, 1]);
      // Deep work first: 90-minute blocks from about 8:30.
      let minute = 8 * 60 + 20 + randInt(0, 40);
      for (let s = 0; s < count; s++) {
        let title: string;
        let categoryId: string;
        let projectId: string | null = null;
        let duration: number;
        if (active.length > 0 && chance(0.82)) {
          const chosen = pickWeighted(active, ({ def }) => def.weight);
          title = pick(chosen.def.sessions);
          categoryId = chosen.categoryId;
          projectId = chosen.row.id;
          duration = s === 0 ? 90 : randInt(4, 8) * 15;
        } else if (chance(0.55)) {
          title = pick(LEARNING_SESSIONS);
          categoryId = title.includes("کتاب") ? reading.id : cat("یادگیری").id;
          duration = randInt(3, 6) * 15;
        } else {
          title = pick(ADMIN_SESSIONS);
          categoryId = cat("کار").id;
          duration = randInt(2, 4) * 15;
        }
        const limit = f >= 1.2 ? 23 * 60 : 21 * 60;
        if (minute + duration > limit) break;
        if (await trackSession({ title, categoryId, projectId, ago, startMinute: minute, duration })) sessionCount++;
        minute += duration + randInt(15, 50);
      }
      if (minute > 20 * 60 + 30) heavyDays.add(ago);
    }
    // Waste time: compensating after hard weeks — most of all in the crunch.
    const recentHeavy = [1, 2, 3, 4, 5].filter((d) => heavyDays.has(ago + d)).length;
    const pWaste = crunch(ago) ? 0.6 : ago > 200 ? 0.45 : ago > 60 ? 0.35 : 0.25;
    if (!sick.has(ago) && chance(Math.min(0.9, pWaste + recentHeavy * 0.06))) {
      const binge = recentHeavy >= 3 || (weekdayOf(ago) === 5 && chance(0.4));
      const duration = binge ? randInt(6, 13) * 15 : ago > 60 ? randInt(2, 5) * 15 : randInt(1, 3) * 15;
      const startMinute = binge ? randInt(13, 16) * 60 : randInt(21, 22) * 60 + randInt(0, 30);
      if (await trackSession({ title: pick(SOCIAL_SESSIONS), categoryId: cat("شبکه‌های اجتماعی").id, ago, startMinute, duration })) wasteCount++;
    }
    if (!sick.has(ago) && chance(weekdayOf(ago) >= 4 ? 0.5 : 0.18)) {
      await trackSession({ title: pick(FUN_SESSIONS), categoryId: cat("تفریح").id, ago, startMinute: randInt(20, 21) * 60 + 30, duration: randInt(4, 8) * 15 });
    }
    if (!crunch(ago) && !sick.has(ago) && chance(ago > 200 ? 0.12 : 0.3)) {
      await trackSession({ title: pick(REST_SESSIONS), categoryId: cat("استراحت بدون تکنولوژی").id, ago, startMinute: 17 * 60 + randInt(0, 40), duration: randInt(2, 4) * 15 });
    }
  }

  // --- small tasks of a life -----------------------------------------------------------------------------------
  let smallTaskCount = 0;
  async function smallTask(title: string, ago: number, hour: number, category = pick(["شخصی", "کار", "مالی", "خانه"]), extra: Record<string, unknown> = {}) {
    const t = await prisma.task.create({
      data: { userId: user.id, title, status: "DONE", categoryId: cat(category).id, dueDate: dayStart(ago), completedAt: at(ago, hour, randInt(0, 50)), createdAt: at(Math.min(WINDOW_DAYS, ago + randInt(0, 4)), 9), ...extra },
    });
    smallTaskCount++;
    return t;
  }
  for (let ago = WINDOW_DAYS; ago >= 1; ago--) {
    if (offDesk(ago) || unlogged.has(ago)) continue;
    const { jd } = toJalali(dayStart(ago));
    if (weekdayOf(ago) === 4) await smallTask("مرور هفتگی در پروا و برنامه‌ی هفته‌ی بعد", ago, 17, "شخصی");
    if (jd === 1) {
      await smallTask("ارسال فاکتورهای ماه قبل", ago, 10, "کار");
      await smallTask("بستن حساب ماه در پروا", ago, 19, "مالی");
    }
    if (jd === 12) await smallTask("پرداخت قبض برق، گاز و اینترنت", ago, 12, "مالی");
    if (chance(0.35)) await smallTask(pick(PERSONAL_TASKS), ago, randInt(11, 20));
  }
  // Tasks with a real cost and a real time — what the Hidden Cost tab adds up.
  const costlyTasks: Array<[number, string, string, number, number, number]> = [
    [330, "تعمیر کیبورد مکانیکی", "اشتراک و ابزار کاری", 1_400_000, 11, 90],
    [289, "تمدید دامنه و هاست سایت شخصی", "اشتراک و ابزار کاری", 1_900_000, 16, 30],
    [254, "رفتن به اداره‌ی مالیات برای پرونده‌ی فریلنسری", "مالی", 350_000, 9, 210],
    [201, "مشاوره با مشاور مالی درباره‌ی صندوق‌ها", "مالی", 2_500_000, 17, 75],
    [176, "سرویس کولر", "خانه", 1_800_000, 10, 120],
    [133, "ثبت‌نام کارگاه حضوری Next.js Conf تهران", "یادگیری", 3_200_000, 9, 420],
    [83, "تعویض باتری آیفون", "شخصی", 2_700_000, 15, 100],
    [41, "خرید و نصب پایه‌ی مانیتور", "اشتراک و ابزار کاری", 2_900_000, 18, 60],
    [12, "عکاسی پرسنلی و آپدیت پروفایل لینکدین", "کار", 900_000, 16, 90],
  ];
  for (const [ago, title, category, cost, hour, minutes] of costlyTasks) {
    const startAt = atExact(ago, hour);
    const t = await smallTask(title, ago, hour, category, { startAt, endAt: new Date(startAt.getTime() + minutes * 60_000), directCost: cost, completedAt: new Date(startAt.getTime() + minutes * 60_000) });
    await syncTaskDirectCostTransaction(t.id, card.id);
    await syncTaskVirtualAsset(t.id);
  }
  // Timer-made tasks for the «زمان‌سنج» history.
  for (const ago of [6, 5, 3, 2, 1]) {
    const startAt = atExact(ago, 15, randInt(0, 20));
    const endAt = new Date(startAt.getTime() + 25 * 60_000);
    await prisma.task.create({ data: { userId: user.id, title: "پومودورو — مهاجرت Next.js", status: "DONE", source: "TIMER", categoryId: proj("dutch").categoryId, projectId: proj("dutch").row.id, startAt, endAt, completedAt: endAt, createdAt: endAt } });
  }
  // Upcoming tasks
  const upcoming: Array<[number, string, string]> = [
    [0, "ارسال گزارش هفتگی به تیم نوآ", "کار"],
    [0, "پرداخت قسط وام قرض‌الحسنه", "مالی"],
    [1, "تمرین الگوریتم — ۲ سؤال", "یادگیری"],
    [2, "پیگیری باشگاه دوم برای سِت", "کار"],
    [3, "رزرو بلیت سفر زمستانی", "شخصی"],
    [5, "انتقال ماهانه به صندوق سرمایه‌گذاری", "مالی"],
    [9, "چکاپ سالانه", "سلامت"],
  ];
  for (const [ahead, title, category] of upcoming) {
    await prisma.task.create({ data: { userId: user.id, title, status: "TODO", categoryId: cat(category).id, dueDate: dayStart(-ahead), createdAt: at(2, 9) } });
  }

  // --- calendar ------------------------------------------------------------------------------------------------
  let eventCount = 0;
  async function event(o: { ago: number; hour: number; minute?: number; duration: number; title: string; category: string; project?: string; place?: string; allDay?: boolean; attended?: boolean; cost?: number }) {
    const startAt = o.allDay ? atExact(o.ago, 0) : atExact(o.ago, o.hour, o.minute ?? 0);
    const endAt = o.allDay ? atExact(o.ago, 23, 59) : new Date(startAt.getTime() + o.duration * 60_000);
    const p = o.project ? proj(o.project) : undefined;
    const e = await prisma.event.create({
      data: {
        userId: user.id,
        title: o.title,
        location: o.place ?? null,
        allDay: !!o.allDay,
        startAt,
        endAt,
        categoryId: p ? p.categoryId : cat(o.category).id,
        projectId: p?.row.id ?? null,
        directCost: o.cost ?? 0,
        createdAt: new Date(Math.max(dayStart(WINDOW_DAYS).getTime(), startAt.getTime() - randInt(1, 6) * 86_400_000)),
      },
    });
    eventCount++;
    if (o.cost) await syncEventDirectCostTransaction(e.id, card.id);
    if (o.attended ?? endAt < now) await prisma.eventCompletion.create({ data: { eventId: e.id, occurrenceDate: startAt } });
  }

  const oneOff = [
    { ago: 360, hour: 11, duration: 60, title: "جلسه‌ی شروع با تیم کتاب‌باز", category: "کار", project: "ketab", place: "دفتر کتاب‌باز، انقلاب" },
    { ago: 345, hour: 19, duration: 150, title: "تولد آرش", category: "تفریح", place: "کافه لمیز", cost: 1_100_000 },
    { ago: 331, hour: 9, duration: 60, title: "دندان‌پزشکی — ترمیم", category: "سلامت", cost: 4_500_000 },
    { ago: 310, hour: 0, duration: 0, title: "شب یلدا خانه‌ی مامان", category: "خانواده", allDay: true },
    { ago: 301, hour: 17, duration: 60, title: "تماس معرفی با استارتاپ برلین", category: "کار", place: "Google Meet" },
    { ago: 298, hour: 16, duration: 90, title: "جلسه‌ی کیک‌آف پنل لجستیک", category: "کار", project: "berlin", place: "Zoom" },
    { ago: 284, hour: 11, duration: 60, title: "جلسه‌ی شروع اپ واژه", category: "کار", project: "lingo", place: "دفتر واژه، یوسف‌آباد" },
    { ago: 262, hour: 10, duration: 30, title: "تماس لغو پروژه‌ی واژه", category: "کار", project: "lingo", place: "تلفنی" },
    { ago: 247, hour: 10, duration: 75, title: "بریف کمپین نوروزی دیجی‌پلاس", category: "کار", project: "nowruz", place: "دفتر دیجی‌پلاس، جردن" },
    { ago: 237, hour: 12, duration: 60, title: "جلسه‌ی شروع با کلینیک سینا (نرخ +۲۰٪)", category: "کار", project: "clinic", place: "کلینیک سینا، ستارخان" },
    { ago: 231, hour: 13, duration: 90, title: "ناهار کاری با تیم نوآ", category: "کار", project: "noa", place: "رستوران شاندیز، ونک", cost: 1_800_000 },
    { ago: 226, hour: 20, duration: 60, title: "انتشار کمپین نوروزی", category: "کار", project: "nowruz", place: "آنلاین" },
    { ago: 221, hour: 0, duration: 0, title: "سفر نوروزی — ماسوله", category: "تفریح", allDay: true },
    { ago: 219, hour: 0, duration: 0, title: "سفر نوروزی — رامسر", category: "تفریح", allDay: true },
    { ago: 217, hour: 0, duration: 0, title: "برگشت از شمال", category: "تفریح", allDay: true },
    { ago: 214, hour: 18, duration: 120, title: "دید و بازدید عید — خانه‌ی خاله", category: "خانواده" },
    { ago: 199, hour: 17, duration: 60, title: "جلسه با مشاور مالی", category: "مالی", place: "میرداماد" },
    { ago: 189, hour: 17, duration: 45, title: "جلسه‌ی خداحافظی با تیم برلین", category: "کار", project: "berlin", place: "Zoom" },
    { ago: 174, hour: 11, duration: 90, title: "کیک‌آف سیستم طراحی مدار", category: "کار", project: "madar", place: "دفتر مدار، شهرک غرب" },
    { ago: 159, hour: 19, duration: 45, title: "گفت‌وگو با مربی باشگاه درباره‌ی رزرو کلاس", category: "کار", project: "set", place: "باشگاه آرنا" },
    { ago: 150, hour: 11, duration: 60, title: "تحویل نهایی اپ کلینیک سینا", category: "کار", project: "clinic", place: "کلینیک سینا" },
    { ago: 140, hour: 20, duration: 150, title: "شام با بچه‌های دانشگاه", category: "تفریح", place: "رستوران نایب", cost: 1_600_000 },
    { ago: 133, hour: 9, duration: 420, title: "کارگاه Next.js Conf تهران", category: "یادگیری", place: "مرکز همایش‌های برج میلاد" },
    { ago: 121, hour: 15, duration: 60, title: "ارائه‌ی نسخه‌ی اول سیستم طراحی به مدار", category: "کار", project: "madar", place: "دفتر مدار" },
    { ago: 104, hour: 9, duration: 45, title: "ویزیت پزشک — پیگیری سرماخوردگی", category: "سلامت", cost: 900_000 },
    { ago: 97, hour: 0, duration: 0, title: "سفر یزد — باغ دولت‌آباد", category: "تفریح", allDay: true },
    { ago: 96, hour: 0, duration: 0, title: "سفر یزد — محله‌ی فهادان", category: "تفریح", allDay: true },
    { ago: 95, hour: 0, duration: 0, title: "برگشت از یزد", category: "تفریح", allDay: true },
    { ago: 77, hour: 18, duration: 120, title: "تولد مامان", category: "خانواده", place: "خانه‌ی مامان" },
    { ago: 70, hour: 10, duration: 60, title: "مصاحبه با باشگاه آرنا برای نسخه‌ی آزمایشی سِت", category: "کار", project: "set", place: "باشگاه آرنا" },
    { ago: 63, hour: 14, duration: 180, title: "کارگاه آموزشی سیستم طراحی برای تیم مدار", category: "کار", project: "madar", place: "دفتر مدار" },
    { ago: 56, hour: 16, duration: 45, title: "تماس معرفی با برند هلندی", category: "کار", place: "Google Meet" },
    { ago: 54, hour: 16, duration: 90, title: "کیک‌آف مهاجرت Next.js", category: "کار", project: "dutch", place: "Zoom" },
    { ago: 47, hour: 20, duration: 120, title: "دورهمی دوستان", category: "تفریح", cost: 850_000 },
    { ago: 35, hour: 10, duration: 60, title: "مسابقه‌ی درون‌باشگاهی کراس‌فیت", category: "ورزش", place: "باشگاه آرنا" },
    { ago: 28, hour: 11, duration: 45, title: "دمو سِت برای باشگاه آرنا", category: "کار", project: "set", place: "باشگاه آرنا" },
    { ago: 21, hour: 9, minute: 30, duration: 60, title: "دندان‌پزشکی — جرم‌گیری", category: "سلامت", cost: 1_500_000 },
    { ago: 14, hour: 16, duration: 60, title: "ارائه‌ی Lighthouse قبل/بعد به مشتری هلندی", category: "کار", project: "dutch", place: "Zoom" },
    { ago: 7, hour: 19, duration: 150, title: "تولد بهراد", category: "تفریح", place: "کافه رخ", cost: 950_000 },
    { ago: 3, hour: 17, duration: 45, title: "تماس با باشگاه دوم (کراس‌فیت پارسا)", category: "کار", project: "set", place: "تلفنی" },
    { ago: 0, hour: 16, duration: 60, title: "جلسه‌ی همگام‌سازی با آمستردام", category: "کار", project: "dutch", place: "Zoom", attended: false },
    { ago: 0, hour: 21, duration: 60, title: "تماس تصویری با خانواده", category: "خانواده", attended: false },
    { ago: -2, hour: 11, duration: 60, title: "جلسه‌ی برنامه‌ریزی فصل با نوآ", category: "کار", project: "noa", place: "دفتر نوآ" },
    { ago: -4, hour: 10, duration: 120, title: "کوه‌پیمایی درکه", category: "ورزش" },
    { ago: -9, hour: 9, duration: 60, title: "چکاپ سالانه", category: "سلامت", place: "آزمایشگاه پارس" },
  ];
  for (const e of oneOff) await event(e);

  // Real recurrence rules: the weekly standup with Noa and the three CrossFit evenings.
  async function recurring(o: { title: string; category: string; weekday: number; hour: number; minute?: number; duration: number; fromAgo: number; attend: (ago: number) => boolean; place?: string; project?: string }) {
    let first = o.fromAgo;
    while (weekdayOf(first) !== o.weekday) first--;
    const startAt = atExact(first, o.hour, o.minute ?? 0);
    const p = o.project ? proj(o.project) : undefined;
    const e = await prisma.event.create({
      data: {
        userId: user.id,
        title: o.title,
        location: o.place ?? null,
        startAt,
        endAt: new Date(startAt.getTime() + o.duration * 60_000),
        categoryId: p ? p.categoryId : cat(o.category).id,
        projectId: p?.row.id ?? null,
        recurrenceFreq: "WEEKLY",
        recurrenceInterval: 1,
        createdAt: dayStart(Math.min(WINDOW_DAYS, o.fromAgo)),
      },
    });
    eventCount++;
    let done = 0;
    for (let ago = first; ago >= 0; ago -= 7) {
      const occ = atExact(ago, o.hour, o.minute ?? 0);
      const occEnd = new Date(occ.getTime() + o.duration * 60_000);
      if (occEnd < now && !offDesk(ago) && o.attend(ago)) {
        await prisma.eventCompletion.create({ data: { eventId: e.id, occurrenceDate: occ } });
        done++;
      }
    }
    return done;
  }
  await recurring({ title: "استندآپ هفتگی تیم نوآ", category: "کار", project: "noa", weekday: 0, hour: 10, duration: 45, fromAgo: 362, place: "Google Meet", attend: () => chance(0.94) });
  // CrossFit: kept in calm periods, dropped in the crunch and on deadline evenings.
  const gymAttend = (ago: number) => {
    if (deadlineDays.has(ago) || heavyDays.has(ago)) return chance(0.15);
    if (crunch(ago)) return chance(0.45);
    if (ago > 200) return chance(0.7);
    if (ago > 45) return chance(0.82);
    return chance(0.95);
  };
  let gym = 0;
  gym += await recurring({ title: "کراس‌فیت — باشگاه آرنا", category: "ورزش", weekday: 6, hour: 18, minute: 30, duration: 90, fromAgo: 364, place: "باشگاه آرنا", attend: gymAttend });
  gym += await recurring({ title: "کراس‌فیت — باشگاه آرنا", category: "ورزش", weekday: 1, hour: 18, minute: 30, duration: 90, fromAgo: 364, place: "باشگاه آرنا", attend: gymAttend });
  gym += await recurring({ title: "کراس‌فیت — باشگاه آرنا", category: "ورزش", weekday: 3, hour: 18, minute: 30, duration: 90, fromAgo: 364, place: "باشگاه آرنا", attend: gymAttend });
  // The fourth session: Thursday mornings, as separate events since it is not every week.
  for (let ago = WINDOW_DAYS; ago >= 1; ago--) {
    if (weekdayOf(ago) !== 4 || offDesk(ago)) continue;
    const p = crunch(ago) ? 0.15 : ago > 200 ? 0.35 : ago > 45 ? 0.5 : 0.85;
    if (!chance(p)) continue;
    await event({ ago, hour: 10, duration: 75, title: "کراس‌فیت پنجشنبه — WOD آزاد", category: "ورزش", place: "باشگاه آرنا" });
    gym++;
  }

  // --- notes -------------------------------------------------------------------------------------------------
  const NOTES: Array<[number, number, string]> = [
    [365, 22, "امروز پروا رو نصب کردم. قرار نیست یه کارفرمای دوم داشته باشم — فقط می‌خوام بفهمم وقت و پولم کجا می‌ره."],
    [358, 21, "اولین هفته. ثبت کردن کمتر از دو دقیقه در روز طول می‌کشه. فعلاً قابل تحمله."],
    [336, 22, "اولین گزارش ماهانه: ۲۱ ساعت شبکه‌های اجتماعی. این عدد رو انتظار نداشتم."],
    [301, 22, "پیشنهاد استارتاپ برلین. رقمش وسوسه‌کننده‌ست، ولی یعنی چهار پروژه هم‌زمان. قبول کردم."],
    [284, 23, "پروژه‌ی واژه رو هم گرفتم. می‌دونم زیادیه."],
    [270, 23, "سه شب پشت سر هم تا ۱۱ کار کردم. دو جلسه‌ی باشگاه سوخت."],
    [262, 20, "مشتری واژه پروژه رو لغو کرد. عجیبه که بیشتر احساس سبکی دارم تا ضرر."],
    [256, 22, "آخر ماه: درآمد عالی بود. ولی پس‌انداز تقریباً تکون نخورده. پروا می‌گه ۳۲ میلیون فقط خرج خرد و غذای بیرون شده."],
    [241, 23, "پول وارد حساب شد، رقمش هم عالیه؛ اما چرا حس می‌کنم ماه پیش هیچ زندگی‌ای نکردم؟"],
    [237, 21, "به کلینیک سینا گفتم فقط با زمان‌بندی منعطف و ۲۰٪ بالاتر. قبول کردن! اولین باره که مشروط کردم."],
    [229, 1, "ساعت یک شبه و هنوز لندینگ نوروزی تموم نشده. هزینه‌ی پنهان این پروژه رو باید ببینم."],
    [224, 21, "کمپین منتشر شد. گزارش پروا: ۷۸ ساعت برای این لندینگ. با ارزش ساعتم، عملاً سودش نصف چیزیه که فکر می‌کردم."],
    [218, 20, "ماسوله. سه روزه لپ‌تاپ رو باز نکردم."],
    [211, 22, "تصمیم: از این به بعد حداکثر دو مشتری هم‌زمان. نرخ جدید برای پروژه‌های تازه."],
    [198, 21, "صندوق سرمایه‌گذاری شخصی و حساب ماشین رو باز کردم. هر ماه اول از همه، اونجا."],
    [185, 22, "بودجه‌ی خوراک و تفریح گذاشتم. نه برای محدود کردن — برای اینکه ببینم."],
    [160, 22, "شروع اپ سِت. یه چیزی که مال خودمه. هفته‌ای چند ساعت، بدون فشار."],
    [143, 21, "یک ماهه که هیچ شبی بعد از ۹ کار نکردم. کیفیت خوابم کاملاً فرق کرده."],
    [125, 22, "۱۰۰ ساعت یادگیری توی پروا ثبت شده. داشبورد دارایی‌ها می‌گه این خودش یه داراییه. قبول دارم."],
    [111, 18, "سرما خوردم. سه روز هیچی."],
    [100, 21, "این ۱۰ میلیون رو مستقیم وصل کردم به حساب ماشین. حس کنترل داشتن روی زندگیم بهم انرژی می‌ده."],
    [96, 22, "یزد. بادگیرها، آرامش. به این فکر کردم که پنج سال دیگه نمی‌خوام فقط یه چرخ‌دنده‌ی ماهر باشم."],
    [80, 21, "پیشنهاد یه پروژه‌ی سوم اومد. قبل از جواب، صفحه‌ی گزارش رو باز کردم: ظرفیت آزادم این ماه ۱۲ ساعته. رد کردم."],
    [62, 20, "سیستم طراحی مدار تحویل شد. ۳۰۰ ساعت کار، یه پروژه‌ی تموم‌شده که به دارایی‌هام اضافه شد."],
    [45, 21, "استریک عادت‌هام از ۲۰ روز رد شد. پنجشنبه‌ها هم باشگاه می‌رم."],
    [24, 22, "اولین درآمد از سِت! فقط ۲.۵ میلیون، ولی اولین پولیه که در ازای فروش ساعتم نیست."],
    [10, 21, "مرور ماه: شبکه‌های اجتماعی نصف پارسال. مطالعه دو برابر. پس‌انداز بالاخره داره رشد می‌کنه."],
    [1, 22, "یک ساله که همه‌چیز رو ثبت می‌کنم. فردا گزارش سالانه رو با دقت نگاه می‌کنم."],
  ];
  const GENERIC_NOTES = [
    "روز خوبی بود. دو بلوک تمرکز کامل قبل از ناهار.",
    "زیادی توییتر چک کردم. فردا گوشی رو تا ۱۱ دور نگه می‌دارم.",
    "باشگاه سنگین بود، ولی ذهنم باز شد.",
    "یه باگ عجیب کل صبح رو گرفت. آخرش یه خط بود.",
    "امروز فقط کار کم‌عمق. اشکالی نداره.",
    "کتاب رو تموم کردم. فصل آخرش بهترین بود.",
    "غذای خونه، خواب زود. همین.",
    "مشتری ساعت ۱۰ شب پیام داد. جواب ندادم تا صبح. حس خوبی بود.",
    "دیدم این ماه سه بار غذا سفارش دادم چون خسته بودم، نه چون گرسنه.",
    "با مامان تلفنی حرف زدم، یک ساعت. باید بیشتر زنگ بزنم.",
    "کد ریویو تیم نوآ طول کشید ولی ارزشش رو داشت.",
    "امروز هیچ جلسه‌ای نداشتم. بهترین روز کاری هفته.",
    "قهوه‌ی سوم ایده‌ی خوبی نبود.",
    "یه ساعت پیاده‌روی بدون گوشی. ایده‌ی ماژول جدید همون‌جا اومد.",
    "حساب کردم این هفته ۱۱ ساعت فقط جلسه داشتم.",
    "صبح دیر بیدار شدم و کل روز عقب بودم.",
    "WOD امروز رکورد شخصی شد.",
    "یه فاکتور عقب افتاده بود؛ پیگیری کردم و پرداخت شد.",
  ];
  const genericOrder = [...GENERIC_NOTES].sort(() => rand() - 0.5);
  let noteCount = 0;
  const noteDays = new Set<number>();
  for (const [ago, hour, text] of NOTES) {
    if (atExact(ago, Math.min(hour, 23)) > now) continue;
    await prisma.dailyNote.create({ data: { userId: user.id, day: dayKeyIso(dayStart(ago)), content: text, createdAt: at(ago, Math.min(hour, 23), randInt(0, 50)) } });
    noteDays.add(ago);
    noteCount++;
  }
  for (let ago = WINDOW_DAYS - 3; ago >= 2; ago--) {
    if (noteDays.has(ago) || offDesk(ago) || unlogged.has(ago) || !chance(0.1) || genericOrder.length === 0) continue;
    await prisma.dailyNote.create({ data: { userId: user.id, day: dayKeyIso(dayStart(ago)), content: genericOrder.pop()!, createdAt: at(ago, 22, randInt(0, 50)) } });
    noteCount++;
  }

  // --- habits ------------------------------------------------------------------------------------------------
  const STREAK_FROM = 47; // the long run that is still going today
  const HABITS: Array<{ title: string; icon: string; category: string; createdAgo: number; hour: number; value: number; p: (ago: number) => number; duration?: [number, number]; durationChance?: number; inStreak: boolean; color: string }> = [
    { title: "مطالعه‌ی ۳۰ دقیقه‌ای", icon: "📖", category: "کتاب‌خوانی", createdAgo: 360, hour: 22, value: 50_000, p: (a) => (crunch(a) ? 0.35 : a > 200 ? 0.55 : 0.75), duration: [25, 60], durationChance: 0.85, inStreak: true, color: "#4c8577" },
    { title: "بدون شبکه‌ی اجتماعی تا ساعت ۱۱", icon: "📵", category: "استراحت بدون تکنولوژی", createdAgo: 335, hour: 10, value: 40_000, p: (a) => (crunch(a) ? 0.3 : a > 200 ? 0.5 : 0.72), inStreak: true, color: "#c95a4c" },
    { title: "تمرین یا کشش روزانه", icon: "🏋️", category: "ورزش", createdAgo: 364, hour: 20, value: 60_000, p: (a) => (crunch(a) ? 0.45 : a > 200 ? 0.65 : 0.82), duration: [15, 90], durationChance: 0.7, inStreak: true, color: "#4f9c5c" },
    { title: "غذای خانگی با پروتئین کافی", icon: "🥗", category: "سلامت", createdAgo: 300, hour: 14, value: 30_000, p: (a) => (crunch(a) ? 0.35 : a > 200 ? 0.6 : 0.78), inStreak: true, color: "#5c9c7a" },
    { title: "خواب قبل از ساعت ۱۲", icon: "😴", category: "سلامت", createdAgo: 210, hour: 23, value: 30_000, p: (a) => (a > 150 ? 0.55 : 0.75), inStreak: false, color: "#6b8a9c" },
    { title: "پایان کار تا ساعت ۶ عصر", icon: "🕕", category: "شخصی", createdAgo: 208, hour: 18, value: 20_000, p: (a) => (a > 150 ? 0.6 : 0.8), inStreak: true, color: "#b0a24a" },
  ];
  const habitSummary: string[] = [];
  for (const h of HABITS) {
    const habit = await prisma.habit.create({
      data: { userId: user.id, title: h.title, icon: h.icon, color: h.color, categoryId: cat(h.category).id, virtualAssetValuePerCheckIn: h.value, createdAt: dayStart(h.createdAgo) },
    });
    let n = 0;
    for (let ago = h.createdAgo; ago >= 0; ago--) {
      if (sick.has(ago)) continue;
      let p = h.p(ago);
      if (trip.has(ago)) p *= h.title.includes("شبکه") || h.title.includes("مطالعه") ? 1 : 0.3;
      if (heavyDays.has(ago) && (h.title.includes("پایان کار") || h.title.includes("خواب"))) p *= 0.1;
      const forced = h.inStreak && ago <= STREAK_FROM;
      // Inside the streak the non-forced habit still shows up most days.
      if (!forced && !(ago <= STREAK_FROM && chance(0.8)) && rand() >= p) continue;
      const createdAt = atExact(ago, h.hour, randInt(0, 40));
      if (createdAt > now) continue;
      const withDuration = h.duration && chance(h.durationChance ?? 0);
      const ci = await prisma.habitCheckIn.create({
        data: { habitId: habit.id, date: dayStart(ago), durationMin: withDuration && h.duration ? randInt(h.duration[0], h.duration[1]) : null, createdAt },
      });
      await syncHabitCheckInVirtualAsset(ci.id);
      n++;
    }
    habitSummary.push(`${h.title}: ${n}`);
    if (h.title.startsWith("تمرین")) await prisma.settings.update({ where: { userId: user.id }, data: { calendarFeaturedType: "habit", calendarFeaturedId: habit.id } });
  }
  // A Tiny Habits trial, day 2 of 3
  await prisma.habit.create({
    data: {
      userId: user.id,
      title: "یک خط یادداشت قبل از خواب",
      icon: "✍️",
      categoryId: cat("شخصی").id,
      isTrial: true,
      cue: "بعد از اینکه گوشی رو روی شارژ گذاشتم",
      celebration: "به خودم می‌گم: یه روز دیگه ثبت شد",
      trialStartDate: dayStart(1),
      createdAt: dayStart(1),
    },
  });

  // --- money -------------------------------------------------------------------------------------------------
  let txCount = 0;
  async function tx(type: "INCOME" | "EXPENSE", ago: number, amount: number, description: string, category: string | null, account = card, extra: Record<string, unknown> = {}) {
    await prisma.transaction.create({
      data: { userId: user.id, type, amount, date: at(ago, randInt(9, 21), randInt(0, 59)), description, accountId: account.id, categoryId: category ? cat(category).id : null, ...extra },
    });
    txCount++;
  }
  async function transfer(ago: number, amount: number, description: string, from: { id: string }, to: { id: string }) {
    await prisma.transaction.create({ data: { userId: user.id, type: "TRANSFER", amount, date: at(ago, 12), description, accountId: from.id, transferToAccountId: to.id } });
    txCount++;
  }

  // Income: the Noa retainer on the 1st of each Jalali month, the milestones, the odd small job.
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const { jd } = toJalali(dayStart(ago));
    if (jd === 2) await tx("INCOME", ago, ago > 205 ? 28_000_000 : 33_600_000, "ریتینر ماهانه‌ی نوآ", "کار", card, { projectId: proj("noa").row.id });
  }
  for (const { row, def } of projectRows.values()) {
    for (const pmt of def.payments) await tx("INCOME", pmt.ago, pmt.amount, pmt.note, "کار", card, { projectId: row.id });
  }
  await tx("INCOME", 322, 6_000_000, "مشاوره‌ی یک‌روزه‌ی پرفورمنس برای یک فروشگاه", "کار");
  await tx("INCOME", 140, 4_500_000, "تدریس خصوصی React", "کار");
  await tx("INCOME", 66, 3_000_000, "فروش مانیتور قدیمی", "خرید");

  // Expenses
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const { jd } = toJalali(dayStart(ago));
    const wd = weekdayOf(ago);
    if (jd === 1) {
      await tx("EXPENSE", ago, ago > 220 ? 17_000_000 : 19_500_000, "اجاره‌ی آپارتمان", "خانه");
      await tx("EXPENSE", ago, 950_000, "شارژ ساختمان", "خانه");
    }
    if (jd === 3) {
      await tx("EXPENSE", ago, 2_300_000, "اشتراک ChatGPT و Claude", "اشتراک و ابزار کاری");
      await tx("EXPENSE", ago, 1_100_000, "اشتراک Cursor و GitHub Copilot", "اشتراک و ابزار کاری");
      await tx("EXPENSE", ago, 450_000, "اشتراک فضای ابری و سرور تست", "اشتراک و ابزار کاری");
    }
    if (jd === 5) await tx("EXPENSE", ago, ago > 220 ? 3_200_000 : 3_800_000, "شهریه‌ی ماهانه‌ی باشگاه کراس‌فیت", "ورزش");
    if (jd === 12) {
      await tx("EXPENSE", ago, randInt(5, 11) * 100_000, "قبض برق و گاز", "خانه");
      await tx("EXPENSE", ago, 890_000, "اینترنت خانگی", "خانه");
      await tx("EXPENSE", ago, randInt(4, 7) * 100_000, "شارژ موبایل", "شخصی");
    }
    if (jd === 20 && toJalali(dayStart(ago)).jm % 2 === 0) await tx("EXPENSE", ago, 2_900_000, "مکمل پروتئین وی و کراتین", "سلامت");
    if (wd === 5 && chance(0.9)) await tx("EXPENSE", ago, randInt(12, 20) * 100_000, "خرید هفتگی مواد غذایی", "خوراک", chance(0.2) ? cash : card);
    if (jd === 10) await transfer(ago, 2_500_000, "برداشت نقدی از عابربانک", card, cash);
    // Ordered food — weekly in calm times, near-daily in the crunch.
    const pFood = crunch(ago) ? 0.5 : ago > 200 ? 0.3 : 0.16;
    if (!offDesk(ago) && chance(pFood)) await tx("EXPENSE", ago, randInt(32, 65) * 10_000, pick(["سفارش غذا از اسنپ‌فود", "پیتزا", "سفارش ناهار"]), "خوراک");
    if (!offDesk(ago) && chance(crunch(ago) ? 0.35 : 0.22)) await tx("EXPENSE", ago, randInt(12, 28) * 10_000, pick(["قهوه‌ی بیرون", "کافه با دوستان", "قهوه و کیک"]), "تفریح", chance(0.4) ? cash : card);
    if (chance(0.16)) await tx("EXPENSE", ago, randInt(8, 30) * 10_000, pick(["اسنپ", "تاکسی", "مترو و اتوبوس"]), "رفت و آمد", chance(0.3) ? cash : card);
    if (crunch(ago) && chance(0.05)) await tx("EXPENSE", ago, randInt(15, 45) * 100_000, pick(["خرید هیجانی لباس", "هدفون جدید", "گجت میز کار"]), "خرید");
    if (!crunch(ago) && chance(0.025)) await tx("EXPENSE", ago, randInt(10, 30) * 100_000, pick(["لباس ورزشی", "کفش", "لوازم خانه"]), "خرید");
    if (chance(0.03)) await tx("EXPENSE", ago, randInt(3, 9) * 100_000, pick(["کتاب «تفکر، سریع و کند»", "کتاب «عادت‌های اتمی»", "کتاب «پول و روان»", "کتاب «انسان در جست‌وجوی معنا»", "کتاب «کار عمیق»"]), "یادگیری");
  }
  await tx("EXPENSE", 315, 5_800_000, "دوره‌ی Frontend Masters (سالانه)", "یادگیری");
  await tx("EXPENSE", 210, 8_500_000, "هزینه‌ی سفر نوروزی شمال", "تفریح");
  await tx("EXPENSE", 216, 4_000_000, "عیدی و هدیه‌ی خانواده", "خانواده");
  await tx("EXPENSE", 96, 7_200_000, "سفر یزد — اقامت و بلیت", "تفریح");
  await tx("EXPENSE", 168, 6_500_000, "دوره‌ی طراحی سیستم فرانت‌اند", "یادگیری");
  await tx("EXPENSE", 77, 3_500_000, "هدیه‌ی تولد مامان", "خانواده");

  // Saving, from the Nowruz decision on: pay yourself first.
  for (let ago = 197; ago >= 0; ago--) {
    const { jd } = toJalali(dayStart(ago));
    if (jd !== 3) continue;
    await transfer(ago, ago > 120 ? 10_000_000 : 14_000_000, "انتقال ماهانه به صندوق سرمایه‌گذاری", card, fund);
    await transfer(ago, ago > 120 ? 6_000_000 : 8_000_000, "پس‌انداز ماهانه‌ی ماشین", card, carAcc);
  }
  await transfer(100, 10_000_000, "پاداش پروژه‌ی سینا ← حساب ماشین", card, carAcc);
  await transfer(250, 3_000_000, "تکمیل صندوق اضطراری", card, emergency);
  await transfer(60, 5_000_000, "تکمیل صندوق اضطراری", card, emergency);
  // Fund profit, booked as income on the investment account.
  for (const ago of [150, 120, 90, 60, 30]) await tx("INCOME", ago, Math.round((197 - ago) * 95_000), "سود صندوق درآمد ثابت", "مالی", fund);

  // Installments
  async function plan(o: { title: string; startAgo: number; n: number; amount: number; total: number; dueDay: number; notes?: string }) {
    const startDate = dayStart(o.startAgo);
    const schedule = generateInstallmentSchedule({ startDate, dueDay: o.dueDay, numberOfInstallments: o.n, installmentAmount: o.amount });
    const p = await prisma.installmentPlan.create({
      data: { userId: user.id, title: o.title, totalAmount: o.total, installmentAmount: o.amount, numberOfInstallments: o.n, dueDay: o.dueDay, startDate, notes: o.notes ?? null, createdAt: startDate, installments: { create: schedule } },
      include: { installments: { orderBy: { index: "asc" } } },
    });
    for (const inst of p.installments.filter((i) => i.dueDate < todayStart)) {
      const t = await prisma.transaction.create({
        data: { userId: user.id, type: "EXPENSE", amount: inst.amount, date: inst.dueDate, description: `پرداخت قسط ${inst.index} از ${p.title}`, accountId: card.id, installmentId: inst.id },
      });
      await prisma.installment.update({ where: { id: inst.id }, data: { status: "PAID", paidAt: t.date } });
    }
  }
  await plan({ title: "اقساط مانیتور ارگونومیک و صندلی", startAgo: 282, n: 12, amount: 5_400_000, total: 57_000_000, dueDay: 15, notes: "خرید اقساطی از دیجی‌کالا — ۱۲ ماهه" });
  await plan({ title: "وام قرض‌الحسنه‌ی بانک", startAgo: 330, n: 24, amount: 4_350_000, total: 100_000_000, dueDay: 5, notes: "وام ۱۰۰ میلیونی، کارمزد ۴٪" });

  // Real assets
  const assets: Array<[string, string, number, number, number]> = [
    ["مک‌بوک پرو M3", "الکترونیک", 185_000_000, 168_000_000, 420],
    ["مانیتور ارگونومیک ۳۲ اینچ 4K", "الکترونیک", 38_000_000, 34_000_000, 282],
    ["صندلی ارگونومیک", "لوازم کار", 19_000_000, 16_500_000, 282],
    ["آیفون ۱۵", "الکترونیک", 92_000_000, 80_000_000, 520],
    ["کیبورد مکانیکی و تجهیزات میز", "لوازم کار", 9_500_000, 7_000_000, 380],
    ["دو ربع سکه‌ی بهار آزادی", "طلا", 52_000_000, 78_000_000, 300],
  ];
  for (const [name, category, price, value, ago] of assets) {
    await prisma.asset.create({ data: { userId: user.id, name, category, purchasePrice: price, currentValue: value, purchaseDate: dayStart(ago), createdAt: dayStart(Math.min(ago, WINDOW_DAYS)) } });
  }

  // Goals and budgets
  await prisma.savingsGoal.create({ data: { userId: user.id, title: "خرید ماشین (پیش‌پرداخت)", targetAmount: 350_000_000, targetDate: dayStart(-420), accountId: carAcc.id, createdAt: dayStart(198) } });
  await prisma.savingsGoal.create({ data: { userId: user.id, title: "سرمایه‌ی پایه‌ی صندوق شخصی", targetAmount: 250_000_000, targetDate: dayStart(-240), accountId: fund.id, createdAt: dayStart(198) } });
  await prisma.savingsGoal.create({ data: { userId: user.id, title: "صندوق اضطراری شش‌ماهه", targetAmount: 120_000_000, targetDate: dayStart(-300), accountId: emergency.id, createdAt: dayStart(WINDOW_DAYS - 10) } });
  const budgets: Array<[string, number]> = [["خوراک", 9_000_000], ["تفریح", 4_000_000], ["خرید", 5_000_000], ["رفت و آمد", 2_500_000], ["اشتراک و ابزار کاری", 4_500_000]];
  for (const [name, capAmount] of budgets) await prisma.budget.create({ data: { userId: user.id, categoryId: cat(name).id, monthlyCap: capAmount, createdAt: dayStart(185) } });

  // Completed projects become virtual assets once all their money and time exists.
  for (const { row, def } of projectRows.values()) if (def.status === "COMPLETED") await syncProjectCompletionAsset(row.id);

  // --- checklists & inbox ------------------------------------------------------------------------------------
  async function checklist(title: string, createdAgo: number, items: Array<[string, boolean, string[]?]>, note?: string) {
    const root = await prisma.checklistItem.create({ data: { userId: user.id, title, note: note ?? null, createdAt: dayStart(createdAgo), sortOrder: 0 } });
    let order = 0;
    for (const [t, checked, children] of items) {
      const item = await prisma.checklistItem.create({
        data: { userId: user.id, parentId: root.id, title: t, checked, checkedAt: checked ? at(Math.max(0, createdAgo - randInt(1, 5)), 18) : null, sortOrder: order++, createdAt: dayStart(createdAgo) },
      });
      let co = 0;
      for (const c of children ?? []) {
        await prisma.checklistItem.create({ data: { userId: user.id, parentId: item.id, title: c, checked, checkedAt: checked ? at(Math.max(0, createdAgo - 2), 19) : null, sortOrder: co++, createdAt: dayStart(createdAgo) } });
      }
    }
  }
  await checklist("تحویل هر پروژه‌ی فرانت‌اند", 150, [
    ["Lighthouse بالای ۹۰", true],
    ["تست روی سافاری و موبایل", true],
    ["بررسی دسترس‌پذیری", true, ["کنتراست رنگ", "ناوبری با کیبورد"]],
    ["ارسال فاکتور نهایی", false],
    ["ثبت ساعت نهایی در پروا و بستن پروژه", false],
  ]);
  await checklist("سفر یزد", 105, [
    ["رزرو اقامتگاه سنتی", true],
    ["بلیت قطار رفت و برگشت", true],
    ["تحویل کارهای نوآ قبل از سفر", true],
    ["پیام «خارج از دسترس» به مشتری‌ها", true],
  ]);
  await checklist("راه‌اندازی صندوق سرمایه‌گذاری شخصی", 200, [
    ["مقایسه‌ی سه صندوق درآمد ثابت", true],
    ["جلسه با مشاور مالی", true],
    ["افتتاح حساب کارگزاری", true],
    ["انتقال خودکار ماهانه", true],
  ]);
  await checklist("خرید ماشین", 30, [
    ["بودجه‌ی نهایی و سقف قسط", true],
    ["مقایسه‌ی سه مدل", false, ["هزینه‌ی نگهداری سالانه", "مصرف سوخت", "ارزش فروش مجدد"]],
    ["تست‌درایو", false],
    ["کارشناسی و بیمه", false],
  ]);
  await checklist("لانچ سِت برای باشگاه دوم", 6, [
    ["دمو ۱۰ دقیقه‌ای", true],
    ["قیمت‌گذاری اشتراک باشگاه‌های کوچک", false],
    ["قرارداد ساده‌ی یک‌صفحه‌ای", false],
  ]);
  const inbox: Array<[number, string, number, string | null]> = [
    [1, "ایده: گزارش حضور ماهانه برای مربی‌های سِت", 1, null],
    [1, "کتاب «چهار هزار هفته» رو بخرم", 0, null],
    [2, "از سعید بپرسم صندوق طلا بهتره یا درآمد ثابت", 0, null],
    [0, "تمدید بیمه‌ی تکمیلی تا آخر آبان", 2, null],
    [0, "نرخ ساعتی ۱۴۰۶ رو قبل از تمدید قرارداد نوآ حساب کنم", 1, null],
    [3, "یه وبینار درباره‌ی فریلنسری و هزینه‌ی پنهان ببینم", 0, null],
    [12, "خرید پایه‌ی مانیتور", 0, "TASK"],
    [20, "جلسه‌ی دمو با باشگاه آرنا", 1, "EVENT"],
    [33, "چک‌لیست خرید ماشین", 0, "CHECKLIST"],
    [40, "اشتراک نتفلیکس — لازم نیست", 0, "DISCARDED"],
    [52, "یادآوری قسط مانیتور", 1, "INSTALLMENT"],
  ];
  for (const [ago, content, priority, processedTo] of inbox) {
    await prisma.inboxItem.create({ data: { userId: user.id, content, priority, processedTo, processedAt: processedTo ? at(Math.max(0, ago - 1), 18) : null, createdAt: at(ago, randInt(9, 20)) } });
  }

  // --- «سرمایه من» history -----------------------------------------------------------------------------------
  const [timeEntries, habitCheckIns, timedTasks, assetEntries] = await Promise.all([
    prisma.timeEntry.findMany({ where: { activity: { userId: user.id, deletedAt: null, category: { kind: "PRODUCTIVE" } }, durationMin: { not: null } }, select: { startAt: true, durationMin: true } }),
    prisma.habitCheckIn.findMany({ where: { habit: { userId: user.id, deletedAt: null }, durationMin: { not: null } }, select: { date: true, durationMin: true } }),
    prisma.task.findMany({ where: { userId: user.id, deletedAt: null, projectId: { not: null }, startAt: { not: null }, endAt: { not: null } }, select: { startAt: true, endAt: true } }),
    prisma.virtualAssetEntry.findMany({ where: { userId: user.id }, select: { date: true, totalValue: true } }),
  ]);
  const minuteEvents = [
    ...timeEntries.map((t) => ({ date: t.startAt, minutes: t.durationMin ?? 0 })),
    ...habitCheckIns.map((h) => ({ date: h.date, minutes: h.durationMin ?? 0 })),
    ...timedTasks.map((t) => ({ date: t.startAt!, minutes: Math.max(0, Math.round((t.endAt!.getTime() - t.startAt!.getTime()) / 60_000)) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const valueEvents = assetEntries.map((e) => ({ date: e.date, value: e.totalValue })).sort((a, b) => a.date.getTime() - b.date.getTime());
  let cumMin = 0, cumVal = 0, mi = 0, vi = 0;
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const dayEnd = new Date(dayStart(ago).getTime() + 86_400_000 - 1);
    while (mi < minuteEvents.length && minuteEvents[mi].date <= dayEnd) cumMin += minuteEvents[mi++].minutes;
    while (vi < valueEvents.length && valueEvents[vi].date <= dayEnd) cumVal += valueEvents[vi++].value;
    const date = jalaliDateKey(dayStart(ago));
    await prisma.capitalSnapshot.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date, investedMinutes: cumMin, virtualAssetValue: cumVal },
      update: { investedMinutes: cumMin, virtualAssetValue: cumVal },
    });
  }

  await prisma.auditLog.create({ data: { userId: user.id, action: "SEED", entityType: "User", entityId: user.id, metadata: JSON.stringify({ note: "Persona demo generated by prisma/seedMehdiYear.ts" }) } });

  console.log("\n" + "=".repeat(64));
  console.log("حساب نمونه‌ی پرسونای مهدی ساخته شد (یک سال داده)");
  console.log(`ایمیل (نام کاربری): ${EMAIL}`);
  console.log(`رمز عبور:           ${PASSWORD}`);
  console.log("=".repeat(64));
  console.log(`پروژه‌ها: ${PROJECTS.length} | کارهای پروژه: ${taskCount} | کارهای روزمره: ${smallTaskCount}`);
  console.log(`جلسه‌های زمان‌دار: ${sessionCount} | اتلاف وقت: ${wasteCount} | رویدادها: ${eventCount} | جلسه‌های باشگاه: ${gym}`);
  console.log(`تراکنش‌ها: ${txCount} | یادداشت‌ها: ${noteCount} | روزهای بی‌ثبت: ${unlogged.size}`);
  for (const s of habitSummary) console.log("  عادت " + s);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
