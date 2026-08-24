import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../src/lib/defaults";
import { recalcActivityDuration, syncDirectCostTransaction } from "../src/lib/activityService";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction, syncEventDirectCostTransaction } from "../src/lib/directCostSync";
import { createProjectCategory, syncProjectCompletionAsset } from "../src/lib/projectSync";
import { generateInstallmentSchedule } from "../src/lib/installments";
import { syncHabitCheckInVirtualAsset } from "../src/lib/habitSync";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@hesabkon.app";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("Demo user already exists, skipping seed. Delete dev.db to reseed from scratch.");
    return;
  }

  const now = new Date();
  // Most demo data is anchored to "hours ago today" (`recent`) so Today/This-Month
  // dashboard numbers are always populated no matter what day of the Jalali month the
  // app happens to be seeded on (the 1st of a Jalali month is a real, recurring case —
  // e.g. it lands on Aug 23 most years — and a naive spread across the last N days would
  // put everything in "last month" on that day). A second, older `at()` spread of up to
  // 15 real days back adds list-page variety and populates the "last month" report.
  // Interpolates within [start of today, now] by fraction (0=midnight, 1=now) rather than
  // subtracting fixed hours, which could wrap past midnight into yesterday depending on
  // what time of day it currently is (and yesterday might be last month, as on day 1).
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todaySpan = Math.max(now.getTime() - todayStart.getTime(), 60000);
  const recent = (fraction: number) => new Date(todayStart.getTime() + todaySpan * fraction);
  const historicalStart = new Date(now.getTime() - 15 * 86400000);
  const historicalSpan = now.getTime() - historicalStart.getTime();
  const at = (fraction: number, hour = 10) => {
    const d = new Date(historicalStart.getTime() + historicalSpan * fraction);
    d.setHours(hour, 0, 0, 0);
    return d > now ? now : d;
  };

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const user = await prisma.user.create({
    data: {
      name: "کاربر نمونه",
      email,
      passwordHash,
      settings: {
        create: { monthlyIncome: 50_000_000, workingHoursMonth: 176 },
      },
    },
  });

  console.log("Created demo user:", user.email);

  const categories = await Promise.all(
    DEFAULT_CATEGORIES.map((c) => prisma.category.create({ data: { ...c, userId: user.id } }))
  );
  const cat = (name: string) => categories.find((c) => c.name === name)!;

  await prisma.category.update({
    where: { id: cat("یادگیری").id },
    data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 350_000 },
  });

  const cardAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "کارت بانکی ملت", type: "BANK_CARD", initialBalance: 15_000_000 },
  });
  const cashAccount = await prisma.financeAccount.create({
    data: { userId: user.id, name: "صندوق نقدی", type: "CASH", initialBalance: 1_500_000 },
  });

  const pcbProject = await prisma.project.create({
    data: { userId: user.id, name: "طراحی برد کنترل موتور", description: "پروژه شخصی الکترونیک", status: "ACTIVE" },
  });
  await createProjectCategory(pcbProject);
  const snnProject = await prisma.project.create({
    data: { userId: user.id, name: "یادگیری شبکه‌های عصبی اسپایکی", status: "ACTIVE" },
  });
  await createProjectCategory(snnProject);

  // A third, already-finished project — demonstrates "اتمام پروژه" registering the
  // project's real cost as its own virtual asset entry.
  const websiteProject = await prisma.project.create({
    data: {
      userId: user.id,
      name: "طراحی سایت شخصی",
      description: "پروژه فریلنسری تکمیل‌شده",
      status: "COMPLETED",
      completedAt: at(0.6),
    },
  });
  await createProjectCategory(websiteProject);
  const websiteTask = await prisma.task.create({
    data: {
      userId: user.id,
      title: "طراحی و پیاده‌سازی سایت مشتری",
      status: "DONE",
      categoryId: (await prisma.category.findFirstOrThrow({ where: { projectId: websiteProject.id } })).id,
      projectId: websiteProject.id,
      completedAt: at(0.55),
      startAt: at(0.5),
      endAt: new Date(at(0.5).getTime() + 6 * 3600000),
      incomeAmount: 8_000_000,
    },
  });
  await syncTaskIncomeTransaction(websiteTask.id);
  await syncProjectCompletionAsset(websiteProject.id);

  await prisma.task.createMany({
    data: [
      {
        userId: user.id,
        title: "خرید قطعات الکترونیک",
        status: "DONE",
        categoryId: cat("خرید").id,
        projectId: pcbProject.id,
        completedAt: at(0.3),
      },
      {
        userId: user.id,
        title: "نوشتن خلاصه مقاله SNN",
        status: "TODO",
        categoryId: cat("یادگیری").id,
        projectId: snnProject.id,
      },
      { userId: user.id, title: "تماس با مشتری", status: "TODO", dueDate: now, categoryId: cat("کار").id },
      {
        userId: user.id,
        title: "پرداخت قبض برق",
        status: "TODO",
        categoryId: cat("مالی").id,
        dueDate: new Date(now.getTime() + 5 * 86400000),
      },
    ],
  });

  // Demo data for the "هزینه پنهان" (Hidden Cost) report: a task with logged time
  // (no direct cost) and a task with a direct cost, both linked to a real Transaction
  // via syncTaskDirectCostTransaction so the Financial summary and Hidden Cost tab agree.
  const pcbDesignEnd = at(0.45);
  const pcbDesignTask = await prisma.task.create({
    data: {
      userId: user.id,
      title: "طراحی PCB برد کنترل",
      status: "IN_PROGRESS",
      categoryId: cat("پروژه").id,
      projectId: pcbProject.id,
      dueDate: new Date(now.getTime() + 3 * 86400000),
      startAt: new Date(pcbDesignEnd.getTime() - 180 * 60000),
      endAt: pcbDesignEnd,
    },
  });

  const coworkingTask = await prisma.task.create({
    data: {
      userId: user.id,
      title: "اجاره فضای کار اشتراکی برای جلسه تیم",
      status: "DONE",
      categoryId: cat("کار").id,
      projectId: pcbProject.id,
      completedAt: at(0.75),
      dueDate: at(0.75),
      directCost: 650_000,
    },
  });
  await syncTaskDirectCostTransaction(coworkingTask.id);

  async function createActivity(opts: {
    title: string;
    categoryId?: string;
    projectId?: string;
    durationMin: number;
    directCost?: number;
    createdAt: Date;
    minStartAt?: Date;
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
    // Backdated demo data: create the TimeEntry directly at the intended historical
    // moment instead of addManualTimeEntry, which anchors duration to the real "now".
    // startAt is clamped to minStartAt (when given) so a long duration on an activity
    // placed early in a short window can't underflow into the previous day/month —
    // durationMin (not the startAt/endAt gap) is what reports actually total up.
    const endAt = opts.createdAt;
    let startAt = new Date(endAt.getTime() - opts.durationMin * 60000);
    if (opts.minStartAt && startAt < opts.minStartAt) startAt = new Date(opts.minStartAt);
    await prisma.timeEntry.create({
      data: { activityId: activity.id, startAt, endAt, durationMin: opts.durationMin, isRunning: false },
    });
    await recalcActivityDuration(activity.id);
    if (opts.directCost) await syncDirectCostTransaction(activity.id);
    return activity;
  }

  // Historical spread (last 15 days) — gives Tasks/Activities/Reports "last month" variety.
  await createActivity({ title: "مطالعه شبکه‌های عصبی اسپایکی", categoryId: cat("یادگیری").id, projectId: snnProject.id, durationMin: 130, createdAt: at(0.15) });
  await createActivity({ title: "مطالعه مقاله SNN", categoryId: cat("یادگیری").id, projectId: snnProject.id, durationMin: 95, createdAt: at(0.4) });
  await createActivity({ title: "تمرین مسائل ریاضی", categoryId: cat("یادگیری").id, durationMin: 60, createdAt: at(0.7) });
  await createActivity({ title: "برنامه‌نویسی فریمور برد", categoryId: cat("پروژه").id, projectId: pcbProject.id, durationMin: 240, createdAt: at(0.25) });
  await createActivity({ title: "جلسه کاری تیم", categoryId: cat("کار").id, durationMin: 90, createdAt: at(0.55) });
  await createActivity({ title: "خرید قطعات الکترونیک", categoryId: cat("خرید").id, projectId: pcbProject.id, durationMin: 120, directCost: 1_200_000, createdAt: at(0.3) });
  await createActivity({ title: "اینستاگرام", categoryId: cat("شبکه‌های اجتماعی").id, durationMin: 80, createdAt: at(0.2) });
  await createActivity({ title: "اینستاگرام", categoryId: cat("شبکه‌های اجتماعی").id, durationMin: 55, createdAt: at(0.6) });
  await createActivity({ title: "یوتیوب", categoryId: cat("شبکه‌های اجتماعی").id, durationMin: 40, createdAt: at(0.85) });

  // Recent (today, last ~18 hours) — guarantees Today/This-Month dashboard cards are populated
  // regardless of what day of the Jalali month the app is seeded on.
  await createActivity({ title: "برنامه‌نویسی فریمور برد", categoryId: cat("پروژه").id, projectId: pcbProject.id, durationMin: 150, createdAt: recent(0.25), minStartAt: todayStart });
  await createActivity({ title: "مطالعه شبکه‌های عصبی اسپایکی", categoryId: cat("یادگیری").id, projectId: snnProject.id, durationMin: 90, createdAt: recent(0.5), minStartAt: todayStart });
  await createActivity({ title: "خرید کابل و کانکتور", categoryId: cat("خرید").id, projectId: pcbProject.id, durationMin: 40, directCost: 350_000, createdAt: recent(0.65), minStartAt: todayStart });
  await createActivity({ title: "اینستاگرام", categoryId: cat("شبکه‌های اجتماعی").id, durationMin: 45, createdAt: recent(0.8), minStartAt: todayStart });
  await createActivity({ title: "ورزش صبحگاهی", categoryId: cat("سلامت").id, durationMin: 45, createdAt: recent(0.95), minStartAt: todayStart });

  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "INCOME",
      amount: 50_000_000,
      date: recent(0.1),
      description: "حقوق ماهانه",
      accountId: cardAccount.id,
      categoryId: cat("مالی").id,
    },
  });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "EXPENSE",
      amount: 450_000,
      date: at(0.5),
      description: "قبض برق",
      accountId: cashAccount.id,
      categoryId: cat("مالی").id,
    },
  });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "EXPENSE",
      amount: 1_800_000,
      date: recent(0.4),
      description: "خرید مواد غذایی",
      accountId: cardAccount.id,
      categoryId: cat("خرید").id,
    },
  });

  const planStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const schedule = generateInstallmentSchedule({
    startDate: planStart,
    dueDay: 15,
    numberOfInstallments: 30,
    installmentAmount: 10_000_000,
  });
  const plan = await prisma.installmentPlan.create({
    data: {
      userId: user.id,
      title: "وام خرید خودرو",
      totalAmount: 300_000_000,
      installmentAmount: 10_000_000,
      numberOfInstallments: 30,
      dueDay: 15,
      startDate: planStart,
      installments: { create: schedule },
    },
    include: { installments: { orderBy: { index: "asc" } } },
  });

  const pastDue = plan.installments.filter((i) => i.dueDate < now).slice(0, 2);
  for (const installment of pastDue) {
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
    data: { userId: user.id, name: "لپ‌تاپ", category: "الکترونیک", purchasePrice: 80_000_000, currentValue: 65_000_000, purchaseDate: new Date(now.getFullYear() - 1, 3, 1) },
  });
  await prisma.asset.create({
    data: { userId: user.id, name: "اسیلوسکوپ", category: "تجهیزات", purchasePrice: 30_000_000, currentValue: 28_000_000, purchaseDate: new Date(now.getFullYear() - 1, 8, 15) },
  });
  await prisma.asset.create({
    data: { userId: user.id, name: "میز و صندلی کار", category: "لوازم منزل", purchasePrice: 12_000_000, currentValue: 9_000_000, purchaseDate: new Date(now.getFullYear() - 2, 1, 1) },
  });

  const meetingStart = new Date(now.getTime() + 2 * 3600000);
  const meeting = await prisma.event.create({
    data: {
      userId: user.id,
      title: "جلسه با مشتری",
      startAt: meetingStart,
      endAt: new Date(meetingStart.getTime() + 3600000),
      categoryId: cat("کار").id,
      directCost: 300_000, // client lunch — demonstrates Event hidden cost alongside Task hidden cost
    },
  });
  await syncEventDirectCostTransaction(meeting.id);
  await prisma.reminder.create({
    data: {
      userId: user.id,
      targetType: "EVENT",
      eventId: meeting.id,
      title: `یادآوری: ${meeting.title}`,
      offsetMinutes: 30,
      remindAt: new Date(meetingStart.getTime() - 30 * 60000),
    },
  });

  await prisma.event.create({
    data: {
      userId: user.id,
      title: "دندان‌پزشکی",
      startAt: new Date(now.getTime() + 3 * 86400000),
      endAt: new Date(now.getTime() + 3 * 86400000 + 3600000),
      categoryId: cat("سلامت").id,
    },
  });

  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
  nextMonday.setHours(18, 0, 0, 0);
  await prisma.event.create({
    data: {
      userId: user.id,
      title: "جلسه تیم پروژه",
      startAt: nextMonday,
      endAt: new Date(nextMonday.getTime() + 3600000),
      categoryId: cat("کار").id,
      recurrenceFreq: "WEEKLY",
      recurrenceInterval: 1,
      recurrenceCount: 8, // demonstrates the "end after N occurrences" recurrence option
    },
  });

  // Habit tracker demo data: three habits showing a strong streak, a partial/inconsistent
  // one, and a neglected one (old enough to trigger the "come back" nudge notification).
  const daysAgo = (n: number) => new Date(todayStart.getTime() - n * 86400000);

  async function seedHabit(opts: { title: string; icon: string; categoryId?: string; virtualAssetValuePerCheckIn: number; checkedInDaysAgo: number[] }) {
    const habit = await prisma.habit.create({
      data: {
        userId: user.id,
        title: opts.title,
        icon: opts.icon,
        categoryId: opts.categoryId,
        virtualAssetValuePerCheckIn: opts.virtualAssetValuePerCheckIn,
        createdAt: daysAgo(10),
      },
    });
    for (const n of opts.checkedInDaysAgo) {
      const checkIn = await prisma.habitCheckIn.create({ data: { habitId: habit.id, date: daysAgo(n) } });
      await syncHabitCheckInVirtualAsset(checkIn.id);
    }
    return habit;
  }

  await seedHabit({
    title: "مطالعه روزانه",
    icon: "📚",
    categoryId: cat("یادگیری").id,
    virtualAssetValuePerCheckIn: 50_000,
    checkedInDaysAgo: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  });
  await seedHabit({
    title: "ورزش صبحگاهی",
    icon: "🏃",
    categoryId: cat("سلامت").id,
    virtualAssetValuePerCheckIn: 30_000,
    checkedInDaysAgo: [8, 6, 4, 2, 0],
  });
  await seedHabit({
    title: "استراحت بدون تکنولوژی",
    icon: "🌿",
    virtualAssetValuePerCheckIn: 100_000,
    checkedInDaysAgo: [9, 8, 7, 6, 5], // nothing in the last 5 days — demonstrates the neglect nudge
  });

  // Two BJ Fogg "Tiny Habits" trials — one still mid-window, one whose 3 days are up and is
  // waiting on the keep/discard feedback prompt (see TrialHabitCard / /habits).
  const midTrial = await prisma.habit.create({
    data: {
      userId: user.id,
      title: "۲ صفحه کتاب می‌خونم",
      icon: "📖",
      cue: "بعد از اینکه چای صبحم رو ریختم",
      celebration: "با خودم می‌گم آفرین!",
      isTrial: true,
      trialStartDate: daysAgo(1),
      createdAt: daysAgo(1),
    },
  });
  await prisma.habitCheckIn.create({ data: { habitId: midTrial.id, date: daysAgo(1) } });

  const readyTrial = await prisma.habit.create({
    data: {
      userId: user.id,
      title: "۵ تا شنا میرم",
      icon: "💪",
      cue: "بعد از اینکه از تخت بلند شدم",
      celebration: "یه لبخند به خودم توی آینه میزنم",
      isTrial: true,
      trialStartDate: daysAgo(4),
      createdAt: daysAgo(4),
    },
  });
  for (const n of [4, 3, 2]) {
    await prisma.habitCheckIn.create({ data: { habitId: readyTrial.id, date: daysAgo(n) } });
  }

  await prisma.auditLog.create({
    data: { userId: user.id, action: "SEED", entityType: "User", entityId: user.id, metadata: JSON.stringify({ note: "Demo data generated by prisma/seed.ts" }) },
  });

  console.log("Seed complete. Login with demo@hesabkon.app / demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
