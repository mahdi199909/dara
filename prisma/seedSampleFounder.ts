// Generates a rich, six-month-old "sample founder" account for demoing/testing the app with
// data that actually looks lived-in — completed projects next to abandoned ones, habits kept
// next to habits dropped halfway. Deliberately a separate file from seed.ts (which stays a
// small, fast fixture for fresh-db onboarding tests): this one is slow on purpose because it
// replays ~6 months of activity through the same sync functions the real app uses
// (recalcActivityDuration, syncProjectCompletionAsset, syncHabitCheckInVirtualAsset, ...), so
// every derived number (virtual assets, capital snapshots) is honestly computed from the rows
// below, never hand-set.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../src/lib/defaults";
import { recalcActivityDuration, syncDirectCostTransaction } from "../src/lib/activityService";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction, syncEventDirectCostTransaction } from "../src/lib/directCostSync";
import { createProjectCategory, syncProjectCompletionAsset } from "../src/lib/projectSync";
import { generateInstallmentSchedule } from "../src/lib/installments";
import { syncHabitCheckInVirtualAsset } from "../src/lib/habitSync";
import { jalaliDateKey } from "../src/lib/jalali";

const prisma = new PrismaClient();

const WINDOW_DAYS = 183; // ~6 months

// Deterministic PRNG (mulberry32) — reseedable/reproducible instead of Math.random(), so a
// reseed of this exact file always regenerates the same "person," which makes it possible to
// reason about and debug the generated dataset.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1405060305);
const chance = (p: number) => rand() < p;
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

async function main() {
  const email = "sample.founder@hesabkon.app";
  const password = "sample1234";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Sample founder already exists (${email}). Delete the user row (cascades to all its data) first to regenerate.`);
    return;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(todayStart.getTime() - n * 86_400_000);
  // Clamped to `now`: a "today" session scheduled for a later hour than the actual current
  // moment (the script might run at 9am) must not land in the future.
  const atHour = (d: Date, hour: number, minute = 0) => {
    const r = new Date(d);
    r.setHours(hour, minute, 0, 0);
    return r > now ? new Date(now) : r;
  };

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name: "علی رضایی",
      email,
      passwordHash,
      createdAt: daysAgo(WINDOW_DAYS),
      settings: { create: { monthlyIncome: 70_000_000, workingHoursMonth: 180 } },
      license: { create: { status: "LIFETIME" } },
    },
  });
  console.log("Created sample founder:", user.email);

  const categories = await Promise.all(
    DEFAULT_CATEGORIES.map((c) => prisma.category.create({ data: { ...c, userId: user.id, createdAt: daysAgo(WINDOW_DAYS) } }))
  );
  const cat = (name: string) => categories.find((c) => c.name === name)!;
  await prisma.category.update({
    where: { id: cat("یادگیری").id },
    data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 300_000 },
  });

  const cardAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "کارت بانکی ملی", type: "BANK_CARD", initialBalance: 8_000_000, createdAt: daysAgo(WINDOW_DAYS) },
  });
  const cashAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "صندوق نقدی", type: "CASH", initialBalance: 1_200_000, createdAt: daysAgo(WINDOW_DAYS) },
  });
  const savingsAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "حساب پس‌انداز", type: "INVESTMENT", initialBalance: 20_000_000, createdAt: daysAgo(WINDOW_DAYS) },
  });

  // --- generic helpers -------------------------------------------------------------------

  async function createActivity(opts: {
    title: string;
    categoryId?: string;
    projectId?: string;
    durationMin: number;
    directCost?: number;
    createdAt: Date;
  }) {
    const activity = await prisma.activity.create({
      data: {
        userId: user.id,
        title: opts.title,
        categoryId: opts.categoryId,
        projectId: opts.projectId,
        directCost: opts.directCost ?? 0,
        createdAt: opts.createdAt,
      },
    });
    const endAt = opts.createdAt;
    const startAt = new Date(endAt.getTime() - opts.durationMin * 60_000);
    await prisma.timeEntry.create({ data: { activityId: activity.id, startAt, endAt, durationMin: opts.durationMin, isRunning: false } });
    await recalcActivityDuration(activity.id);
    if (opts.directCost) await syncDirectCostTransaction(activity.id);
    return activity;
  }

  /** Scatters `perWeek`-ish sessions (with a `missRate` chance of a scheduled one just not
   * happening — busy weeks, sick days) across [toDaysAgo, fromDaysAgo]. This is how every
   * project's and every "life" category's time gets logged below — irregular by construction
   * rather than a suspiciously even one-per-day cadence. */
  async function logWorkSessions(opts: {
    titles: string[];
    categoryId?: string;
    projectId?: string;
    fromDaysAgo: number;
    toDaysAgo: number;
    perWeek: number;
    minDur: number;
    maxDur: number;
    missRate?: number;
  }) {
    const totalDays = Math.max(1, opts.fromDaysAgo - opts.toDaysAgo + 1);
    const targetSessions = Math.min(totalDays, Math.max(1, Math.round((totalDays / 7) * opts.perWeek)));
    const chosenDays = new Set<number>();
    let guard = 0;
    while (chosenDays.size < targetSessions && guard < targetSessions * 25) {
      guard++;
      chosenDays.add(randInt(opts.toDaysAgo, opts.fromDaysAgo));
    }
    for (const d of chosenDays) {
      if (opts.missRate && chance(opts.missRate)) continue;
      const createdAt = atHour(daysAgo(d), randInt(9, 22), randInt(0, 59));
      await createActivity({
        title: pick(opts.titles),
        categoryId: opts.categoryId,
        projectId: opts.projectId,
        durationMin: randInt(opts.minDur, opts.maxDur),
        createdAt,
      });
    }
  }

  async function scatterExpenses(opts: {
    descriptions: string[];
    categoryId: string;
    accountIds: string[];
    fromDaysAgo: number;
    toDaysAgo: number;
    count: number;
    minAmount: number;
    maxAmount: number;
  }) {
    for (let i = 0; i < opts.count; i++) {
      const d = randInt(opts.toDaysAgo, opts.fromDaysAgo);
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: "EXPENSE",
          amount: randInt(opts.minAmount, opts.maxAmount),
          date: atHour(daysAgo(d), randInt(10, 21)),
          description: pick(opts.descriptions),
          accountId: pick(opts.accountIds),
          categoryId: opts.categoryId,
        },
      });
    }
  }

  /** `probabilityForDay(daysAgo)` decides, per day since creation, the odds of a check-in — a
   * closure per habit is how the same helper covers consistent/declining/abandoned/sporadic
   * patterns without a generic "pattern" config system. `forceRecent` guarantees specific
   * recent days check in regardless of the roll, so the account's *current* streak isn't left
   * to chance — everything older than that stays genuinely randomized. */
  async function seedHabit(opts: {
    title: string;
    icon: string;
    categoryId?: string;
    virtualAssetValuePerCheckIn: number;
    createdDaysAgo: number;
    probabilityForDay: (daysAgo: number) => number;
    forceRecent?: number[];
  }) {
    const habit = await prisma.habit.create({
      data: {
        userId: user.id,
        title: opts.title,
        icon: opts.icon,
        categoryId: opts.categoryId,
        virtualAssetValuePerCheckIn: opts.virtualAssetValuePerCheckIn,
        createdAt: daysAgo(opts.createdDaysAgo),
      },
    });
    let count = 0;
    for (let d = opts.createdDaysAgo; d >= 0; d--) {
      const forced = opts.forceRecent?.includes(d) ?? false;
      if (!forced && !chance(opts.probabilityForDay(d))) continue;
      const withDuration = chance(0.4);
      const checkIn = await prisma.habitCheckIn.create({
        data: { habitId: habit.id, date: daysAgo(d), durationMin: withDuration ? randInt(10, 45) : null },
      });
      await syncHabitCheckInVirtualAsset(checkIn.id);
      count++;
    }
    return { habit, checkIns: count };
  }

  // --- Project 1: "طراحی سایت فروشگاهی مشتری" — completed freelance job -------------------

  const p1 = await prisma.project.create({
    data: { userId: user.id, name: "طراحی سایت فروشگاهی مشتری", description: "پروژه فریلنسری برای یک مشتری", status: "ACTIVE", createdAt: daysAgo(178) },
  });
  const p1Cat = await createProjectCategory(p1);
  await logWorkSessions({
    titles: ["طراحی رابط کاربری فروشگاه", "پیاده‌سازی صفحه محصولات", "کدنویسی بک‌اند سفارش‌ها", "هماهنگی با مشتری"],
    categoryId: p1Cat.id,
    projectId: p1.id,
    fromDaysAgo: 177,
    toDaysAgo: 146,
    perWeek: 4,
    minDur: 60,
    maxDur: 180,
    missRate: 0.15,
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "طراحی وایرفریم صفحات", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(176), completedAt: daysAgo(170) },
      { userId: user.id, title: "پیاده‌سازی صفحه اصلی", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(168), completedAt: daysAgo(160) },
      { userId: user.id, title: "پیاده‌سازی صفحه محصولات", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(158), completedAt: daysAgo(155) },
      { userId: user.id, title: "تست و رفع باگ", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(152), completedAt: daysAgo(148) },
    ],
  });
  const p1DeliveryTask = await prisma.task.create({
    data: {
      userId: user.id,
      title: "تحویل نهایی به مشتری",
      status: "DONE",
      categoryId: p1Cat.id,
      projectId: p1.id,
      createdAt: daysAgo(146),
      completedAt: daysAgo(146),
      startAt: new Date(daysAgo(146).getTime() - 2 * 3_600_000),
      endAt: daysAgo(146),
      incomeAmount: 12_000_000,
    },
  });
  await syncTaskIncomeTransaction(p1DeliveryTask.id);
  await prisma.project.update({ where: { id: p1.id }, data: { status: "COMPLETED", completedAt: daysAgo(145) } });
  await syncProjectCompletionAsset(p1.id);

  // --- Project 2: "ساخت اپلیکیشن موبایل شخصی" — long-running, still active, the "skill" project ---

  const p2 = await prisma.project.create({
    data: { userId: user.id, name: "ساخت اپلیکیشن موبایل شخصی", description: "پروژه شخصی یادگیری توسعه اپ موبایل", status: "ACTIVE", createdAt: daysAgo(160) },
  });
  const p2Cat = await createProjectCategory(p2);
  await logWorkSessions({
    titles: ["یادگیری فریمورک اپ موبایل", "پیاده‌سازی صفحات اپ", "دیباگ کردن اپ", "مطالعه مستندات"],
    categoryId: cat("یادگیری").id,
    projectId: p2.id,
    fromDaysAgo: 159,
    toDaysAgo: 1,
    perWeek: 2,
    minDur: 45,
    maxDur: 120,
    missRate: 0.2,
  });
  await createActivity({
    title: "پیاده‌سازی صفحات اپ",
    categoryId: cat("یادگیری").id,
    projectId: p2.id,
    durationMin: randInt(45, 90),
    createdAt: atHour(daysAgo(0), randInt(9, Math.min(22, now.getHours() || 12))),
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "طراحی معماری اپ", status: "DONE", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(155), completedAt: daysAgo(150) },
      { userId: user.id, title: "پیاده‌سازی صفحه لاگین", status: "DONE", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(125), completedAt: daysAgo(120) },
      { userId: user.id, title: "پیاده‌سازی صفحه اصلی اپ", status: "DONE", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(85), completedAt: daysAgo(80) },
      { userId: user.id, title: "اتصال به دیتابیس", status: "IN_PROGRESS", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(20) },
      { userId: user.id, title: "طراحی آیکون اپ", status: "TODO", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(5) },
    ],
  });

  // --- Project 3: "دوره آنلاین طراحی گرافیک" — abandoned after an enthusiastic start ----------

  const p3 = await prisma.project.create({
    data: { userId: user.id, name: "دوره آنلاین طراحی گرافیک", status: "ACTIVE", createdAt: daysAgo(150) },
  });
  const p3Cat = await createProjectCategory(p3);
  await logWorkSessions({
    titles: ["تماشای ویدیوی دوره", "تمرین فتوشاپ", "تمرین ایلاستریتور"],
    categoryId: p3Cat.id,
    projectId: p3.id,
    fromDaysAgo: 149,
    toDaysAgo: 131,
    perWeek: 5,
    minDur: 30,
    maxDur: 90,
    missRate: 0.1,
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "تماشای جلسات ۱ تا ۵", status: "DONE", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(148), completedAt: daysAgo(140) },
      { userId: user.id, title: "تمرین فتوشاپ", status: "DONE", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(138), completedAt: daysAgo(135) },
      { userId: user.id, title: "تماشای جلسه ۶", status: "TODO", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(131) },
      { userId: user.id, title: "پروژه پایانی دوره", status: "TODO", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(131) },
    ],
  });

  // --- Project 4: "راه‌اندازی فروشگاه اینستاگرامی" — abandoned, a bit further back ------------

  const p4 = await prisma.project.create({
    data: { userId: user.id, name: "راه‌اندازی فروشگاه اینستاگرامی", status: "ACTIVE", createdAt: daysAgo(120) },
  });
  const p4Cat = await createProjectCategory(p4);
  await logWorkSessions({
    titles: ["تحقیق بازار فروشگاه اینستا", "مکاتبه با تامین‌کننده", "عکاسی محصولات", "طراحی پیج اینستاگرام"],
    categoryId: p4Cat.id,
    projectId: p4.id,
    fromDaysAgo: 119,
    toDaysAgo: 104,
    perWeek: 4,
    minDur: 30,
    maxDur: 100,
    missRate: 0.1,
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "پیدا کردن تامین‌کننده", status: "DONE", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(118), completedAt: daysAgo(115) },
      { userId: user.id, title: "عکاسی محصولات", status: "DONE", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(112), completedAt: daysAgo(110) },
      { userId: user.id, title: "طراحی پیج اینستاگرام", status: "DONE", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(109), completedAt: daysAgo(107) },
      { userId: user.id, title: "تعیین قیمت‌گذاری", status: "TODO", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(105) },
      { userId: user.id, title: "شروع تبلیغات", status: "TODO", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(105) },
      { userId: user.id, title: "سفارش نمونه اولیه محصول", status: "CANCELLED", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(110) },
    ],
  });

  // --- Project 5: "بازسازی اتاق کار" — a short, completed project with real direct costs -----

  const p5 = await prisma.project.create({
    data: { userId: user.id, name: "بازسازی اتاق کار", status: "ACTIVE", createdAt: daysAgo(90) },
  });
  const p5Cat = await createProjectCategory(p5);
  await logWorkSessions({
    titles: ["نقاشی و رنگ‌آمیزی", "چیدمان اتاق کار", "نصب قفسه‌ها"],
    categoryId: p5Cat.id,
    projectId: p5.id,
    fromDaysAgo: 89,
    toDaysAgo: 77,
    perWeek: 3,
    minDur: 60,
    maxDur: 150,
    missRate: 0.1,
  });
  const p5PaintTask = await prisma.task.create({
    data: { userId: user.id, title: "خرید رنگ و لوازم", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(88), completedAt: daysAgo(88), directCost: 2_500_000 },
  });
  await syncTaskDirectCostTransaction(p5PaintTask.id);
  await prisma.task.create({
    data: { userId: user.id, title: "نقاشی دیوارها", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(86), completedAt: daysAgo(85) },
  });
  const p5DeskTask = await prisma.task.create({
    data: { userId: user.id, title: "خرید میز و صندلی جدید", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(81), completedAt: daysAgo(80), directCost: 8_000_000 },
  });
  await syncTaskDirectCostTransaction(p5DeskTask.id);
  await prisma.task.create({
    data: { userId: user.id, title: "چیدمان نهایی", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(77), completedAt: daysAgo(76) },
  });
  await prisma.project.update({ where: { id: p5.id }, data: { status: "COMPLETED", completedAt: daysAgo(75) } });
  await syncProjectCompletionAsset(p5.id);

  // --- Project 6: "طراحی برد الکترونیک شخصی" — newer, active, still gaining momentum ----------

  const p6 = await prisma.project.create({
    data: { userId: user.id, name: "طراحی برد الکترونیک شخصی", status: "ACTIVE", createdAt: daysAgo(40) },
  });
  const p6Cat = await createProjectCategory(p6);
  await logWorkSessions({
    titles: ["طراحی شماتیک مدار", "روتینگ برد", "لحیم‌کاری قطعات", "تست مدار"],
    categoryId: p6Cat.id,
    projectId: p6.id,
    fromDaysAgo: 39,
    toDaysAgo: 2,
    perWeek: 3,
    minDur: 60,
    maxDur: 150,
    missRate: 0.15,
  });
  await createActivity({
    title: "روتینگ برد",
    categoryId: p6Cat.id,
    projectId: p6.id,
    durationMin: randInt(60, 120),
    createdAt: atHour(daysAgo(1), randInt(15, 22)),
  });
  const p6PartsTask = await prisma.task.create({
    data: { userId: user.id, title: "خرید قطعات الکترونیک", status: "DONE", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(38), completedAt: daysAgo(38), directCost: 1_200_000 },
  });
  await syncTaskDirectCostTransaction(p6PartsTask.id);
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "طراحی شماتیک", status: "DONE", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(33), completedAt: daysAgo(30) },
      { userId: user.id, title: "سفارش PCB", status: "IN_PROGRESS", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(10) },
      { userId: user.id, title: "لحیم‌کاری قطعات", status: "TODO", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(3) },
    ],
  });

  const projectSummary = [
    { name: p1.name, outcome: "تکمیل‌شده" },
    { name: p2.name, outcome: "درحال انجام (پیگیر)" },
    { name: p3.name, outcome: "نیمه‌کاره رهاشده" },
    { name: p4.name, outcome: "نیمه‌کاره رهاشده" },
    { name: p5.name, outcome: "تکمیل‌شده" },
    { name: p6.name, outcome: "درحال انجام (تازه)" },
  ];

  // --- "life" time: the categories no single project owns ------------------------------------

  await logWorkSessions({
    titles: ["اینستاگرام", "یوتیوب", "مرور توییتر/ایکس"],
    categoryId: cat("شبکه‌های اجتماعی").id,
    fromDaysAgo: 182,
    toDaysAgo: 0,
    perWeek: 4.5,
    minDur: 15,
    maxDur: 50,
    missRate: 0.1,
  });
  await logWorkSessions({
    titles: ["فیلم دیدن", "بازی کردن", "گوش دادن پادکست"],
    categoryId: cat("تفریح").id,
    fromDaysAgo: 182,
    toDaysAgo: 0,
    perWeek: 1.5,
    minDur: 40,
    maxDur: 120,
    missRate: 0.15,
  });
  await logWorkSessions({
    titles: ["وقت گذروندن با خانواده", "تماس با خانواده"],
    categoryId: cat("خانواده").id,
    fromDaysAgo: 182,
    toDaysAgo: 0,
    perWeek: 1.2,
    minDur: 40,
    maxDur: 150,
    missRate: 0.15,
  });

  // --- standalone tasks (no project) -----------------------------------------------------

  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "تمدید بیمه ماشین", status: "DONE", categoryId: cat("مالی").id, createdAt: daysAgo(101), completedAt: daysAgo(100) },
      { userId: user.id, title: "خرید هدیه تولد مادر", status: "DONE", categoryId: cat("خانواده").id, createdAt: daysAgo(96), completedAt: daysAgo(95) },
      { userId: user.id, title: "تعویض روغن ماشین", status: "DONE", categoryId: cat("شخصی").id, createdAt: daysAgo(41), completedAt: daysAgo(40) },
      { userId: user.id, title: "برنامه‌ریزی سفر تابستان", status: "CANCELLED", categoryId: cat("تفریح").id, createdAt: daysAgo(151) },
      { userId: user.id, title: "خرید لپ‌تاپ جدید", status: "CANCELLED", categoryId: cat("خرید").id, createdAt: daysAgo(62) },
      { userId: user.id, title: "ثبت‌نام دوره زبان انگلیسی", status: "TODO", categoryId: cat("یادگیری").id, createdAt: daysAgo(14) },
      { userId: user.id, title: "پرداخت مالیات سالانه", status: "TODO", categoryId: cat("مالی").id, dueDate: new Date(now.getTime() + 10 * 86_400_000), createdAt: daysAgo(3) },
      { userId: user.id, title: "تماس با مشتری قدیمی", status: "TODO", categoryId: cat("کار").id, dueDate: new Date(now.getTime() + 2 * 86_400_000), createdAt: daysAgo(1) },
      { userId: user.id, title: "بروزرسانی رزومه", status: "TODO", categoryId: cat("شخصی").id, createdAt: daysAgo(6) },
    ],
  });
  const insuranceTask = await prisma.task.findFirstOrThrow({ where: { userId: user.id, title: "تمدید بیمه ماشین" } });
  await prisma.task.update({ where: { id: insuranceTask.id }, data: { directCost: 4_500_000 } });
  await syncTaskDirectCostTransaction(insuranceTask.id);
  const giftTask = await prisma.task.findFirstOrThrow({ where: { userId: user.id, title: "خرید هدیه تولد مادر" } });
  await prisma.task.update({ where: { id: giftTask.id }, data: { directCost: 2_000_000 } });
  await syncTaskDirectCostTransaction(giftTask.id);

  // --- habits: some kept, some half-abandoned --------------------------------------------

  const h1 = await seedHabit({
    title: "ورزش صبحگاهی",
    icon: "🏃",
    categoryId: cat("سلامت").id,
    virtualAssetValuePerCheckIn: 35_000,
    createdDaysAgo: 175,
    probabilityForDay: (d) => (d <= 82 && d >= 78 ? 0.15 : 0.85), // a rough week (sick) mid-way through
    forceRecent: [0, 1, 2, 3, 4, 5, 6],
  });
  const h2 = await seedHabit({
    title: "مطالعه کتاب غیرداستانی",
    icon: "📚",
    categoryId: cat("یادگیری").id,
    virtualAssetValuePerCheckIn: 45_000,
    createdDaysAgo: 170,
    probabilityForDay: (d) => (d >= 60 ? 0.8 : 0.45), // strong start, tapered off but never fully quit
  });
  const h3 = await seedHabit({
    title: "مدیتیشن شبانه",
    icon: "🧘",
    categoryId: cat("سلامت").id,
    virtualAssetValuePerCheckIn: 30_000,
    createdDaysAgo: 165,
    probabilityForDay: (d) => (d >= 120 ? 0.85 : 0.02), // abandoned ~4 months ago
  });
  const h4 = await seedHabit({
    title: "نوشتن دفترچه خاطرات",
    icon: "✍️",
    virtualAssetValuePerCheckIn: 25_000,
    createdDaysAgo: 140,
    probabilityForDay: (d) => {
      const inBurst = (d >= 125 && d <= 140) || (d >= 88 && d <= 100) || (d >= 42 && d <= 55) || (d >= 0 && d <= 12);
      return inBurst ? 0.85 : 0.05; // on-again-off-again, currently mid-burst
    },
  });
  const h5 = await seedHabit({
    title: "دوری از فست‌فود",
    icon: "🥗",
    categoryId: cat("سلامت").id,
    virtualAssetValuePerCheckIn: 40_000,
    createdDaysAgo: 33, // a newer habit — real people don't start everything on day one
    probabilityForDay: () => 0.78,
    forceRecent: [0],
  });

  const midTrial = await prisma.habit.create({
    data: {
      userId: user.id,
      title: "یک لیوان آب موقع بیدار شدن",
      icon: "💧",
      cue: "بعد از اینکه از خواب بیدار شدم",
      celebration: "به خودم می‌گم شروع خوبی بود",
      isTrial: true,
      trialStartDate: daysAgo(1),
      createdAt: daysAgo(1),
    },
  });
  const midTrialCheckIn = await prisma.habitCheckIn.create({ data: { habitId: midTrial.id, date: daysAgo(1) } });
  await syncHabitCheckInVirtualAsset(midTrialCheckIn.id);

  const readyTrial = await prisma.habit.create({
    data: {
      userId: user.id,
      title: "۱۰ دقیقه پیاده‌روی",
      icon: "🚶",
      cue: "بعد از اینکه ناهار خوردم",
      celebration: "با خودم می‌گم حس خوبی دارم",
      isTrial: true,
      trialStartDate: daysAgo(4),
      createdAt: daysAgo(4),
    },
  });
  for (const d of [4, 3, 2]) {
    const c = await prisma.habitCheckIn.create({ data: { habitId: readyTrial.id, date: daysAgo(d) } });
    await syncHabitCheckInVirtualAsset(c.id);
  }

  const habitSummary = [
    { title: h1.habit.title, checkIns: h1.checkIns, pattern: "پیگیر" },
    { title: h2.habit.title, checkIns: h2.checkIns, pattern: "رو به کاهش" },
    { title: h3.habit.title, checkIns: h3.checkIns, pattern: "رهاشده" },
    { title: h4.habit.title, checkIns: h4.checkIns, pattern: "نامنظم" },
    { title: h5.habit.title, checkIns: h5.checkIns, pattern: "تازه و پیگیر" },
  ];

  // --- money: income, recurring expenses, transfers, debt --------------------------------

  for (const d of [175, 145, 115, 85, 55, 25, 3]) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "INCOME",
        amount: 65_000_000 + randInt(-3, 3) * 500_000,
        date: atHour(daysAgo(d), 11),
        description: "درآمد مشاوره ماهانه",
        accountId: cardAccount.id,
        categoryId: cat("مالی").id,
      },
    });
  }

  await scatterExpenses({
    descriptions: ["خرید مواد غذایی", "خرید هفتگی", "خرید میوه و سبزی"],
    categoryId: cat("خرید").id,
    accountIds: [cardAccount.id, cardAccount.id, cashAccount.id],
    fromDaysAgo: 182,
    toDaysAgo: 0,
    count: 24,
    minAmount: 800_000,
    maxAmount: 2_200_000,
  });
  await scatterExpenses({
    descriptions: ["قبض برق", "قبض آب", "قبض گاز", "قبض اینترنت"],
    categoryId: cat("مالی").id,
    accountIds: [cardAccount.id],
    fromDaysAgo: 180,
    toDaysAgo: 3,
    count: 7,
    minAmount: 300_000,
    maxAmount: 950_000,
  });
  await scatterExpenses({
    descriptions: ["سینما", "رستوران با دوستان", "خرید بازی", "کنسرت"],
    categoryId: cat("تفریح").id,
    accountIds: [cardAccount.id, cashAccount.id],
    fromDaysAgo: 180,
    toDaysAgo: 0,
    count: 14,
    minAmount: 200_000,
    maxAmount: 1_500_000,
  });
  await scatterExpenses({
    descriptions: ["بنزین", "تاکسی", "آرایشگاه", "خرید شخصی"],
    categoryId: cat("شخصی").id,
    accountIds: [cardAccount.id, cashAccount.id],
    fromDaysAgo: 180,
    toDaysAgo: 0,
    count: 20,
    minAmount: 250_000,
    maxAmount: 900_000,
  });

  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "EXPENSE",
      amount: 45_000_000,
      date: atHour(daysAgo(88), 17),
      description: "خرید گوشی موبایل جدید",
      accountId: cardAccount.id,
      categoryId: cat("خرید").id,
    },
  });

  for (const d of [170, 140, 110, 80, 50, 20]) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "TRANSFER",
        amount: randInt(4, 9) * 1_000_000,
        date: atHour(daysAgo(d), 12),
        description: "انتقال به حساب پس‌انداز",
        accountId: cardAccount.id,
        transferToAccountId: savingsAccount.id,
      },
    });
  }

  const planStart = daysAgo(165);
  const schedule = generateInstallmentSchedule({ startDate: planStart, dueDay: 10, numberOfInstallments: 24, installmentAmount: 7_000_000 });
  const plan = await prisma.installmentPlan.create({
    data: {
      userId: user.id,
      title: "وام خرید موتورسیکلت",
      totalAmount: 160_000_000,
      installmentAmount: 7_000_000,
      numberOfInstallments: 24,
      dueDay: 10,
      startDate: planStart,
      createdAt: planStart,
      installments: { create: schedule },
    },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  const pastDue = plan.installments.filter((i) => i.dueDate < now);
  const overdueOne = pastDue[pastDue.length - 1]; // the most recent one: missed, still pending
  for (const installment of pastDue) {
    if (installment.id === overdueOne?.id) {
      await prisma.installment.update({ where: { id: installment.id }, data: { status: "OVERDUE" } });
      continue;
    }
    const tx = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "EXPENSE",
        amount: installment.amount,
        date: installment.dueDate,
        description: `پرداخت قسط ${installment.index} از ${plan.title}`,
        accountId: cardAccount.id,
        installmentId: installment.id,
      },
    });
    await prisma.installment.update({ where: { id: installment.id }, data: { status: "PAID", paidAt: tx.date } });
  }

  await prisma.asset.create({
    data: { userId: user.id, name: "لپ‌تاپ کاری", category: "الکترونیک", purchasePrice: 95_000_000, currentValue: 78_000_000, purchaseDate: daysAgo(200) },
  });
  await prisma.asset.create({
    data: { userId: user.id, name: "گوشی موبایل", category: "الکترونیک", purchasePrice: 45_000_000, currentValue: 38_000_000, purchaseDate: daysAgo(88) },
  });

  // --- calendar: events, mostly attended, one skipped -------------------------------------

  async function pastEvent(opts: { title: string; categoryId?: string; projectId?: string; daysAgo: number; hour: number; durationMin: number; attended: boolean }) {
    const startAt = atHour(daysAgo(opts.daysAgo), opts.hour);
    const endAt = new Date(startAt.getTime() + opts.durationMin * 60_000);
    const event = await prisma.event.create({
      data: { userId: user.id, title: opts.title, categoryId: opts.categoryId, projectId: opts.projectId, startAt, endAt, createdAt: startAt },
    });
    if (opts.attended) await prisma.eventCompletion.create({ data: { eventId: event.id, occurrenceDate: startAt } });
    return event;
  }

  await pastEvent({ title: "جلسه شروع پروژه با مشتری", categoryId: cat("کار").id, projectId: p1.id, daysAgo: 178, hour: 10, durationMin: 60, attended: true });
  await pastEvent({ title: "جلسه بررسی وایرفریم", categoryId: cat("کار").id, projectId: p1.id, daysAgo: 165, hour: 14, durationMin: 45, attended: true });
  await pastEvent({ title: "تحویل نهایی پروژه به مشتری", categoryId: cat("کار").id, projectId: p1.id, daysAgo: 146, hour: 11, durationMin: 60, attended: true });
  await pastEvent({ title: "دندان‌پزشکی", categoryId: cat("سلامت").id, daysAgo: 130, hour: 9, durationMin: 45, attended: true });
  await pastEvent({ title: "جلسه با تامین‌کننده", categoryId: cat("کار").id, projectId: p4.id, daysAgo: 118, hour: 16, durationMin: 60, attended: true });
  await pastEvent({ title: "قرار ملاقات خانوادگی", categoryId: cat("خانواده").id, daysAgo: 95, hour: 19, durationMin: 120, attended: true });
  await pastEvent({ title: "چکاپ سالانه", categoryId: cat("سلامت").id, daysAgo: 60, hour: 9, durationMin: 60, attended: true });
  await pastEvent({ title: "جشن تولد دوست", categoryId: cat("تفریح").id, daysAgo: 45, hour: 20, durationMin: 120, attended: false });
  await pastEvent({ title: "مصاحبه کاری", categoryId: cat("کار").id, daysAgo: 20, hour: 10, durationMin: 45, attended: true });
  await pastEvent({ title: "ویزیت پیگیری دکتر", categoryId: cat("سلامت").id, daysAgo: 5, hour: 17, durationMin: 30, attended: true });

  const upcomingMeeting = await prisma.event.create({
    data: {
      userId: user.id,
      title: "جلسه با مشتری جدید",
      categoryId: cat("کار").id,
      startAt: new Date(now.getTime() + 2 * 86_400_000),
      endAt: new Date(now.getTime() + 2 * 86_400_000 + 3_600_000),
    },
  });
  await prisma.reminder.create({
    data: {
      userId: user.id,
      targetType: "EVENT",
      eventId: upcomingMeeting.id,
      title: `یادآوری: ${upcomingMeeting.title}`,
      offsetMinutes: 30,
      remindAt: new Date(upcomingMeeting.startAt.getTime() - 30 * 60_000),
    },
  });
  await prisma.event.create({
    data: {
      userId: user.id,
      title: "ویزیت دکتر",
      categoryId: cat("سلامت").id,
      startAt: new Date(now.getTime() + 6 * 86_400_000),
      endAt: new Date(now.getTime() + 6 * 86_400_000 + 3_600_000),
    },
  });
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
  nextMonday.setHours(18, 0, 0, 0);
  await prisma.event.create({
    data: {
      userId: user.id,
      title: "جلسه تیم پروژه",
      categoryId: cat("کار").id,
      startAt: nextMonday,
      endAt: new Date(nextMonday.getTime() + 3_600_000),
      recurrenceFreq: "WEEKLY",
      recurrenceInterval: 1,
      recurrenceCount: 8,
    },
  });

  // --- capital snapshots: replay the cumulative totals day by day, so the growth chart -----
  // has real history instead of a single flat line as of "today". computeFounderCapital has
  // no "as of a past date" mode (it always sums the live, current DB), so this walks the same
  // three time-sources plus VirtualAssetEntry once, sorted, and sweeps forward day by day —
  // safe here specifically because every VirtualAssetEntry above was already written in its
  // own final form (upserted once, right after its source rows were created), so there's no
  // later mutation this sweep could miss.
  async function backfillCapitalSnapshots() {
    const [timeEntries, habitCheckIns, projectTasks, vaEntries] = await Promise.all([
      prisma.timeEntry.findMany({
        where: { activity: { userId: user.id, deletedAt: null, category: { kind: "PRODUCTIVE" } }, durationMin: { not: null } },
        select: { startAt: true, durationMin: true },
      }),
      prisma.habitCheckIn.findMany({ where: { habit: { userId: user.id, deletedAt: null }, durationMin: { not: null } }, select: { date: true, durationMin: true } }),
      prisma.task.findMany({
        where: { userId: user.id, deletedAt: null, projectId: { not: null }, startAt: { not: null }, endAt: { not: null } },
        select: { startAt: true, endAt: true },
      }),
      prisma.virtualAssetEntry.findMany({ where: { userId: user.id }, select: { date: true, totalValue: true } }),
    ]);

    const minuteEvents = [
      ...timeEntries.map((t) => ({ date: t.startAt, minutes: t.durationMin ?? 0 })),
      ...habitCheckIns.map((h) => ({ date: h.date, minutes: h.durationMin ?? 0 })),
      ...projectTasks.map((t) => ({ date: t.startAt!, minutes: Math.max(0, Math.round((t.endAt!.getTime() - t.startAt!.getTime()) / 60_000)) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    const valueEvents = vaEntries.map((e) => ({ date: e.date, value: e.totalValue })).sort((a, b) => a.date.getTime() - b.date.getTime());

    let cumMinutes = 0;
    let cumValue = 0;
    let mi = 0;
    let vi = 0;
    for (let d = WINDOW_DAYS; d >= 0; d--) {
      const dayEnd = new Date(daysAgo(d).getTime() + 86_400_000 - 1);
      while (mi < minuteEvents.length && minuteEvents[mi].date <= dayEnd) {
        cumMinutes += minuteEvents[mi].minutes;
        mi++;
      }
      while (vi < valueEvents.length && valueEvents[vi].date <= dayEnd) {
        cumValue += valueEvents[vi].value;
        vi++;
      }
      const dateKey = jalaliDateKey(daysAgo(d));
      await prisma.capitalSnapshot.upsert({
        where: { userId_date: { userId: user.id, date: dateKey } },
        create: { userId: user.id, date: dateKey, investedMinutes: cumMinutes, virtualAssetValue: cumValue },
        update: { investedMinutes: cumMinutes, virtualAssetValue: cumValue },
      });
    }
  }
  await backfillCapitalSnapshots();

  await prisma.auditLog.create({
    data: { userId: user.id, action: "SEED", entityType: "User", entityId: user.id, metadata: JSON.stringify({ note: "Sample founder generated by prisma/seedSampleFounder.ts" }) },
  });

  console.log("\n" + "=".repeat(60));
  console.log("حساب نمونه ساخته شد");
  console.log(`ایمیل:      ${email}`);
  console.log(`رمز عبور:   ${password}`);
  console.log(`نام:        ${user.name}`);
  console.log(`بازه دیتا:  ${WINDOW_DAYS} روز گذشته تا امروز`);
  console.log("=".repeat(60));
  console.log("\nپروژه‌ها:");
  for (const p of projectSummary) console.log(`  - ${p.name}: ${p.outcome}`);
  console.log("\nعادت‌ها:");
  for (const h of habitSummary) console.log(`  - ${h.title}: ${h.pattern} (${h.checkIns} بار ثبت شده) `);
  console.log(`  - ${midTrial.title}: آزمایشی، در حال انجام`);
  console.log(`  - ${readyTrial.title}: آزمایشی، آماده تصمیم نگه‌داشتن/رهاکردن`);
  console.log("\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
