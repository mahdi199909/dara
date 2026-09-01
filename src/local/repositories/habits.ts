// On-device equivalent of src/app/api/habits/route.ts + src/app/api/habits/[id]/route.ts +
// src/app/api/habits/[id]/checkin/route.ts — same validation (shared schemas from
// @/lib/schemas/habits), same field defaults, same audit actions, same 404 message, and the
// same streak/adherence math (reused as-is from @/lib/habitStreak, a pure function library)
// so the local dispatcher can return byte-identical shapes regardless of whether it's backed
// by this repository or the real HTTP routes.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateHabitInput, UpdateHabitInput, HabitCheckInToggleInput, HabitCheckInDurationInput } from "@/lib/schemas/habits";
import {
  computeAdherenceSeries,
  computeCurrentStreak,
  daysSinceLastCheckIn,
  trialDayNumber,
  isTrialElapsed,
  type HabitLike,
  type HabitCheckInLike,
} from "@/lib/habitStreak";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { fetchByIds } from "../relations";
import { syncHabitCheckInVirtualAsset } from "../habitSync";

interface HabitRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string;
  categoryId: string | null;
  virtualAssetValuePerCheckIn: number;
  isActive: number;
  lastNudgeSentAt: string | null;
  isTrial: number;
  cue: string | null;
  celebration: string | null;
  trialStartDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface HabitCheckInRow {
  id: string;
  habitId: string;
  date: string;
  durationMin: number | null;
  createdAt: string;
}

interface CategoryRow {
  id: string;
  [key: string]: unknown;
}

function now() {
  return new Date().toISOString();
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseDate(s: string): Date {
  return new Date(s);
}

/**
 * Converts a raw SQLite row (booleans stored as 0/1) into the shape Prisma's client would
 * return for the same Habit (real booleans). The joined Category row, like every other
 * repository's fetchByIds-based join in this codebase, is attached as-is (its own 0/1 boolean
 * columns are left untouched — no repository in this codebase currently reshapes nested
 * joined rows, only the top-level entity).
 */
function toPublicHabit(row: HabitRow, category: CategoryRow | null) {
  return {
    ...row,
    isActive: !!row.isActive,
    isTrial: !!row.isTrial,
    category,
  };
}

function attachCategory(db: LocalDb, row: HabitRow) {
  const categoryById = fetchByIds<CategoryRow>(db, "Category", [row.categoryId]);
  return toPublicHabit(row, row.categoryId ? categoryById.get(row.categoryId) ?? null : null);
}

function getOwnedHabitRow(db: LocalDb, userId: string, id: string): HabitRow {
  const row = db.get<HabitRow>(`SELECT * FROM "Habit" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("عادت پیدا نشد.", 404);
  return row;
}

function getHabitWithCategory(db: LocalDb, userId: string, id: string) {
  return attachCategory(db, getOwnedHabitRow(db, userId, id));
}

/**
 * Returns every habit together with today's check-in state, its current streak, and a 30-day
 * adherence series — everything Home and the Reports "عادت‌ها" tab need in one call.
 *
 * Faithful-port note: like the web route, `daysSinceLastCheckIn` below is computed only from
 * the same 30-day-bounded check-in list fetched for the adherence series (not a separate
 * all-time query) — see the web route's GET handler, which does the exact same thing. If a
 * habit's true last check-in is older than 30 days, this will over/under-report the gap
 * (falling back to days-since-creation instead of the real last check-in date). This is an
 * existing quirk of the web route being mirrored here, not something introduced by the port.
 */
export function listHabits(db: LocalDb, userId: string) {
  const today = startOfDay(new Date());
  const seriesFrom = new Date(today.getTime() - 29 * 86_400_000);
  const todayIso = today.toISOString();
  const seriesFromIso = seriesFrom.toISOString();

  const habitRows = db.all<HabitRow>(`SELECT * FROM "Habit" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`, [userId]);
  const categoryById = fetchByIds<CategoryRow>(db, "Category", habitRows.map((h) => h.categoryId));

  const checkInRows = db.all<HabitCheckInRow>(
    `SELECT hc.* FROM "HabitCheckIn" hc JOIN "Habit" h ON h."id" = hc."habitId"
     WHERE h."userId" = ? AND h."deletedAt" IS NULL AND hc."date" >= ? AND hc."date" <= ?`,
    [userId, seriesFromIso, todayIso]
  );

  const habits: HabitLike[] = habitRows.map((h) => ({ id: h.id, createdAt: parseDate(h.createdAt), isActive: !!h.isActive, isTrial: !!h.isTrial }));
  const checkIns: HabitCheckInLike[] = checkInRows.map((c) => ({ habitId: c.habitId, date: parseDate(c.date) }));

  const series = computeAdherenceSeries(habits, checkIns, seriesFrom, today);
  const currentStreak = computeCurrentStreak(series, today);

  const todayTime = today.getTime();
  const todayCheckIns = checkInRows.filter((c) => parseDate(c.date).getTime() === todayTime);
  const checkedInTodaySet = new Set(todayCheckIns.map((c) => c.habitId));
  const todayDurationByHabit = new Map(todayCheckIns.map((c) => [c.habitId, c.durationMin]));

  const habitsWithState = habitRows.map((h) => {
    const habitCheckIns: HabitCheckInLike[] = checkInRows.filter((c) => c.habitId === h.id).map((c) => ({ habitId: c.habitId, date: parseDate(c.date) }));
    return {
      ...toPublicHabit(h, h.categoryId ? categoryById.get(h.categoryId) ?? null : null),
      checkedInToday: checkedInTodaySet.has(h.id),
      todayDurationMin: todayDurationByHabit.get(h.id) ?? null,
      daysSinceLastCheckIn: daysSinceLastCheckIn(habitCheckIns, parseDate(h.createdAt), today),
      trialDayNumber: h.isTrial && h.trialStartDate ? trialDayNumber(parseDate(h.trialStartDate), today) : null,
      trialElapsed: h.isTrial && h.trialStartDate ? isTrialElapsed(parseDate(h.trialStartDate), today) : null,
    };
  });

  return { habits: habitsWithState, series, currentStreak };
}

export function createHabit(db: LocalDb, userId: string, input: CreateHabitInput) {
  const id = crypto.randomUUID();
  const ts = now();
  const isTrial = input.isTrial ?? false;

  db.run(
    `INSERT INTO "Habit"
       ("id","userId","title","description","icon","color","categoryId","virtualAssetValuePerCheckIn","isTrial","cue","celebration","trialStartDate","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.title,
      input.description ?? null,
      input.icon ?? null,
      // The web route passes body.color straight through to Prisma; Prisma treats an
      // `undefined` field as "use the schema default" rather than NULL, so this fallback
      // reproduces that default (color isn't nullable on the model).
      input.color ?? "#3a8d80",
      input.categoryId ?? null,
      input.virtualAssetValuePerCheckIn ?? 0,
      isTrial ? 1 : 0,
      input.cue ?? null,
      input.celebration ?? null,
      isTrial ? startOfDay(new Date()).toISOString() : null,
      ts,
      ts,
    ]
  );
  // isActive is omitted above and left to the schema's DEFAULT true, matching how other
  // repositories/tests in this codebase (e.g. reportEngine.test.ts's insertCategory) rely on
  // schema-level Boolean defaults instead of restating them.

  const fresh = getHabitWithCategory(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Habit", entityId: id, newValue: fresh });
  return fresh;
}

export function updateHabit(db: LocalDb, userId: string, id: string, input: UpdateHabitInput) {
  const existing = getOwnedHabitRow(db, userId, id);
  const promoted = !!existing.isTrial && input.isTrial === false;

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.description !== undefined) set("description", input.description);
  if (input.icon !== undefined) set("icon", input.icon);
  if (input.color !== undefined) set("color", input.color);
  if (input.categoryId !== undefined) set("categoryId", input.categoryId);
  if (input.virtualAssetValuePerCheckIn !== undefined) set("virtualAssetValuePerCheckIn", input.virtualAssetValuePerCheckIn);
  if (input.isActive !== undefined) set("isActive", input.isActive ? 1 : 0);
  if (input.isTrial !== undefined) set("isTrial", input.isTrial ? 1 : 0);
  if (input.cue !== undefined) set("cue", input.cue);
  if (input.celebration !== undefined) set("celebration", input.celebration);
  // A promoted trial's createdAt still points at when the 3-day trial started. Left as-is,
  // computeAdherenceSeries would treat the habit as "eligible" retroactively for those trial
  // days — resetting createdAt to now makes the habit count only from the promotion moment
  // forward. See the identical comment in src/app/api/habits/[id]/route.ts.
  if (promoted) set("createdAt", now());
  set("updatedAt", now());

  db.run(`UPDATE "Habit" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const fresh = getHabitWithCategory(db, userId, id);
  writeLocalAuditLog(db, {
    userId,
    action: promoted ? "HABIT_PROMOTE_TRIAL" : "UPDATE",
    entityType: "Habit",
    entityId: id,
    oldValue: existing,
    newValue: fresh,
  });
  return fresh;
}

export function deleteHabit(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedHabitRow(db, userId, id);
  db.run(`UPDATE "Habit" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now(), now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Habit", entityId: id, oldValue: existing });
  return { ok: true };
}

/** Toggles the check-in for a habit on a given day (defaults to today). */
export function toggleHabitCheckIn(db: LocalDb, userId: string, habitId: string, input: HabitCheckInToggleInput = {}) {
  const habit = db.get<HabitRow>(`SELECT * FROM "Habit" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [habitId, userId]);
  if (!habit) throw new ApiError("عادت پیدا نشد.", 404);

  const dateIso = startOfDay(input.date ? new Date(input.date) : new Date()).toISOString();
  const existing = db.get<HabitCheckInRow>(`SELECT * FROM "HabitCheckIn" WHERE "habitId" = ? AND "date" = ?`, [habitId, dateIso]);

  if (existing) {
    db.run(`DELETE FROM "VirtualAssetEntry" WHERE "habitCheckInId" = ?`, [existing.id]);
    db.run(`DELETE FROM "HabitCheckIn" WHERE "id" = ?`, [existing.id]);
    writeLocalAuditLog(db, { userId, action: "HABIT_UNCHECK", entityType: "HabitCheckIn", entityId: existing.id, oldValue: existing });
    return { checkedIn: false };
  }

  const id = crypto.randomUUID();
  db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [id, habitId, dateIso, now(), now()]);
  syncHabitCheckInVirtualAsset(db, id);

  const checkIn = db.get<HabitCheckInRow>(`SELECT * FROM "HabitCheckIn" WHERE "id" = ?`, [id]);
  writeLocalAuditLog(db, { userId, action: "HABIT_CHECKIN", entityType: "HabitCheckIn", entityId: id, newValue: checkIn });
  return { checkedIn: true };
}

/**
 * Sets (or clears, with durationMin: 0) how long the user spent on a habit that day.
 * Implicitly checks the day in if it wasn't already, and re-syncs the day's virtual asset
 * value — see habitSync.ts.
 */
export function logHabitCheckInDuration(db: LocalDb, userId: string, habitId: string, input: HabitCheckInDurationInput) {
  const habit = db.get<HabitRow>(`SELECT * FROM "Habit" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [habitId, userId]);
  if (!habit) throw new ApiError("عادت پیدا نشد.", 404);

  const dateIso = startOfDay(input.date ? new Date(input.date) : new Date()).toISOString();
  const durationMin = input.durationMin > 0 ? input.durationMin : null;
  const existing = db.get<HabitCheckInRow>(`SELECT * FROM "HabitCheckIn" WHERE "habitId" = ? AND "date" = ?`, [habitId, dateIso]);

  let checkInId: string;
  if (existing) {
    db.run(`UPDATE "HabitCheckIn" SET "durationMin" = ?, "updatedAt" = ? WHERE "id" = ?`, [durationMin, now(), existing.id]);
    checkInId = existing.id;
  } else {
    checkInId = crypto.randomUUID();
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","durationMin","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      checkInId,
      habitId,
      dateIso,
      durationMin,
      now(),
      now(),
    ]);
  }

  syncHabitCheckInVirtualAsset(db, checkInId);

  const checkIn = db.get<HabitCheckInRow>(`SELECT * FROM "HabitCheckIn" WHERE "id" = ?`, [checkInId])!;
  writeLocalAuditLog(db, {
    userId,
    action: "HABIT_LOG_DURATION",
    entityType: "HabitCheckIn",
    entityId: checkInId,
    oldValue: existing ?? null,
    newValue: checkIn,
  });
  return { checkIn };
}
