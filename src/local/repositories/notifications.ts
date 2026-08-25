// On-device port of src/app/api/notifications/route.ts and
// src/app/api/notifications/[id]/read/route.ts. The GET route lazily "fires" due reminders
// (and neglected-habit nudges) into Notification rows before listing unread ones — ported in
// full below, including the Reminder -> Event/Installment/InstallmentPlan lookups, since all
// of those models' shapes were available in prisma/schema.prisma and nothing here needed
// simplifying.
import { ApiError } from "@/lib/apiErrorBase";
import { daysSinceLastCheckIn, isHabitNeglected, type HabitCheckInLike } from "@/lib/habitStreak";
import type { LocalDb } from "../db";
import { fetchByIds } from "../relations";

const NEGLECT_THRESHOLD_DAYS = 3;
// Same as the neglect threshold: re-nudge every few days, not on every single poll.
const NUDGE_COOLDOWN_DAYS = 3;

interface ReminderRow {
  id: string;
  userId: string;
  targetType: string;
  eventId: string | null;
  installmentId: string | null;
  title: string;
  offsetMinutes: number;
  remindAt: string;
  notified: number;
  dismissed: number;
}
interface EventRow {
  id: string;
  title: string;
}
interface InstallmentRow {
  id: string;
  planId: string;
  amount: number;
}
interface InstallmentPlanRow {
  id: string;
  title: string;
}
interface HabitRow {
  id: string;
  title: string;
  createdAt: string;
  lastNudgeSentAt: string | null;
}
interface NotificationRow {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  relatedType: string | null;
  relatedId: string | null;
  isRead: number;
  createdAt: string;
}

function now() {
  return new Date().toISOString();
}
function parseDate(s: string): Date {
  return new Date(s);
}

function insertNotification(
  db: LocalDb,
  params: { userId: string; title: string; body: string; type: string; relatedType: string | null; relatedId: string | null }
) {
  db.run(
    `INSERT INTO "Notification" ("id","userId","title","body","type","relatedType","relatedId","isRead","createdAt")
     VALUES (?,?,?,?,?,?,?,0,?)`,
    [crypto.randomUUID(), params.userId, params.title, params.body, params.type, params.relatedType, params.relatedId, now()]
  );
}

/** Fires every due, not-yet-notified, non-dismissed Reminder into a Notification row. */
function fireDueReminders(db: LocalDb, userId: string, nowIso: string) {
  const dueReminders = db.all<ReminderRow>(
    `SELECT * FROM "Reminder" WHERE "userId" = ? AND "notified" = 0 AND "dismissed" = 0 AND "remindAt" <= ?`,
    [userId, nowIso]
  );
  if (dueReminders.length === 0) return;

  const eventById = fetchByIds<EventRow>(db, "Event", dueReminders.map((r) => r.eventId));
  const installmentById = fetchByIds<InstallmentRow>(db, "Installment", dueReminders.map((r) => r.installmentId));
  const planById = fetchByIds<InstallmentPlanRow>(db, "InstallmentPlan", Array.from(installmentById.values()).map((i) => i.planId));

  for (const reminder of dueReminders) {
    const event = reminder.eventId ? eventById.get(reminder.eventId) : undefined;
    const installment = reminder.installmentId ? installmentById.get(reminder.installmentId) : undefined;
    const plan = installment ? planById.get(installment.planId) : undefined;

    let body = reminder.title;
    if (event) {
      body = `${event.title} - ${reminder.offsetMinutes >= 60 ? Math.round(reminder.offsetMinutes / 60) + " ساعت" : reminder.offsetMinutes + " دقیقه"} دیگر`;
    } else if (installment && plan) {
      body = `قسط ${installment.amount.toLocaleString("en-US")} تومانی «${plan.title}» به زودی سررسید می‌شود.`;
    }

    insertNotification(db, {
      userId,
      title: reminder.title,
      body,
      type: "reminder",
      relatedType: reminder.targetType,
      relatedId: reminder.eventId ?? reminder.installmentId ?? null,
    });
    db.run(`UPDATE "Reminder" SET "notified" = 1 WHERE "id" = ?`, [reminder.id]);
  }
}

/**
 * Duolingo-style "come back to this" nudge for habits gone quiet a few days, cooled down by
 * lastNudgeSentAt so it doesn't re-fire on every poll. Trial habits are excluded (they have
 * their own keep/discard prompt once the trial elapses).
 */
function fireHabitNudges(db: LocalDb, userId: string, nowDate: Date) {
  const activeHabits = db.all<HabitRow>(
    `SELECT "id","title","createdAt","lastNudgeSentAt" FROM "Habit" WHERE "userId" = ? AND "deletedAt" IS NULL AND "isActive" = 1 AND "isTrial" = 0`,
    [userId]
  );

  for (const habit of activeHabits) {
    const lastCheckIn = db.get<{ date: string }>(`SELECT "date" FROM "HabitCheckIn" WHERE "habitId" = ? ORDER BY "date" DESC LIMIT 1`, [habit.id]);
    const checkIns: HabitCheckInLike[] = lastCheckIn ? [{ habitId: habit.id, date: parseDate(lastCheckIn.date) }] : [];
    const daysSince = daysSinceLastCheckIn(checkIns, parseDate(habit.createdAt), nowDate);
    if (!isHabitNeglected(daysSince, NEGLECT_THRESHOLD_DAYS)) continue;

    const cooledDown = !habit.lastNudgeSentAt || nowDate.getTime() - parseDate(habit.lastNudgeSentAt).getTime() >= NUDGE_COOLDOWN_DAYS * 86_400_000;
    if (!cooledDown) continue;

    insertNotification(db, {
      userId,
      title: `عادت «${habit.title}» رو فراموش نکن`,
      body: `چند روزیه سراغ «${habit.title}» نرفتی. می‌خوای بازنگری‌اش کنی و یه پله کوچیک‌ترش کنی تا ادامه‌ دادنش راحت‌تر بشه؟`,
      type: "system",
      relatedType: "HABIT",
      relatedId: habit.id,
    });
    db.run(`UPDATE "Habit" SET "lastNudgeSentAt" = ? WHERE "id" = ?`, [nowDate.toISOString(), habit.id]);
  }
}

function toPublicNotification(row: NotificationRow) {
  return { ...row, isRead: !!row.isRead };
}

/**
 * Lazily "fires" due reminders (and neglected-habit nudges) into Notification rows, then
 * returns unread notifications — same as the web route's GET, which avoids needing a
 * background worker by having the client poll this endpoint.
 */
export function listNotifications(db: LocalDb, userId: string) {
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();

  fireDueReminders(db, userId, nowIso);
  fireHabitNudges(db, userId, nowDate);

  const notifications = db.all<NotificationRow>(`SELECT * FROM "Notification" WHERE "userId" = ? AND "isRead" = 0 ORDER BY "createdAt" DESC LIMIT 50`, [
    userId,
  ]);

  return { notifications: notifications.map(toPublicNotification) };
}

export function markNotificationRead(db: LocalDb, userId: string, id: string) {
  const notification = db.get<NotificationRow>(`SELECT * FROM "Notification" WHERE "id" = ? AND "userId" = ?`, [id, userId]);
  if (!notification) throw new ApiError("اعلان پیدا نشد.", 404);

  db.run(`UPDATE "Notification" SET "isRead" = 1 WHERE "id" = ?`, [id]);
  return { ok: true };
}
