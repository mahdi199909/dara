import { prisma } from "./db";
import { computeVirtualAssetValue } from "./timeCost";

/**
 * Mirrors a Habit check-in's Toman value into a VirtualAssetEntry, the same "exactly one
 * source" pattern used for Activity/Task/Project virtual assets — see VirtualAssetEntry in
 * prisma/schema.prisma. Combines two additive sources: the habit's flat per-check-in value
 * (always applies), plus a time-based value when a duration was logged for this check-in and
 * the habit's category has a virtual-asset rate — the same durationMin/hourlyRate math
 * Activity/Task already use, so logging time on a habit earns virtual assets the same way
 * logging time anywhere else in the app does.
 */
export async function syncHabitCheckInVirtualAsset(checkInId: string) {
  const checkIn = await prisma.habitCheckIn.findUniqueOrThrow({
    where: { id: checkInId },
    include: { habit: { include: { category: true } } },
  });
  const { habit } = checkIn;
  const category = habit.category;

  const durationMin = checkIn.durationMin ?? 0;
  const valuePerHour = durationMin > 0 && category?.generatesVirtualAsset ? category.virtualAssetValuePerHour ?? 0 : 0;
  const timeValue = valuePerHour > 0 ? computeVirtualAssetValue(durationMin, valuePerHour) : 0;
  const totalValue = habit.virtualAssetValuePerCheckIn + timeValue;

  if (totalValue <= 0) {
    await prisma.virtualAssetEntry.deleteMany({ where: { habitCheckInId: checkInId } });
    return;
  }

  await prisma.virtualAssetEntry.upsert({
    where: { habitCheckInId: checkInId },
    create: {
      userId: habit.userId,
      habitCheckInId: checkInId,
      categoryId: habit.categoryId,
      durationMin,
      valuePerHour,
      totalValue,
      date: checkIn.date,
    },
    update: {
      categoryId: habit.categoryId,
      durationMin,
      valuePerHour,
      totalValue,
    },
  });
}
