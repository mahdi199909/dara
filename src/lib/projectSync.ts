import { prisma } from "./db";
import { computeHourlyValue } from "./hourlyValue";
import { computeTimeCost } from "./timeCost";

/**
 * Every Project gets a matching Category (same name, defaults to "دارایی") so project work
 * categorizes naturally in Quick Capture without the user maintaining two parallel lists —
 * requested so "هر پروژه رو هم به عنوان یک دسته‌بندی توی کارها اتوماتیک اضافه کن".
 */
export async function createProjectCategory(project: { id: string; userId: string; name: string; color: string }) {
  return prisma.category.create({
    data: {
      userId: project.userId,
      name: project.name,
      icon: "📁",
      color: project.color,
      kind: "PRODUCTIVE",
      valueType: "ASSET",
      projectId: project.id,
    },
  });
}

export async function renameProjectCategory(projectId: string, name: string) {
  await prisma.category.updateMany({ where: { projectId }, data: { name } });
}

/** Soft-deleting a project deactivates (not deletes) its category, preserving historical categorization on past tasks/transactions. */
export async function deactivateProjectCategory(projectId: string) {
  await prisma.category.updateMany({ where: { projectId }, data: { isActive: false } });
}

/**
 * Marking a project COMPLETED registers it as its own virtual asset — the real cost
 * (direct cost + time cost) invested across all its tasks/activities/transactions,
 * representing "this finished project is itself worth what you put into it." Un-completing
 * removes the entry again.
 */
export async function syncProjectCompletionAsset(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  if (project.status !== "COMPLETED") {
    await prisma.virtualAssetEntry.deleteMany({ where: { projectId } });
    return;
  }

  const [settings, activities, tasks, transactions] = await Promise.all([
    prisma.settings.findUnique({ where: { userId: project.userId } }),
    prisma.activity.findMany({ where: { projectId, deletedAt: null } }),
    prisma.task.findMany({ where: { projectId, deletedAt: null } }),
    prisma.transaction.findMany({ where: { projectId, deletedAt: null } }),
  ]);

  const hourlyValue = computeHourlyValue(settings ?? {});

  const activityDurationMin = activities.reduce((s, a) => s + a.totalDurationMin, 0);
  const taskDurationMin = tasks.reduce((s, t) => {
    if (!t.startAt || !t.endAt) return s;
    return s + Math.max(0, Math.round((t.endAt.getTime() - t.startAt.getTime()) / 60000));
  }, 0);
  const totalDurationMin = activityDurationMin + taskDurationMin;

  const directCost =
    activities.reduce((s, a) => s + a.directCost, 0) +
    tasks.reduce((s, t) => s + t.directCost, 0) +
    transactions.filter((t) => t.type === "EXPENSE" && !t.activityId && !t.taskId).reduce((s, t) => s + t.amount, 0);

  const timeCost = computeTimeCost(totalDurationMin, hourlyValue);
  const totalValue = directCost + timeCost;

  if (totalValue <= 0) {
    await prisma.virtualAssetEntry.deleteMany({ where: { projectId } });
    return;
  }

  await prisma.virtualAssetEntry.upsert({
    where: { projectId },
    create: {
      userId: project.userId,
      projectId,
      durationMin: totalDurationMin,
      valuePerHour: hourlyValue,
      totalValue,
      date: project.completedAt ?? new Date(),
    },
    update: {
      durationMin: totalDurationMin,
      valuePerHour: hourlyValue,
      totalValue,
      date: project.completedAt ?? new Date(),
    },
  });
}
