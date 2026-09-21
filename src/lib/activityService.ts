import { prisma } from "./db";
import { withTransaction } from "./transaction";
import { computeVirtualAssetValue } from "./timeCost";
import { syncActivityDirectCostTransaction } from "./directCostSync";
import { deleteVirtualAssetEntriesWithTombstones } from "./tombstones";

export { syncActivityDirectCostTransaction as syncDirectCostTransaction };

/** Recomputes Activity.totalDurationMin from its TimeEntries and syncs the VirtualAssetEntry (create/update/delete). */
async function recalcActivityDurationWrites(activityId: string) {
  const activity = await prisma.activity.findUniqueOrThrow({
    where: { id: activityId },
    include: { timeEntries: true, category: true },
  });

  const totalDurationMin = activity.timeEntries.reduce((sum, te) => sum + (te.durationMin ?? 0), 0);

  await prisma.activity.update({ where: { id: activityId }, data: { totalDurationMin } });

  const cat = activity.category;
  if (cat?.generatesVirtualAsset && cat.virtualAssetValuePerHour && totalDurationMin > 0) {
    const totalValue = computeVirtualAssetValue(totalDurationMin, cat.virtualAssetValuePerHour);
    await prisma.virtualAssetEntry.upsert({
      where: { activityId },
      create: {
        userId: activity.userId,
        activityId,
        categoryId: cat.id,
        durationMin: totalDurationMin,
        valuePerHour: cat.virtualAssetValuePerHour,
        totalValue,
        date: activity.createdAt,
      },
      update: {
        categoryId: cat.id,
        durationMin: totalDurationMin,
        valuePerHour: cat.virtualAssetValuePerHour,
        totalValue,
      },
    });
  } else {
    await deleteVirtualAssetEntriesWithTombstones({ activityId });
  }

  return totalDurationMin;
}

async function startTimerWrites(userId: string, activityId: string) {
  await prisma.timeEntry.updateMany({
    where: { activity: { userId }, isRunning: true },
    data: { isRunning: false, endAt: new Date() },
  });

  // Persist a computed duration for any timers that were force-stopped above.
  const stillOpen = await prisma.timeEntry.findMany({
    where: { activity: { userId }, isRunning: false, endAt: { not: null }, durationMin: null },
  });
  for (const te of stillOpen) {
    const durationMin = Math.max(0, Math.round((te.endAt!.getTime() - te.startAt.getTime()) / 60000));
    await prisma.timeEntry.update({ where: { id: te.id }, data: { durationMin } });
    await recalcActivityDuration(te.activityId);
  }

  const timeEntry = await prisma.timeEntry.create({
    data: { activityId, startAt: new Date(), isRunning: true },
  });
  return timeEntry;
}

async function stopTimerWrites(activityId: string) {
  const running = await prisma.timeEntry.findFirst({ where: { activityId, isRunning: true } });
  if (!running) return null;

  const endAt = new Date();
  const durationMin = Math.max(0, Math.round((endAt.getTime() - running.startAt.getTime()) / 60000));

  const timeEntry = await prisma.timeEntry.update({
    where: { id: running.id },
    data: { endAt, durationMin, isRunning: false },
  });

  await recalcActivityDuration(activityId);
  return timeEntry;
}

async function addManualTimeEntryWrites(
  activityId: string,
  input: { startAt?: Date; endAt?: Date; durationMin?: number }
) {
  let { startAt, endAt, durationMin } = input;

  if (durationMin && !startAt && !endAt) {
    endAt = new Date();
    startAt = new Date(endAt.getTime() - durationMin * 60000);
  } else if (startAt && endAt) {
    durationMin = Math.max(0, Math.round((endAt.getTime() - startAt.getTime()) / 60000));
  } else if (startAt && durationMin) {
    endAt = new Date(startAt.getTime() + durationMin * 60000);
  } else {
    throw new Error("Either durationMin or both startAt/endAt must be provided");
  }

  const timeEntry = await prisma.timeEntry.create({
    data: { activityId, startAt, endAt, durationMin, isRunning: false },
  });

  await recalcActivityDuration(activityId);
  return timeEntry;
}

// --- The public functions. Each is one transaction (or joins the one its caller already opened), so a
// timer that stopped is never left with an activity total that was not updated, and a virtual asset never
// disagrees with the time it was computed from.

/** Recomputes Activity.totalDurationMin from its TimeEntries and syncs the VirtualAssetEntry (create/update/delete). */
export function recalcActivityDuration(activityId: string) {
  return withTransaction(() => recalcActivityDurationWrites(activityId), { entityType: "Activity", entityId: activityId });
}

export function startTimer(userId: string, activityId: string) {
  return withTransaction(() => startTimerWrites(userId, activityId), { operation: "TIME_TIMER_START", entityType: "Activity", entityId: activityId });
}

export function stopTimer(activityId: string) {
  return withTransaction(() => stopTimerWrites(activityId), { operation: "TIME_TIMER_STOP", entityType: "Activity", entityId: activityId });
}

export function addManualTimeEntry(activityId: string, input: Parameters<typeof addManualTimeEntryWrites>[1]) {
  return withTransaction(() => addManualTimeEntryWrites(activityId, input), { operation: "TIME_ENTRY_CREATE", entityType: "TimeEntry", entityId: activityId });
}
