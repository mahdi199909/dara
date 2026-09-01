// On-device port of src/lib/habitSync.ts's syncHabitCheckInVirtualAsset — same additive
// "flat per-check-in value + optional time-based value" math, raw SQL instead of Prisma
// upsert/include. Fully self-contained (Habit + Category + HabitCheckIn + VirtualAssetEntry
// only), so this is a complete port with nothing deferred.
import { ApiError } from "@/lib/apiErrorBase";
import { computeVirtualAssetValue } from "@/lib/timeCost";
import type { LocalDb } from "./db";

interface HabitCheckInRow {
  id: string;
  habitId: string;
  date: string;
  durationMin: number | null;
}
interface HabitRow {
  id: string;
  userId: string;
  categoryId: string | null;
  virtualAssetValuePerCheckIn: number;
}
interface CategoryRow {
  id: string;
  generatesVirtualAsset: number;
  virtualAssetValuePerHour: number | null;
}

/**
 * Mirrors a Habit check-in's Toman value into a VirtualAssetEntry, the same "exactly one
 * source" pattern used for Activity/Task/Project virtual assets. Combines two additive
 * sources: the habit's flat per-check-in value (always applies), plus a time-based value when
 * a duration was logged for this check-in and the habit's category has a virtual-asset rate.
 *
 * Note: the web version uses `prisma.habitCheckIn.findUniqueOrThrow`, whose "not found" error
 * is an untyped PrismaClientKnownRequestError (falls through handleApiError's generic 500
 * branch) rather than an ApiError. This path is unreachable in practice — every caller passes
 * the id of a check-in it just created/updated in the same transaction-less call — so throwing
 * ApiError(404) here instead is a harmless, deliberate simplification.
 */
export function syncHabitCheckInVirtualAsset(db: LocalDb, checkInId: string): void {
  const checkIn = db.get<HabitCheckInRow>(`SELECT * FROM "HabitCheckIn" WHERE "id" = ?`, [checkInId]);
  if (!checkIn) throw new ApiError("چک-این عادت پیدا نشد.", 404);

  const habit = db.get<HabitRow>(`SELECT * FROM "Habit" WHERE "id" = ?`, [checkIn.habitId]);
  if (!habit) throw new ApiError("عادت پیدا نشد.", 404);

  const category = habit.categoryId ? db.get<CategoryRow>(`SELECT * FROM "Category" WHERE "id" = ?`, [habit.categoryId]) : undefined;

  const durationMin = checkIn.durationMin ?? 0;
  const valuePerHour = durationMin > 0 && category?.generatesVirtualAsset ? category.virtualAssetValuePerHour ?? 0 : 0;
  const timeValue = valuePerHour > 0 ? computeVirtualAssetValue(durationMin, valuePerHour) : 0;
  const totalValue = habit.virtualAssetValuePerCheckIn + timeValue;

  if (totalValue <= 0) {
    db.run(`DELETE FROM "VirtualAssetEntry" WHERE "habitCheckInId" = ?`, [checkInId]);
    return;
  }

  const existing = db.get<{ id: string }>(`SELECT "id" FROM "VirtualAssetEntry" WHERE "habitCheckInId" = ?`, [checkInId]);
  if (existing) {
    db.run(`UPDATE "VirtualAssetEntry" SET "categoryId" = ?, "durationMin" = ?, "valuePerHour" = ?, "totalValue" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      habit.categoryId,
      durationMin,
      valuePerHour,
      totalValue,
      new Date().toISOString(),
      existing.id,
    ]);
  } else {
    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","habitCheckInId","categoryId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), habit.userId, checkInId, habit.categoryId, durationMin, valuePerHour, totalValue, checkIn.date, new Date().toISOString(), new Date().toISOString()]
    );
  }
}
