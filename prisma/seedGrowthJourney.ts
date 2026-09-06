// Generates a full year of a "personal development" persona — someone who started using the
// app to slowly build habits and skills, stumbled early (an abandoned course, a quit-then-restarted
// exercise habit, an impulsive purchase), then found a rhythm: habit adherence climbs quarter by
// quarter, a completed course leads to real freelance/teaching income that grows over the second
// half of the year, and savings discipline improves alongside it. Every number is honestly
// derived by replaying the same sync functions the real app uses (recalcActivityDuration,
// syncProjectCompletionAsset, syncHabitCheckInVirtualAsset, ...) — nothing here is hand-set.
// See prisma/seedSampleFounder.ts for the six-month "founder" sibling of this script; this one
// shares its helper patterns but tells a year-long "توسعه فردی" growth arc instead.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../src/lib/defaults";
import { recalcActivityDuration, syncDirectCostTransaction } from "../src/lib/activityService";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction } from "../src/lib/directCostSync";
import { createProjectCategory, syncProjectCompletionAsset } from "../src/lib/projectSync";
import { generateInstallmentSchedule } from "../src/lib/installments";
import { syncHabitCheckInVirtualAsset } from "../src/lib/habitSync";
import { jalaliDateKey } from "../src/lib/jalali";

const prisma = new PrismaClient();

const WINDOW_DAYS = 365;

// Deterministic PRNG (mulberry32) — a different seed than seedSampleFounder.ts's, so the two
// scripts always generate two distinct, reproducible people.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1405061205);
const chance = (p: number) => rand() < p;
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

async function main() {
  const email = "sample.growth@hesabkon.app";
  const password = "growth1234";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Sample growth account already exists (${email}). Delete the user row (cascades to all its data) first to regenerate.`);
    return;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) => new Date(todayStart.getTime() - n * 86_400_000);
  const atHour = (d: Date, hour: number, minute = 0) => {
    const r = new Date(d);
    r.setHours(hour, minute, 0, 0);
    return r > now ? new Date(now) : r;
  };

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name: "سارا احمدی",
      email,
      passwordHash,
      createdAt: daysAgo(WINDOW_DAYS),
      settings: { create: { monthlyIncome: 38_000_000, workingHoursMonth: 176, dailyProductiveTargetMin: 240 } },
      license: { create: { status: "LIFETIME" } },
    },
  });
  console.log("Created sample growth account:", user.email);

  const categories = await Promise.all(
    DEFAULT_CATEGORIES.map((c) => prisma.category.create({ data: { ...c, userId: user.id, createdAt: daysAgo(WINDOW_DAYS) } }))
  );
  const cat = (name: string) => categories.find((c) => c.name === name)!;
  await prisma.category.update({
    where: { id: cat("یادگیری").id },
    data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 250_000 },
  });

  const cardAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "کارت بانکی", type: "BANK_CARD", initialBalance: 6_000_000, createdAt: daysAgo(WINDOW_DAYS) },
  });
  const cashAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "صندوق نقدی", type: "CASH", initialBalance: 900_000, createdAt: daysAgo(WINDOW_DAYS) },
  });
  const savingsAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "حساب پس‌انداز", type: "INVESTMENT", initialBalance: 4_000_000, createdAt: daysAgo(WINDOW_DAYS) },
  });

  // --- generic helpers (same shape as seedSampleFounder.ts) ------------------------------------

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
      const createdAt = atHour(daysAgo(d), randInt(7, 22), randInt(0, 59));
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
          date: atHour(daysAgo(d), randInt(9, 22)),
          description: pick(opts.descriptions),
          accountId: pick(opts.accountIds),
          categoryId: opts.categoryId,
        },
      });
    }
  }

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
      const withDuration = chance(0.45);
      const checkIn = await prisma.habitCheckIn.create({
        data: { habitId: habit.id, date: daysAgo(d), durationMin: withDuration ? randInt(10, 40) : null },
      });
      await syncHabitCheckInVirtualAsset(checkIn.id);
      count++;
    }
    return { habit, checkIns: count };
  }

  async function pastEvent(opts: { title: string; categoryId?: string; projectId?: string; daysAgo: number; hour: number; durationMin: number; attended: boolean }) {
    const startAt = atHour(daysAgo(opts.daysAgo), opts.hour);
    const endAt = new Date(startAt.getTime() + opts.durationMin * 60_000);
    const event = await prisma.event.create({
      data: { userId: user.id, title: opts.title, categoryId: opts.categoryId, projectId: opts.projectId, startAt, endAt, createdAt: startAt },
    });
    if (opts.attended) await prisma.eventCompletion.create({ data: { eventId: event.id, occurrenceDate: startAt } });
    return event;
  }

  // ============================================================================================
  // PROJECTS — the year's four quarters: messy start (Q1, ~d365-275), finding a rhythm (Q2,
  // ~d274-183), a completed skill turning into real income (Q3, ~d182-91), current momentum (Q4).
  // ============================================================================================

  // --- P1: "رسیدن به سطح متوسط زبان انگلیسی" — the first real commitment, completed in Q2 -----

  const p1 = await prisma.project.create({
    data: { userId: user.id, name: "رسیدن به سطح متوسط زبان انگلیسی", description: "اولین تعهد جدی امسال", status: "ACTIVE", createdAt: daysAgo(358) },
  });
  const p1Cat = await createProjectCategory(p1);
  await logWorkSessions({
    titles: ["تمرین مکالمه انگلیسی", "دوره آنلاین زبان", "تماشای فیلم با زیرنویس انگلیسی", "تمرین گرامر", "مرور لغات جدید"],
    categoryId: p1Cat.id,
    projectId: p1.id,
    fromDaysAgo: 357,
    toDaysAgo: 200,
    perWeek: 5,
    minDur: 20,
    maxDur: 60,
    missRate: 0.12,
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "ثبت‌نام کلاس آنلاین", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(358), completedAt: daysAgo(357) },
      { userId: user.id, title: "تمام کردن کتاب سطح مقدماتی", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(320), completedAt: daysAgo(270) },
      { userId: user.id, title: "تمام کردن کتاب سطح متوسط", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(260), completedAt: daysAgo(215) },
      { userId: user.id, title: "آزمون تعیین سطح", status: "DONE", categoryId: p1Cat.id, projectId: p1.id, createdAt: daysAgo(206), completedAt: daysAgo(202) },
    ],
  });
  await prisma.project.update({ where: { id: p1.id }, data: { status: "COMPLETED", completedAt: daysAgo(200) } });
  await syncProjectCompletionAsset(p1.id);

  // --- P2: "دوره آنلاین کدنویسی مقدماتی" — enthusiastic start, abandoned within two months -----

  const p2 = await prisma.project.create({
    data: { userId: user.id, name: "دوره آنلاین کدنویسی مقدماتی", status: "ACTIVE", createdAt: daysAgo(340) },
  });
  const p2Cat = await createProjectCategory(p2);
  await logWorkSessions({
    titles: ["تماشای ویدیوی دوره", "تمرین کدنویسی", "حل تمرین‌های دوره"],
    categoryId: p2Cat.id,
    projectId: p2.id,
    fromDaysAgo: 339,
    toDaysAgo: 310,
    perWeek: 5,
    minDur: 30,
    maxDur: 90,
    missRate: 0.05,
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "نصب محیط برنامه‌نویسی", status: "DONE", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(340), completedAt: daysAgo(339) },
      { userId: user.id, title: "تمام کردن ماژول ۱ و ۲", status: "DONE", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(335), completedAt: daysAgo(318) },
      { userId: user.id, title: "تمام کردن ماژول ۳", status: "TODO", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(310) },
      { userId: user.id, title: "پروژه پایانی دوره", status: "CANCELLED", categoryId: p2Cat.id, projectId: p2.id, createdAt: daysAgo(310) },
    ],
  });

  // --- P3: "دوره مربی‌گری زندگی (کوچینگ)" — the second, better-sustained course, completed Q3 ---

  const p3 = await prisma.project.create({
    data: { userId: user.id, name: "دوره مربی‌گری زندگی (کوچینگ)", status: "ACTIVE", createdAt: daysAgo(260) },
  });
  const p3Cat = await createProjectCategory(p3);
  await logWorkSessions({
    titles: ["تماشای جلسات دوره کوچینگ", "تمرین تکنیک‌های کوچینگ", "مطالعه کتاب مرتبط", "یادداشت‌برداری از جلسه"],
    categoryId: p3Cat.id,
    projectId: p3.id,
    fromDaysAgo: 259,
    toDaysAgo: 155,
    perWeek: 5,
    minDur: 40,
    maxDur: 100,
    missRate: 0.08,
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "شروع دوره و آشنایی با مبانی", status: "DONE", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(258), completedAt: daysAgo(240) },
      { userId: user.id, title: "تمرین جلسات کوچینگ با داوطلب", status: "DONE", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(210), completedAt: daysAgo(180) },
      { userId: user.id, title: "دریافت گواهی دوره", status: "DONE", categoryId: p3Cat.id, projectId: p3.id, createdAt: daysAgo(152), completedAt: daysAgo(150) },
    ],
  });
  await prisma.project.update({ where: { id: p3.id }, data: { status: "COMPLETED", completedAt: daysAgo(148) } });
  await syncProjectCompletionAsset(p3.id);

  // --- P4: "شروع تدریس خصوصی/مشاوره" — the skill turns into real, growing income -----------------

  const p4 = await prisma.project.create({
    data: { userId: user.id, name: "شروع تدریس خصوصی و مشاوره", description: "استفاده از مهارت‌های جدید برای درآمد", status: "ACTIVE", createdAt: daysAgo(145) },
  });
  const p4Cat = await createProjectCategory(p4);
  await logWorkSessions({
    titles: ["آماده‌سازی جلسه تدریس", "برگزاری جلسه مشاوره", "تهیه محتوای آموزشی", "پاسخ به سوالات مشتری‌ها"],
    categoryId: p4Cat.id,
    projectId: p4.id,
    fromDaysAgo: 144,
    toDaysAgo: 1,
    perWeek: 4.5,
    minDur: 45,
    maxDur: 90,
    missRate: 0.08,
  });
  await createActivity({
    title: "برگزاری جلسه مشاوره",
    categoryId: p4Cat.id,
    projectId: p4.id,
    durationMin: randInt(45, 90),
    createdAt: atHour(daysAgo(0), randInt(9, Math.min(22, now.getHours() || 12))),
  });
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "طراحی برنامه دوره تدریس", status: "DONE", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(144), completedAt: daysAgo(141) },
      { userId: user.id, title: "تعیین قیمت جلسات", status: "DONE", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(141), completedAt: daysAgo(140) },
      { userId: user.id, title: "پیدا کردن مشتری‌های جدید", status: "IN_PROGRESS", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(30) },
      { userId: user.id, title: "ساخت صفحه معرفی خدمات", status: "TODO", categoryId: p4Cat.id, projectId: p4.id, createdAt: daysAgo(6) },
    ],
  });

  // --- P5: "بازآرایی فضای مطالعه" — a short, completed project with real direct costs ----------

  const p5 = await prisma.project.create({
    data: { userId: user.id, name: "بازآرایی فضای مطالعه", status: "ACTIVE", createdAt: daysAgo(75) },
  });
  const p5Cat = await createProjectCategory(p5);
  await logWorkSessions({
    titles: ["مرتب‌سازی وسایل", "نصب قفسه کتاب", "چیدمان میز مطالعه"],
    categoryId: p5Cat.id,
    projectId: p5.id,
    fromDaysAgo: 74,
    toDaysAgo: 62,
    perWeek: 4.5,
    minDur: 45,
    maxDur: 120,
    missRate: 0.05,
  });
  const p5DeskTask = await prisma.task.create({
    data: { userId: user.id, title: "خرید میز و صندلی ارگونومیک", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(72), completedAt: daysAgo(72), directCost: 9_500_000 },
  });
  await syncTaskDirectCostTransaction(p5DeskTask.id);
  await prisma.task.create({
    data: { userId: user.id, title: "نصب قفسه کتاب", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(68), completedAt: daysAgo(66) },
  });
  await prisma.task.create({
    data: { userId: user.id, title: "چیدمان نهایی", status: "DONE", categoryId: p5Cat.id, projectId: p5.id, createdAt: daysAgo(62), completedAt: daysAgo(61) },
  });
  await prisma.project.update({ where: { id: p5.id }, data: { status: "COMPLETED", completedAt: daysAgo(60) } });
  await syncProjectCompletionAsset(p5.id);

  // --- P6: "آماده شدن برای نیمه‌ماراتن" — current momentum, still active today -------------------

  const p6 = await prisma.project.create({
    data: { userId: user.id, name: "آماده شدن برای نیمه‌ماراتن", status: "ACTIVE", createdAt: daysAgo(45) },
  });
  const p6Cat = await createProjectCategory(p6);
  await logWorkSessions({
    titles: ["دویدن تمرینی", "تمرین قدرتی پا", "پیاده‌روی طولانی آخر هفته", "تمرین کششی بعد از دویدن"],
    categoryId: p6Cat.id,
    projectId: p6.id,
    fromDaysAgo: 44,
    toDaysAgo: 1,
    perWeek: 5,
    minDur: 30,
    maxDur: 75,
    missRate: 0.05,
  });
  await createActivity({
    title: "دویدن تمرینی",
    categoryId: p6Cat.id,
    projectId: p6.id,
    durationMin: randInt(30, 60),
    createdAt: atHour(daysAgo(0), randInt(7, Math.min(20, now.getHours() || 8))),
  });
  const p6ShoesTask = await prisma.task.create({
    data: { userId: user.id, title: "خرید کفش دویدن", status: "DONE", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(43), completedAt: daysAgo(43), directCost: 3_200_000 },
  });
  await syncTaskDirectCostTransaction(p6ShoesTask.id);
  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "ثبت‌نام مسابقه", status: "DONE", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(44), completedAt: daysAgo(44) },
      { userId: user.id, title: "افزایش مسافت هفتگی", status: "IN_PROGRESS", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(15) },
      { userId: user.id, title: "تمرین نهایی قبل از مسابقه", status: "TODO", categoryId: p6Cat.id, projectId: p6.id, createdAt: daysAgo(2) },
    ],
  });

  const projectSummary = [
    { name: p1.name, outcome: "تکمیل‌شده (اولین قدم امسال)" },
    { name: p2.name, outcome: "نیمه‌کاره رهاشده (شروع پرشور، افت زود)" },
    { name: p3.name, outcome: "تکمیل‌شده" },
    { name: p4.name, outcome: "درحال انجام — درآمدزا شده" },
    { name: p5.name, outcome: "تکمیل‌شده" },
    { name: p6.name, outcome: "درحال انجام (تازه)" },
  ];

  // --- "life" time: the categories no single project owns --------------------------------------

  await logWorkSessions({
    titles: ["اینستاگرام", "یوتیوب", "مرور شبکه‌های اجتماعی"],
    categoryId: cat("شبکه‌های اجتماعی").id,
    fromDaysAgo: 364,
    toDaysAgo: 183,
    perWeek: 7,
    minDur: 20,
    maxDur: 60,
    missRate: 0.03,
  });
  await logWorkSessions({
    titles: ["اینستاگرام", "یوتیوب"],
    categoryId: cat("شبکه‌های اجتماعی").id,
    fromDaysAgo: 182,
    toDaysAgo: 0,
    perWeek: 4.5,
    minDur: 15,
    maxDur: 40,
    missRate: 0.1,
  });
  await logWorkSessions({
    titles: ["فیلم دیدن", "بازی کردن", "گوش دادن پادکست"],
    categoryId: cat("تفریح").id,
    fromDaysAgo: 364,
    toDaysAgo: 0,
    perWeek: 2.5,
    minDur: 40,
    maxDur: 120,
    missRate: 0.08,
  });
  await logWorkSessions({
    titles: ["وقت گذروندن با خانواده", "تماس با خانواده"],
    categoryId: cat("خانواده").id,
    fromDaysAgo: 364,
    toDaysAgo: 0,
    perWeek: 2,
    minDur: 40,
    maxDur: 150,
    missRate: 0.08,
  });

  // --- standalone tasks (no project) --------------------------------------------------------

  await prisma.task.createMany({
    data: [
      { userId: user.id, title: "تمدید بیمه", status: "DONE", categoryId: cat("مالی").id, createdAt: daysAgo(200), completedAt: daysAgo(199) },
      { userId: user.id, title: "خرید هدیه تولد پدر", status: "DONE", categoryId: cat("خانواده").id, createdAt: daysAgo(150), completedAt: daysAgo(149) },
      { userId: user.id, title: "تعویض روغن ماشین", status: "DONE", categoryId: cat("شخصی").id, createdAt: daysAgo(90), completedAt: daysAgo(89) },
      { userId: user.id, title: "ثبت‌نام کلاس یوگا", status: "CANCELLED", categoryId: cat("سلامت").id, createdAt: daysAgo(280) },
      { userId: user.id, title: "خرید کتاب‌های جدید", status: "DONE", categoryId: cat("یادگیری").id, createdAt: daysAgo(230), completedAt: daysAgo(229) },
      { userId: user.id, title: "تمدید اشتراک اپلیکیشن زبان", status: "TODO", categoryId: cat("یادگیری").id, dueDate: new Date(now.getTime() + 5 * 86_400_000), createdAt: daysAgo(4) },
      { userId: user.id, title: "پرداخت مالیات سالانه", status: "TODO", categoryId: cat("مالی").id, dueDate: new Date(now.getTime() + 12 * 86_400_000), createdAt: daysAgo(2) },
      { userId: user.id, title: "برنامه‌ریزی جشن تولد خواهر", status: "TODO", categoryId: cat("خانواده").id, dueDate: new Date(now.getTime() + 8 * 86_400_000), createdAt: daysAgo(1) },
    ],
  });
  const insuranceTask = await prisma.task.findFirstOrThrow({ where: { userId: user.id, title: "تمدید بیمه" } });
  await prisma.task.update({ where: { id: insuranceTask.id }, data: { directCost: 3_800_000 } });
  await syncTaskDirectCostTransaction(insuranceTask.id);
  const giftTask = await prisma.task.findFirstOrThrow({ where: { userId: user.id, title: "خرید هدیه تولد پدر" } });
  await prisma.task.update({ where: { id: giftTask.id }, data: { directCost: 1_800_000 } });
  await syncTaskDirectCostTransaction(giftTask.id);

  // ============================================================================================
  // HABITS — the clearest, most measurable proof of "کم‌کم خودش رو رشد داده": h1's adherence
  // climbs quarter by quarter, h2 is quit-then-restarted-and-kept, h3 is a newer habit that
  // (having learned from h2) sticks well from day one, h4 stays realistically imperfect even by
  // the end (no fabricated perfection), h5 is brand new — still-growing, present tense.
  // ============================================================================================

  const h1 = await seedHabit({
    title: "مطالعه روزانه",
    icon: "📚",
    categoryId: cat("یادگیری").id,
    virtualAssetValuePerCheckIn: 40_000,
    createdDaysAgo: 358,
    probabilityForDay: (d) => (d > 270 ? 0.25 : d > 180 ? 0.5 : d > 90 ? 0.75 : 0.9),
    forceRecent: [0, 1, 2, 3, 4, 5, 6],
  });
  const h2 = await seedHabit({
    title: "ورزش صبحگاهی",
    icon: "🏃",
    categoryId: cat("سلامت").id,
    virtualAssetValuePerCheckIn: 35_000,
    createdDaysAgo: 350,
    probabilityForDay: (d) => (d > 310 ? 0.55 : d > 250 ? 0.05 : d > 150 ? 0.35 : 0.82), // enthusiastic start, quit for ~2 months, restarted and kept
    forceRecent: [0, 1, 2, 3, 4, 5, 6],
  });
  const h3 = await seedHabit({
    title: "مدیتیشن ذهن‌آگاهی",
    icon: "🧘",
    categoryId: cat("استراحت بدون تکنولوژی").id,
    virtualAssetValuePerCheckIn: 30_000,
    createdDaysAgo: 200, // a later, more mature start — and it shows: no early wobble at all
    probabilityForDay: () => 0.8,
    forceRecent: [0, 1, 2, 3, 4],
  });
  const h4 = await seedHabit({
    title: "دفترچه سپاسگزاری",
    icon: "✍️",
    virtualAssetValuePerCheckIn: 20_000,
    createdDaysAgo: 300,
    probabilityForDay: (d) => {
      const inBurst = (d >= 280 && d <= 295) || (d >= 230 && d <= 245) || (d >= 150 && d <= 165) || (d >= 60 && d <= 75) || (d >= 5 && d <= 15);
      return inBurst ? 0.85 : 0.05; // on-again-off-again all year — kept honestly imperfect
    },
  });
  const h5 = await seedHabit({
    title: "دوری از پیمایش بی‌هدف شبکه‌های اجتماعی",
    icon: "📵",
    virtualAssetValuePerCheckIn: 25_000,
    createdDaysAgo: 28, // brand new — real people don't start everything on day one
    probabilityForDay: () => 0.8,
    forceRecent: [0, 1, 2],
  });

  const trialGratitude = await prisma.habit.create({
    data: {
      userId: user.id,
      title: "نوشتن سه چیز خوب امروز",
      icon: "📝",
      cue: "قبل از خواب",
      celebration: "لبخند می‌زنم",
      isTrial: true,
      trialStartDate: daysAgo(3),
      createdAt: daysAgo(3),
    },
  });
  for (const d of [3, 2]) {
    const c = await prisma.habitCheckIn.create({ data: { habitId: trialGratitude.id, date: daysAgo(d) } });
    await syncHabitCheckInVirtualAsset(c.id);
  }

  const trialStretch = await prisma.habit.create({
    data: {
      userId: user.id,
      title: "۵ دقیقه کشش بدن",
      icon: "🤸",
      cue: "بعد از بیدار شدن",
      celebration: "به خودم می‌گم بدنم رو دوست دارم",
      isTrial: true,
      trialStartDate: daysAgo(1),
      createdAt: daysAgo(1),
    },
  });
  const trialStretchCheckIn = await prisma.habitCheckIn.create({ data: { habitId: trialStretch.id, date: daysAgo(1) } });
  await syncHabitCheckInVirtualAsset(trialStretchCheckIn.id);

  const habitSummary = [
    { title: h1.habit.title, checkIns: h1.checkIns, pattern: "پیوسته رو به بهتر شدن (۲۵٪ → ۹۰٪)" },
    { title: h2.habit.title, checkIns: h2.checkIns, pattern: "شروع، رهاشدن، و بازگشت پایدار" },
    { title: h3.habit.title, checkIns: h3.checkIns, pattern: "شروع دیرتر، پیگیر از روز اول" },
    { title: h4.habit.title, checkIns: h4.checkIns, pattern: "نامنظم (واقع‌گرایانه، هنوز کامل نشده)" },
    { title: h5.habit.title, checkIns: h5.checkIns, pattern: "تازه و پیگیر" },
  ];

  // ============================================================================================
  // FINANCE — a fixed salary throughout, plus a *new*, growing teaching-income stream that only
  // starts once P4 exists (~d145) — the direct financial proof that the year's growth paid off.
  // Savings transfers grow the same way: small/rare in Q1, frequent/large by Q4.
  // ============================================================================================

  for (const d of [355, 325, 295, 265, 235, 205, 175, 145, 115, 85, 55, 25, 5]) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "INCOME",
        amount: 38_000_000 + randInt(-2, 2) * 400_000,
        date: atHour(daysAgo(d), 10),
        description: "درآمد حقوق ماهانه",
        accountId: cardAccount.id,
        categoryId: cat("مالی").id,
      },
    });
  }

  const teachingIncomeDays: Array<[number, number]> = [
    [135, 4_500_000],
    [105, 5_000_000],
    [80, 7_500_000],
    [50, 8_500_000],
    [25, 11_000_000],
    [5, 12_500_000],
  ];
  for (const [d, amount] of teachingIncomeDays) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "INCOME",
        amount,
        date: atHour(daysAgo(d), 17),
        description: "درآمد تدریس خصوصی و مشاوره",
        accountId: cardAccount.id,
        categoryId: cat("مالی").id,
        projectId: p4.id,
      },
    });
  }

  await scatterExpenses({
    descriptions: ["خرید مواد غذایی", "خرید هفتگی", "خرید میوه و سبزی"],
    categoryId: cat("خرید").id,
    accountIds: [cardAccount.id, cardAccount.id, cashAccount.id],
    fromDaysAgo: 364,
    toDaysAgo: 0,
    count: 48,
    minAmount: 700_000,
    maxAmount: 2_000_000,
  });
  await scatterExpenses({
    descriptions: ["قبض برق", "قبض آب", "قبض گاز", "قبض اینترنت"],
    categoryId: cat("مالی").id,
    accountIds: [cardAccount.id],
    fromDaysAgo: 360,
    toDaysAgo: 3,
    count: 13,
    minAmount: 300_000,
    maxAmount: 900_000,
  });
  await scatterExpenses({
    descriptions: ["سینما", "رستوران با دوستان", "خرید بازی", "کنسرت"],
    categoryId: cat("تفریح").id,
    accountIds: [cardAccount.id, cashAccount.id],
    fromDaysAgo: 364,
    toDaysAgo: 183,
    count: 18,
    minAmount: 300_000,
    maxAmount: 1_800_000,
  });
  await scatterExpenses({
    descriptions: ["سینما", "رستوران با دوستان", "خرید بازی"],
    categoryId: cat("تفریح").id,
    accountIds: [cardAccount.id, cashAccount.id],
    fromDaysAgo: 182,
    toDaysAgo: 0,
    count: 10,
    minAmount: 200_000,
    maxAmount: 1_000_000,
  });
  await scatterExpenses({
    descriptions: ["بنزین", "تاکسی", "آرایشگاه", "خرید شخصی"],
    categoryId: cat("شخصی").id,
    accountIds: [cardAccount.id, cashAccount.id],
    fromDaysAgo: 364,
    toDaysAgo: 0,
    count: 30,
    minAmount: 250_000,
    maxAmount: 900_000,
  });
  await scatterExpenses({
    descriptions: ["تاکسی اینترنتی", "بنزین", "مترو و اتوبوس"],
    categoryId: cat("رفت و آمد").id,
    accountIds: [cardAccount.id, cashAccount.id],
    fromDaysAgo: 364,
    toDaysAgo: 0,
    count: 22,
    minAmount: 100_000,
    maxAmount: 500_000,
  });

  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "EXPENSE",
      amount: 42_000_000,
      date: atHour(daysAgo(300), 18),
      description: "خرید گوشی موبایل جدید (خرید ناگهانی)",
      accountId: cardAccount.id,
      categoryId: cat("خرید").id,
    },
  });

  const savingsTransferDays: Array<[number, number]> = [
    [340, 3_000_000],
    [250, 3_000_000],
    [170, 5_000_000],
    [140, 5_000_000],
    [110, 5_500_000],
    [80, 8_000_000],
    [50, 8_500_000],
    [20, 9_000_000],
  ];
  for (const [d, amount] of savingsTransferDays) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "TRANSFER",
        amount,
        date: atHour(daysAgo(d), 12),
        description: "انتقال به حساب پس‌انداز",
        accountId: cardAccount.id,
        transferToAccountId: savingsAccount.id,
      },
    });
  }

  // Roughly monthly ATM withdrawals — without these, the cash account only ever gets drawn
  // down by scatterExpenses above and never replenished, which would leave it implausibly deep
  // in the negative by the end of a full year.
  for (let d = 350; d >= 10; d -= 30) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: "TRANSFER",
        amount: randInt(3_500_000, 4_500_000),
        date: atHour(daysAgo(d), 13),
        description: "برداشت نقدی از خودپرداز",
        accountId: cardAccount.id,
        transferToAccountId: cashAccount.id,
      },
    });
  }

  // A shorter, fully-paid-off installment plan — a financial commitment seen through to the end.
  const planStart = daysAgo(280);
  const schedule = generateInstallmentSchedule({ startDate: planStart, dueDay: 15, numberOfInstallments: 8, installmentAmount: 1_800_000 });
  const plan = await prisma.installmentPlan.create({
    data: {
      userId: user.id,
      title: "قسط خرید تجهیزات ورزشی",
      totalAmount: 14_400_000,
      installmentAmount: 1_800_000,
      numberOfInstallments: 8,
      dueDay: 15,
      startDate: planStart,
      createdAt: planStart,
      installments: { create: schedule },
    },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  for (const installment of plan.installments) {
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
    data: { userId: user.id, name: "لپ‌تاپ شخصی", category: "الکترونیک", purchasePrice: 70_000_000, currentValue: 52_000_000, purchaseDate: daysAgo(400) },
  });
  await prisma.asset.create({
    data: { userId: user.id, name: "گوشی موبایل", category: "الکترونیک", purchasePrice: 42_000_000, currentValue: 34_000_000, purchaseDate: daysAgo(300) },
  });
  await prisma.asset.create({
    data: { userId: user.id, name: "میز و صندلی ارگونومیک", category: "لوازم خانه", purchasePrice: 9_500_000, currentValue: 9_000_000, purchaseDate: daysAgo(72) },
  });

  // --- calendar: events across the whole year, mostly attended, one skipped -------------------

  await pastEvent({ title: "شروع دوره زبان انگلیسی", categoryId: cat("یادگیری").id, projectId: p1.id, daysAgo: 358, hour: 18, durationMin: 45, attended: true });
  await pastEvent({ title: "جلسه هماهنگی دوره کدنویسی", categoryId: cat("یادگیری").id, projectId: p2.id, daysAgo: 335, hour: 19, durationMin: 30, attended: true });
  await pastEvent({ title: "آزمون تعیین سطح زبان", categoryId: cat("یادگیری").id, projectId: p1.id, daysAgo: 202, hour: 16, durationMin: 60, attended: true });
  await pastEvent({ title: "چکاپ سالانه", categoryId: cat("سلامت").id, daysAgo: 195, hour: 9, durationMin: 60, attended: true });
  await pastEvent({ title: "جلسه گروهی دوره کوچینگ", categoryId: cat("یادگیری").id, projectId: p3.id, daysAgo: 180, hour: 17, durationMin: 90, attended: true });
  await pastEvent({ title: "دریافت گواهی دوره کوچینگ", categoryId: cat("یادگیری").id, projectId: p3.id, daysAgo: 148, hour: 11, durationMin: 45, attended: true });
  await pastEvent({ title: "اولین جلسه تدریس خصوصی", categoryId: cat("کار").id, projectId: p4.id, daysAgo: 140, hour: 17, durationMin: 60, attended: true });
  await pastEvent({ title: "دندان‌پزشکی", categoryId: cat("سلامت").id, daysAgo: 100, hour: 9, durationMin: 45, attended: true });
  await pastEvent({ title: "جشن تولد دوست", categoryId: cat("تفریح").id, daysAgo: 60, hour: 20, durationMin: 120, attended: false });
  await pastEvent({ title: "ثبت‌نام مسابقه نیمه‌ماراتن", categoryId: cat("سلامت").id, projectId: p6.id, daysAgo: 44, hour: 12, durationMin: 20, attended: true });
  await pastEvent({ title: "ویزیت پیگیری دکتر", categoryId: cat("سلامت").id, daysAgo: 10, hour: 17, durationMin: 30, attended: true });

  const upcomingSession = await prisma.event.create({
    data: {
      userId: user.id,
      title: "جلسه تدریس با مشتری جدید",
      categoryId: cat("کار").id,
      projectId: p4.id,
      startAt: new Date(now.getTime() + 2 * 86_400_000),
      endAt: new Date(now.getTime() + 2 * 86_400_000 + 3_600_000),
    },
  });
  await prisma.reminder.create({
    data: {
      userId: user.id,
      targetType: "EVENT",
      eventId: upcomingSession.id,
      title: `یادآوری: ${upcomingSession.title}`,
      offsetMinutes: 30,
      remindAt: new Date(upcomingSession.startAt.getTime() - 30 * 60_000),
    },
  });
  await prisma.event.create({
    data: {
      userId: user.id,
      title: "مسابقه نیمه‌ماراتن",
      categoryId: cat("سلامت").id,
      projectId: p6.id,
      startAt: new Date(now.getTime() + 15 * 86_400_000),
      endAt: new Date(now.getTime() + 15 * 86_400_000 + 2 * 3_600_000),
    },
  });
  const nextSaturday = new Date(now);
  nextSaturday.setDate(now.getDate() + ((6 + 7 - now.getDay()) % 7 || 7));
  nextSaturday.setHours(8, 0, 0, 0);
  await prisma.event.create({
    data: {
      userId: user.id,
      title: "گروه دویدن هفتگی",
      categoryId: cat("سلامت").id,
      projectId: p6.id,
      startAt: nextSaturday,
      endAt: new Date(nextSaturday.getTime() + 3_600_000),
      recurrenceFreq: "WEEKLY",
      recurrenceInterval: 1,
      recurrenceCount: 8,
    },
  });

  // --- capital snapshots: replay the cumulative totals day by day (see seedSampleFounder.ts's ---
  // own comment on why this sweep is safe — every VirtualAssetEntry above is already final).

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
    data: { userId: user.id, action: "SEED", entityType: "User", entityId: user.id, metadata: JSON.stringify({ note: "Sample growth-journey account generated by prisma/seedGrowthJourney.ts" }) },
  });

  console.log("\n" + "=".repeat(60));
  console.log("حساب نمونه یک‌ساله ساخته شد");
  console.log(`ایمیل:      ${email}`);
  console.log(`رمز عبور:   ${password}`);
  console.log(`نام:        ${user.name}`);
  console.log(`بازه دیتا:  ${WINDOW_DAYS} روز گذشته تا امروز`);
  console.log("=".repeat(60));
  console.log("\nپروژه‌ها:");
  for (const p of projectSummary) console.log(`  - ${p.name}: ${p.outcome}`);
  console.log("\nعادت‌ها:");
  for (const h of habitSummary) console.log(`  - ${h.title}: ${h.pattern} (${h.checkIns} بار ثبت شده)`);
  console.log(`  - ${trialGratitude.title}: آزمایشی، در حال تصمیم‌گیری`);
  console.log(`  - ${trialStretch.title}: آزمایشی، تازه شروع‌شده`);
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
