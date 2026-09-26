// A six-month-old demo account: نیما کریمی, a freelance UI designer and front-end developer in Tehran who has been using
// the app since just after Nowruz. It is here to show «مسیر» (the story page) — and everything else in the app — against
// a life that has a shape: projects taken and finished, a client who stops answering, a flu, a trip, habits kept and
// dropped, and a note now and then. The story itself lives in prisma/demo/freelancerStory.ts; this file only turns it
// into rows, replaying the same sync functions the real app uses so every derived number (virtual assets, capital
// snapshots) is computed from the rows, never set by hand.
//
// Run:   npm run db:seed:freelancer
// Login: see EMAIL / PASSWORD below (also printed at the end).
// Re-running deletes the demo account (its data goes with it) and writes it again, so the six months always end today.
//
// Local databases only: it refuses to touch anything but a SQLite file.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../src/lib/defaults";
import { recalcActivityDuration } from "../src/lib/activityService";
import { createProjectCategory, syncProjectCompletionAsset } from "../src/lib/projectSync";
import { generateInstallmentSchedule } from "../src/lib/installments";
import { syncHabitCheckInVirtualAsset } from "../src/lib/habitSync";
import { dayKeyIso } from "../src/lib/calendarGrid";
import { jalaliDateKey, toJalali } from "../src/lib/jalali";
import { WINDOW_DAYS, buildStory, type StoryProject } from "./demo/freelancerStory";

export const EMAIL = "demo.freelancer@hesabkon.app";
export const PASSWORD = "Freelancer1405";
const NAME = "نیما کریمی";
// A fixed id, so re-running the seed does not sign the demo out of an open browser (the session names the user by id).
const USER_ID = "demo_freelancer_nima";

const prisma = new PrismaClient();

// Deterministic PRNG (mulberry32) — the same person every run, apart from the dates sliding forward with today.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1405070401);
const chance = (p: number) => rand() < p;
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}
function pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

async function assertLocalSqlite() {
  try {
    await prisma.$queryRawUnsafe("SELECT sqlite_version()");
  } catch {
    console.error("This demo seed only writes to a local SQLite database — refusing to run against anything else.");
    process.exit(1);
  }
}

async function main() {
  await assertLocalSqlite();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const story = buildStory(todayStart);

  /** Local midnight of the day `ago` days back. */
  const dayStart = (ago: number) => new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - ago);
  /** A moment on that day; never in the future (a "today" entry cannot be later than now). */
  const at = (ago: number, hour: number, minute = 0) => {
    const d = dayStart(ago);
    d.setHours(hour, minute, 0, 0);
    return d > now ? new Date(now) : d;
  };
  /** The same, but allowed to be in the future — for things that are still ahead today. */
  const atExact = (ago: number, hour: number, minute = 0) => {
    const d = dayStart(ago);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const weekdayOf = (ago: number) => dayStart(ago).getDay(); // 0 Sunday … 5 Friday … 6 Saturday
  const sick = new Set(story.sickDays);
  const trip = new Set(story.tripDays);
  const offDesk = (ago: number) => sick.has(ago) || trip.has(ago);

  // --- a clean slate ------------------------------------------------------------------------------------------
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: EMAIL }, { id: USER_ID }] } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } }); // cascades to everything the account owns
    console.log("Removed the previous demo account.");
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      id: USER_ID,
      name: NAME,
      email: EMAIL,
      passwordHash,
      createdAt: dayStart(WINDOW_DAYS),
      settings: { create: { monthlyIncome: 85_000_000, workingHoursMonth: 160, dailyProductiveTargetMin: 360, wakeHour: 7, sleepHour: 23 } },
      license: { create: { status: "LIFETIME" } },
    },
  });
  console.log("Created the demo account:", user.email);

  await prisma.category.createMany({ data: DEFAULT_CATEGORIES.map((c) => ({ ...c, userId: user.id, createdAt: dayStart(WINDOW_DAYS) })) });
  const categories = await prisma.category.findMany({ where: { userId: user.id } });
  const cat = (name: string) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`no default category named ${name}`);
    return found;
  };
  await prisma.category.update({ where: { id: cat("یادگیری").id }, data: { generatesVirtualAsset: true, virtualAssetValuePerHour: 300_000 } });

  // --- accounts -----------------------------------------------------------------------------------------------
  const card = await prisma.financeAccount.create({ data: { userId: user.id, name: "کارت بانکی ملت", type: "BANK_CARD", initialBalance: 14_000_000, createdAt: dayStart(WINDOW_DAYS) } });
  const cash = await prisma.financeAccount.create({ data: { userId: user.id, name: "صندوق نقدی", type: "CASH", initialBalance: 1_500_000, createdAt: dayStart(WINDOW_DAYS) } });
  const savings = await prisma.financeAccount.create({ data: { userId: user.id, name: "حساب پس‌انداز", type: "INVESTMENT", initialBalance: 18_000_000, createdAt: dayStart(WINDOW_DAYS) } });

  // --- projects, their categories and the tasks they close -----------------------------------------------------
  const projectRows = new Map<string, { row: Awaited<ReturnType<typeof prisma.project.create>>; categoryId: string; def: StoryProject }>();
  for (const def of story.projects) {
    const row = await prisma.project.create({
      data: {
        userId: user.id,
        name: def.name,
        description: def.description,
        color: def.color,
        status: "ACTIVE", // completed below, once its tasks exist (same order the app follows)
        createdAt: at(def.startAgo, 9, 30),
      },
    });
    const projectCategory = await createProjectCategory(row);
    projectRows.set(def.key, { row, categoryId: projectCategory.id, def });
  }

  /** The nearest working day (not the flu, not the trip, not a Friday) to `ago`, inside [lo, hi]. */
  function workableDay(ago: number, lo: number, hi: number): number {
    for (const delta of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const candidate = ago + delta;
      if (candidate < lo || candidate > hi) continue;
      if (offDesk(candidate) || weekdayOf(candidate) === 5) continue;
      return candidate;
    }
    return Math.min(hi, Math.max(lo, ago));
  }

  let taskCount = 0;
  let timedTaskCount = 0;
  for (const { row, categoryId, def } of projectRows.values()) {
    const windowEnd = def.endAgo ?? 1;
    const doneCount = def.doneCount ?? def.tasks.length;
    for (let i = 0; i < def.tasks.length; i++) {
      const title = def.tasks[i];
      if (i >= doneCount) {
        await prisma.task.create({
          data: { userId: user.id, title, status: "TODO", categoryId, projectId: row.id, dueDate: dayStart(-(3 * (i - doneCount + 1))), createdAt: at(Math.max(1, def.startAgo - 10), 10) },
        });
        taskCount++;
        continue;
      }
      // Spread the finished tasks over the project's life; the last one of a finished project closes on its last day.
      const isFinal = def.endAgo !== null && i === doneCount - 1;
      const planned = isFinal ? def.endAgo! : Math.round(def.startAgo - ((i + 0.6) / doneCount) * (def.startAgo - windowEnd)) + randInt(-1, 1);
      const ago = isFinal ? planned : workableDay(planned, windowEnd, def.startAgo);
      const timed = chance(0.35);
      const startHour = randInt(9, 17);
      const startAt = timed ? at(ago, startHour, randInt(0, 45)) : null;
      const endAt = startAt ? new Date(startAt.getTime() + randInt(3, 10) * 15 * 60_000) : null;
      const completedAt = endAt ?? at(ago, randInt(10, 19), randInt(0, 59));
      await prisma.task.create({
        data: {
          userId: user.id,
          title,
          status: "DONE",
          categoryId,
          projectId: row.id,
          startAt,
          endAt,
          completedAt,
          createdAt: at(Math.min(WINDOW_DAYS, ago + randInt(2, 9)), 10),
        },
      });
      taskCount++;
      if (timed) timedTaskCount++;
    }
  }

  // Finished and shelved projects, now that their tasks exist.
  for (const { row, def } of projectRows.values()) {
    if (def.status === "COMPLETED") {
      await prisma.project.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: at(def.endAgo!, 18, 0) } });
      await syncProjectCompletionAsset(row.id);
    } else if (def.status === "ARCHIVED") {
      await prisma.project.update({ where: { id: row.id }, data: { status: "ARCHIVED" } });
    }
  }

  // --- the days: tracked work, and the small tasks of a life ---------------------------------------------------
  function dayFactor(ago: number): number {
    if (offDesk(ago)) return 0;
    const wd = weekdayOf(ago);
    let f = wd === 5 ? 0.08 : wd === 4 ? 0.45 : 1;
    if (ago >= 172) f *= 0.3; // Nowruz, before the first client
    else if (ago >= 160) f *= 0.8; // settling into the first project
    if (ago <= 116 && ago >= 100) f *= 0.8; // tired, then the argument with a client
    if (wd !== 5 && ago > 1 && chance(0.06)) return 0; // an ordinary day off the record
    return f;
  }
  const factorOf = new Map<number, number>();
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) factorOf.set(ago, dayFactor(ago));

  async function trackSession(opts: { title: string; categoryId: string | null; projectId: string | null; ago: number; startMinute: number; duration: number }) {
    const start = atExact(opts.ago, Math.floor(opts.startMinute / 60), opts.startMinute % 60);
    if (start > now) return false;
    const activity = await prisma.activity.create({
      data: { userId: user.id, title: opts.title, categoryId: opts.categoryId, projectId: opts.projectId, createdAt: start },
    });
    const end = new Date(Math.min(start.getTime() + opts.duration * 60_000, now.getTime()));
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
    await prisma.timeEntry.create({ data: { activityId: activity.id, startAt: start, endAt: end, durationMin: minutes, isRunning: false } });
    await recalcActivityDuration(activity.id);
    return true;
  }

  let sessionCount = 0;
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const f = factorOf.get(ago) ?? 0;
    if (f === 0) continue;
    const count = f >= 0.9 ? pick([1, 2, 2, 3, 3]) : f >= 0.4 ? pick([0, 1, 1, 2]) : pick([0, 0, 1]);
    const active = [...projectRows.values()].filter(({ def }) => def.startAgo >= ago && (def.endAgo === null || ago >= def.endAgo));
    let minute = 9 * 60 + randInt(0, 90);
    for (let s = 0; s < count; s++) {
      let title: string;
      let categoryId: string | null;
      let projectId: string | null = null;
      let duration: number;
      if (active.length > 0 && chance(0.85)) {
        const chosen = pickWeighted(active, ({ def }) => def.weight);
        title = pick(chosen.def.sessions);
        categoryId = chosen.categoryId;
        projectId = chosen.row.id;
        duration = randInt(4, 12) * 15;
      } else if (chance(0.6)) {
        title = pick(story.learningSessions);
        categoryId = cat("یادگیری").id;
        duration = randInt(2, 6) * 15;
      } else {
        title = pick(story.adminSessions);
        categoryId = cat("کار").id;
        duration = randInt(2, 4) * 15;
      }
      if (minute >= 21 * 60 + 30) break;
      if (await trackSession({ title, categoryId, projectId, ago, startMinute: minute, duration })) sessionCount++;
      minute += duration + randInt(20, 80);
    }
  }

  // Everyday tasks: bills, invoices, the errands of one person's business.
  let smallTaskCount = 0;
  async function smallTask(title: string, ago: number, hour: number) {
    const completedAt = at(ago, hour, randInt(0, 50));
    await prisma.task.create({
      data: { userId: user.id, title, status: "DONE", categoryId: cat(pick(["کار", "شخصی", "مالی"])).id, completedAt, createdAt: at(Math.min(WINDOW_DAYS, ago + randInt(0, 4)), 9) },
    });
    smallTaskCount++;
  }
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const f = factorOf.get(ago) ?? 0;
    if (f < 0.3) continue;
    const date = dayStart(ago);
    const { jd } = toJalali(date);
    if (weekdayOf(ago) === 4) await smallTask("برنامه‌ریزی هفته‌ی بعد", ago, 17); // Thursday
    if (jd === 1) {
      await smallTask("ارسال فاکتورهای ماه قبل", ago, 10);
      await smallTask("جمع‌بندی هزینه‌های ماه", ago, 16);
    }
    if (jd === 10) await smallTask("پرداخت قبض برق و اینترنت", ago, 12);
    if (chance(0.42)) await smallTask(pick(story.personalTasks), ago, randInt(11, 20));
    if (chance(0.12)) await smallTask(pick(story.personalTasks), ago, randInt(11, 20));
  }

  // --- the calendar -------------------------------------------------------------------------------------------
  let eventCount = 0;
  for (const e of story.events) {
    const startAt = e.allDay ? atExact(e.ago, 8) : atExact(e.ago, e.hour, e.minute ?? 0);
    const endAt = e.allDay ? atExact(e.ago, 23, 59) : new Date(startAt.getTime() + e.duration * 60_000);
    const project = e.project ? projectRows.get(e.project) : undefined;
    const event = await prisma.event.create({
      data: {
        userId: user.id,
        title: e.title,
        location: e.place ?? null,
        allDay: !!e.allDay,
        startAt,
        endAt,
        categoryId: cat(e.category).id,
        projectId: project?.row.id ?? null,
        createdAt: new Date(startAt.getTime() - randInt(1, 6) * 86_400_000 > dayStart(WINDOW_DAYS).getTime() ? startAt.getTime() - randInt(1, 6) * 86_400_000 : dayStart(WINDOW_DAYS).getTime()),
      },
    });
    eventCount++;
    const attended = e.attended ?? startAt < now;
    if (attended) await prisma.eventCompletion.create({ data: { eventId: event.id, occurrenceDate: startAt } });
  }

  for (const r of story.recurring) {
    // The first date on or after `fromAgo` that falls on the right weekday.
    let first = r.fromAgo;
    while (weekdayOf(first) !== r.weekday && first > 0) first--;
    const startAt = atExact(first, r.hour, r.minute ?? 0);
    const until = r.toAgo === null ? null : atExact(r.toAgo, 23, 59);
    const event = await prisma.event.create({
      data: {
        userId: user.id,
        title: r.title,
        startAt,
        endAt: new Date(startAt.getTime() + r.duration * 60_000),
        categoryId: cat(r.category).id,
        recurrenceFreq: "WEEKLY",
        recurrenceInterval: 1,
        recurrenceUntil: until,
        createdAt: dayStart(Math.min(WINDOW_DAYS, r.fromAgo + 1)),
      },
    });
    eventCount++;
    // He is there most weeks.
    for (let ago = first; ago >= (r.toAgo ?? 0); ago -= 7) {
      const occurrence = atExact(ago, r.hour, r.minute ?? 0);
      if (occurrence < now && !offDesk(ago) && chance(0.85)) await prisma.eventCompletion.create({ data: { eventId: event.id, occurrenceDate: occurrence } });
    }
  }

  for (const w of story.weekly) {
    let first = w.fromAgo;
    while (weekdayOf(first) !== w.weekday && first > w.toAgo) first--;
    for (let ago = first; ago >= w.toAgo; ago -= 7) {
      if (offDesk(ago)) continue;
      const startAt = atExact(ago, w.hour, w.minute ?? 0);
      const event = await prisma.event.create({
        data: {
          userId: user.id,
          title: w.title,
          startAt,
          endAt: new Date(startAt.getTime() + w.duration * 60_000),
          categoryId: cat(w.category).id,
          createdAt: dayStart(Math.min(WINDOW_DAYS, ago + 7)),
        },
      });
      eventCount++;
      if (startAt < now && chance(0.9)) await prisma.eventCompletion.create({ data: { eventId: event.id, occurrenceDate: startAt } });
    }
  }

  // A one-off meeting on a day nothing else happens on (the flu) would tell the wrong story — say so while writing the demo.
  for (const e of story.events) {
    if (!e.allDay && offDesk(e.ago)) console.warn(`warning: the event «${e.title}» falls on a day he is ill or away (${e.ago} days ago)`);
  }

  // --- notes: the story's own, plus quiet one-liners on some ordinary days ------------------------------------
  const noteDays = new Set<number>();
  let noteCount = 0;
  async function writeNote(ago: number, hour: number, text: string) {
    // A note for a moment that has not come yet (this morning's, when the script runs before then) does not exist yet.
    if (atExact(ago, hour) > now) return;
    const createdAt = at(ago, hour, randInt(0, 50));
    await prisma.dailyNote.create({ data: { userId: user.id, day: dayKeyIso(dayStart(ago)), content: text, createdAt } });
    noteDays.add(ago);
    noteCount++;
  }
  // A note about the working week reads oddly on a Friday: move it to the nearest working day that has no note of its own.
  const claimed = new Set(story.notes.filter((n) => n.keepDay || weekdayOf(n.ago) !== 5).map((n) => n.ago));
  for (const n of story.notes) {
    let ago = n.ago;
    if (!n.keepDay && weekdayOf(ago) === 5) {
      const free = [ago + 1, ago - 1, ago + 2, ago - 2].find((d) => d >= 0 && d <= WINDOW_DAYS && weekdayOf(d) !== 5 && !offDesk(d) && !claimed.has(d));
      if (free !== undefined) ago = free;
      claimed.add(ago);
    }
    await writeNote(ago, n.hour, n.text);
  }

  const candidates: number[] = [];
  for (let ago = WINDOW_DAYS - 2; ago >= 2; ago--) {
    if (offDesk(ago) || noteDays.has(ago) || (factorOf.get(ago) ?? 0) < 0.4) continue;
    if ([ago - 1, ago + 1].some((d) => noteDays.has(d))) continue; // let the real notes stand alone
    candidates.push(ago);
  }
  let generic = 0;
  for (const ago of candidates) {
    if (generic >= story.genericNotes.length * 2) break;
    if (!chance(0.16)) continue;
    await writeNote(ago, randInt(20, 23), story.genericNotes[generic % story.genericNotes.length]);
    generic++;
  }

  // --- habits -------------------------------------------------------------------------------------------------
  const habitSummary: Array<{ title: string; checkIns: number }> = [];
  for (const h of story.habits) {
    const habit = await prisma.habit.create({
      data: {
        userId: user.id,
        title: h.title,
        icon: h.icon,
        categoryId: cat(h.category).id,
        virtualAssetValuePerCheckIn: h.valuePerCheckIn,
        createdAt: dayStart(h.createdAgo),
      },
    });
    let count = 0;
    for (let ago = h.createdAgo; ago >= 0; ago--) {
      if (sick.has(ago)) continue;
      const forced = h.forced?.some(([from, to]) => ago <= from && ago >= to) ?? false;
      let p = h.chance(ago);
      if (h.key === "diary") p = noteDays.has(ago) ? 0.92 : 0.08; // the night notebook goes with the notes
      if (trip.has(ago)) p *= 0.3;
      if (!forced && rand() >= p) continue;
      const minute = randInt(0, 40);
      const createdAt = atExact(ago, h.hour, minute);
      if (createdAt > now) continue; // a check-in cannot happen later than now
      const withDuration = h.durationRange && chance(h.durationChance ?? 0);
      const checkIn = await prisma.habitCheckIn.create({
        data: {
          habitId: habit.id,
          date: dayStart(ago),
          durationMin: withDuration && h.durationRange ? randInt(h.durationRange[0], h.durationRange[1]) : null,
          createdAt,
        },
      });
      await syncHabitCheckInVirtualAsset(checkIn.id);
      count++;
    }
    habitSummary.push({ title: h.title, checkIns: count });
  }

  // --- money --------------------------------------------------------------------------------------------------
  for (const { row, def } of projectRows.values()) {
    for (const payment of def.payments) {
      await prisma.transaction.create({
        data: { userId: user.id, type: "INCOME", amount: payment.amount, date: at(payment.ago, 12), description: payment.note, accountId: card.id, categoryId: cat("کار").id, projectId: row.id },
      });
    }
  }

  let expenseCount = 0;
  async function expense(ago: number, amount: number, description: string, category: string, account = card) {
    await prisma.transaction.create({
      data: { userId: user.id, type: "EXPENSE", amount, date: at(ago, randInt(9, 21)), description, accountId: account.id, categoryId: cat(category).id },
    });
    expenseCount++;
  }
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const { jd } = toJalali(dayStart(ago));
    if (jd === 1) await expense(ago, 18_000_000, "سهم اجاره‌ی خانه", "مالی");
    if (jd === 5) {
      await expense(ago, 1_600_000, "اشتراک فیگما", "کار");
      await expense(ago, 900_000, "هاست و دامنه", "کار");
    }
    if (jd === 10) {
      await expense(ago, randInt(4, 7) * 100_000, "قبض برق", "مالی");
      await expense(ago, 1_200_000, "اینترنت", "مالی");
    }
    if (weekdayOf(ago) === 5) await expense(ago, randInt(15, 26) * 100_000, "خرید مواد غذایی هفته", "خرید", chance(0.3) ? cash : card);
    if (!offDesk(ago) && chance(0.2)) await expense(ago, randInt(20, 45) * 10_000, pick(["کافه", "قهوه و کیک", "ناهار بیرون"]), "تفریح", chance(0.4) ? cash : card);
    if (chance(0.1)) await expense(ago, randInt(8, 25) * 10_000, pick(["تاکسی", "اسنپ", "بنزین"]), "رفت و آمد", chance(0.5) ? cash : card);
  }
  await expense(120, 32_000_000, "خرید مانیتور ۲۷ اینچ", "کار");
  await expense(58, 4_500_000, "دوره‌ی آنلاین طراحی سیستم", "یادگیری");
  await expense(93, 2_800_000, "هدیه‌ها و سوغاتی سفر شیراز", "خانواده");
  await expense(52, 6_000_000, "کیف و کفش برای افتتاحیه‌ی رستوران", "خرید");

  // Something put aside every month.
  for (const ago of [150, 120, 90, 60, 30, 6]) {
    await prisma.transaction.create({
      data: { userId: user.id, type: "TRANSFER", amount: 10_000_000, date: at(ago, 12), description: "انتقال به حساب پس‌انداز", accountId: card.id, transferToAccountId: savings.id },
    });
  }

  const planStart = dayStart(100);
  const schedule = generateInstallmentSchedule({ startDate: planStart, dueDay: 10, numberOfInstallments: 12, installmentAmount: 6_500_000 });
  const plan = await prisma.installmentPlan.create({
    data: {
      userId: user.id,
      title: "اقساط لپ‌تاپ جدید",
      totalAmount: 78_000_000,
      installmentAmount: 6_500_000,
      numberOfInstallments: 12,
      dueDay: 10,
      startDate: planStart,
      createdAt: planStart,
      installments: { create: schedule },
    },
    include: { installments: { orderBy: { index: "asc" } } },
  });
  for (const installment of plan.installments.filter((i) => i.dueDate < now)) {
    const tx = await prisma.transaction.create({
      data: { userId: user.id, type: "EXPENSE", amount: installment.amount, date: installment.dueDate, description: `پرداخت قسط ${installment.index} از ${plan.title}`, accountId: card.id, installmentId: installment.id },
    });
    await prisma.installment.update({ where: { id: installment.id }, data: { status: "PAID", paidAt: tx.date } });
  }

  await prisma.asset.create({ data: { userId: user.id, name: "مک‌بوک کاری", category: "الکترونیک", purchasePrice: 95_000_000, currentValue: 74_000_000, purchaseDate: dayStart(WINDOW_DAYS + 240) } });
  await prisma.asset.create({ data: { userId: user.id, name: "مانیتور ۲۷ اینچ", category: "الکترونیک", purchasePrice: 32_000_000, currentValue: 29_000_000, purchaseDate: dayStart(120) } });
  await prisma.savingsGoal.create({ data: { userId: user.id, title: "صندوق اضطراری شش‌ماهه", targetAmount: 150_000_000, targetDate: dayStart(-180), accountId: savings.id } });
  await prisma.budget.create({ data: { userId: user.id, categoryId: cat("تفریح").id, monthlyCap: 4_000_000 } });

  // --- "سرمایه من": the growth chart gets a history, not one point as of today ---------------------------------
  const [timeEntries, habitCheckIns, projectTasks, assetEntries] = await Promise.all([
    prisma.timeEntry.findMany({ where: { activity: { userId: user.id, deletedAt: null, category: { kind: "PRODUCTIVE" } }, durationMin: { not: null } }, select: { startAt: true, durationMin: true } }),
    prisma.habitCheckIn.findMany({ where: { habit: { userId: user.id, deletedAt: null }, durationMin: { not: null } }, select: { date: true, durationMin: true } }),
    prisma.task.findMany({ where: { userId: user.id, deletedAt: null, projectId: { not: null }, startAt: { not: null }, endAt: { not: null } }, select: { startAt: true, endAt: true } }),
    prisma.virtualAssetEntry.findMany({ where: { userId: user.id }, select: { date: true, totalValue: true } }),
  ]);
  const minuteEvents = [
    ...timeEntries.map((t) => ({ date: t.startAt, minutes: t.durationMin ?? 0 })),
    ...habitCheckIns.map((h) => ({ date: h.date, minutes: h.durationMin ?? 0 })),
    ...projectTasks.map((t) => ({ date: t.startAt!, minutes: Math.max(0, Math.round((t.endAt!.getTime() - t.startAt!.getTime()) / 60_000)) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  const valueEvents = assetEntries.map((e) => ({ date: e.date, value: e.totalValue })).sort((a, b) => a.date.getTime() - b.date.getTime());
  let cumMinutes = 0;
  let cumValue = 0;
  let mi = 0;
  let vi = 0;
  for (let ago = WINDOW_DAYS; ago >= 0; ago--) {
    const dayEnd = new Date(dayStart(ago).getTime() + 86_400_000 - 1);
    while (mi < minuteEvents.length && minuteEvents[mi].date <= dayEnd) cumMinutes += minuteEvents[mi++].minutes;
    while (vi < valueEvents.length && valueEvents[vi].date <= dayEnd) cumValue += valueEvents[vi++].value;
    const date = jalaliDateKey(dayStart(ago));
    await prisma.capitalSnapshot.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date, investedMinutes: cumMinutes, virtualAssetValue: cumValue },
      update: { investedMinutes: cumMinutes, virtualAssetValue: cumValue },
    });
  }

  await prisma.auditLog.create({
    data: { userId: user.id, action: "SEED", entityType: "User", entityId: user.id, metadata: JSON.stringify({ note: "Freelancer demo generated by prisma/seedFreelancerDemo.ts" }) },
  });

  console.log("\n" + "=".repeat(64));
  console.log("حساب نمونه‌ی فریلنسر ساخته شد");
  console.log(`ایمیل (نام کاربری): ${EMAIL}`);
  console.log(`رمز عبور:           ${PASSWORD}`);
  console.log(`نام:                ${NAME}`);
  console.log(`بازه‌ی داده:         ${WINDOW_DAYS} روز گذشته تا امروز`);
  console.log("=".repeat(64));
  console.log(`پروژه‌ها: ${story.projects.length}  |  کارهای پروژه‌ای: ${taskCount} (${timedTaskCount} با زمان)  |  کارهای روزمره: ${smallTaskCount}`);
  console.log(`جلسه‌های کاری ثبت‌شده: ${sessionCount}  |  رویدادها: ${eventCount}  |  یادداشت‌ها: ${noteCount}  |  هزینه‌ها: ${expenseCount}`);
  for (const h of habitSummary) console.log(`  عادت «${h.title}»: ${h.checkIns} بار`);
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
