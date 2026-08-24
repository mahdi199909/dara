import { prisma } from "./db";

/**
 * Mirrors a Habit's per-check-in Toman value into a VirtualAssetEntry, the same "exactly
 * one source" pattern used for Activity/Task/Project virtual assets — see
 * VirtualAssetEntry in prisma/schema.prisma. Unlike those, a habit check-in isn't
 * time-based, so durationMin/valuePerHour are just 0 and totalValue is the flat per-check-in
 * value configured on the Habit.
 */
export async function syncHabitCheckInVirtualAsset(checkInId: string) {
  const checkIn = await prisma.habitCheckIn.findUniqueOrThrow({ where: { id: checkInId }, include: { habit: true } });
  const { habit } = checkIn;

  if (habit.virtualAssetValuePerCheckIn <= 0) {
    await prisma.virtualAssetEntry.deleteMany({ where: { habitCheckInId: checkInId } });
    return;
  }

  await prisma.virtualAssetEntry.upsert({
    where: { habitCheckInId: checkInId },
    create: {
      userId: habit.userId,
      habitCheckInId: checkInId,
      categoryId: habit.categoryId,
      durationMin: 0,
      valuePerHour: 0,
      totalValue: habit.virtualAssetValuePerCheckIn,
      date: checkIn.date,
    },
    update: {
      categoryId: habit.categoryId,
      totalValue: habit.virtualAssetValuePerCheckIn,
    },
  });
}
