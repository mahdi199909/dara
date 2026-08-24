import { prisma } from "./db";
import { resolveDefaultAccountId } from "./accounts";
import { computeVirtualAssetValue } from "./timeCost";

/**
 * Keeps an entity's optional directCost/incomeAmount in sync with a linked Transaction, so
 * it flows into real account balances and monthly totals instead of being a disconnected
 * annotation that would either double-count or go missing from financial reports.
 * Shared by Activity, Task, and Event, which all carry this directCost/incomeAmount shape.
 * Cost and income transactions are looked up by (link field + type) so a Task/Event can
 * carry both a linked EXPENSE and a linked INCOME transaction at once without colliding.
 */

export async function syncActivityDirectCostTransaction(activityId: string) {
  const activity = await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
  const existingTx = await prisma.transaction.findFirst({ where: { activityId, type: "EXPENSE", deletedAt: null } });

  if (activity.directCost <= 0) {
    if (existingTx) await prisma.transaction.update({ where: { id: existingTx.id }, data: { deletedAt: new Date() } });
    return;
  }

  if (existingTx) {
    await prisma.transaction.update({
      where: { id: existingTx.id },
      data: {
        amount: activity.directCost,
        description: activity.title,
        categoryId: activity.categoryId,
        projectId: activity.projectId,
        taskId: activity.taskId,
      },
    });
  } else {
    const accountId = await resolveDefaultAccountId(activity.userId);
    await prisma.transaction.create({
      data: {
        userId: activity.userId,
        type: "EXPENSE",
        amount: activity.directCost,
        date: activity.createdAt,
        description: activity.title,
        accountId,
        categoryId: activity.categoryId,
        projectId: activity.projectId,
        taskId: activity.taskId,
        activityId: activity.id,
      },
    });
  }
}

export async function syncTaskDirectCostTransaction(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const existingTx = await prisma.transaction.findFirst({
    where: { taskId, activityId: null, type: "EXPENSE", deletedAt: null },
  });

  if (task.directCost <= 0) {
    if (existingTx) await prisma.transaction.update({ where: { id: existingTx.id }, data: { deletedAt: new Date() } });
    return;
  }

  if (existingTx) {
    await prisma.transaction.update({
      where: { id: existingTx.id },
      data: {
        amount: task.directCost,
        description: task.title,
        categoryId: task.categoryId,
        projectId: task.projectId,
      },
    });
  } else {
    const accountId = await resolveDefaultAccountId(task.userId);
    await prisma.transaction.create({
      data: {
        userId: task.userId,
        type: "EXPENSE",
        amount: task.directCost,
        date: task.startAt ?? task.dueDate ?? task.createdAt,
        description: task.title,
        accountId,
        categoryId: task.categoryId,
        projectId: task.projectId,
        taskId: task.id,
      },
    });
  }
}

export async function syncTaskIncomeTransaction(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const existingTx = await prisma.transaction.findFirst({
    where: { taskId, activityId: null, type: "INCOME", deletedAt: null },
  });

  if (task.incomeAmount <= 0) {
    if (existingTx) await prisma.transaction.update({ where: { id: existingTx.id }, data: { deletedAt: new Date() } });
    return;
  }

  if (existingTx) {
    await prisma.transaction.update({
      where: { id: existingTx.id },
      data: {
        amount: task.incomeAmount,
        description: task.title,
        categoryId: task.categoryId,
        projectId: task.projectId,
      },
    });
  } else {
    const accountId = await resolveDefaultAccountId(task.userId);
    await prisma.transaction.create({
      data: {
        userId: task.userId,
        type: "INCOME",
        amount: task.incomeAmount,
        date: task.startAt ?? task.dueDate ?? task.createdAt,
        description: task.title,
        accountId,
        categoryId: task.categoryId,
        projectId: task.projectId,
        taskId: task.id,
      },
    });
  }
}

/**
 * Mirrors recalcActivityDuration's virtual-asset logic for Tasks: a Task logged with
 * startAt/endAt in a category that generates virtual assets should build one too, the
 * same as time logged through the fuller Activity/TimeEntry flow — otherwise a category
 * marked "دارایی" would silently stop generating virtual assets depending on which capture
 * path the user happened to use.
 */
export async function syncTaskVirtualAsset(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: { category: true } });

  const durationMin =
    task.startAt && task.endAt ? Math.max(0, Math.round((task.endAt.getTime() - task.startAt.getTime()) / 60000)) : 0;

  const cat = task.category;
  if (cat?.generatesVirtualAsset && cat.virtualAssetValuePerHour && durationMin > 0) {
    const totalValue = computeVirtualAssetValue(durationMin, cat.virtualAssetValuePerHour);
    await prisma.virtualAssetEntry.upsert({
      where: { taskId },
      create: {
        userId: task.userId,
        taskId,
        categoryId: cat.id,
        durationMin,
        valuePerHour: cat.virtualAssetValuePerHour,
        totalValue,
        date: task.startAt!,
      },
      update: {
        categoryId: cat.id,
        durationMin,
        valuePerHour: cat.virtualAssetValuePerHour,
        totalValue,
      },
    });
  } else {
    await prisma.virtualAssetEntry.deleteMany({ where: { taskId } });
  }
}

export async function syncEventDirectCostTransaction(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const existingTx = await prisma.transaction.findFirst({ where: { eventId, type: "EXPENSE", deletedAt: null } });

  if (event.directCost <= 0) {
    if (existingTx) await prisma.transaction.update({ where: { id: existingTx.id }, data: { deletedAt: new Date() } });
    return;
  }

  if (existingTx) {
    await prisma.transaction.update({
      where: { id: existingTx.id },
      data: {
        amount: event.directCost,
        description: event.title,
        categoryId: event.categoryId,
        projectId: event.projectId,
      },
    });
  } else {
    const accountId = await resolveDefaultAccountId(event.userId);
    await prisma.transaction.create({
      data: {
        userId: event.userId,
        type: "EXPENSE",
        amount: event.directCost,
        date: event.startAt,
        description: event.title,
        accountId,
        categoryId: event.categoryId,
        projectId: event.projectId,
        eventId: event.id,
      },
    });
  }
}

export async function syncEventIncomeTransaction(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const existingTx = await prisma.transaction.findFirst({ where: { eventId, type: "INCOME", deletedAt: null } });

  if (event.incomeAmount <= 0) {
    if (existingTx) await prisma.transaction.update({ where: { id: existingTx.id }, data: { deletedAt: new Date() } });
    return;
  }

  if (existingTx) {
    await prisma.transaction.update({
      where: { id: existingTx.id },
      data: {
        amount: event.incomeAmount,
        description: event.title,
        categoryId: event.categoryId,
        projectId: event.projectId,
      },
    });
  } else {
    const accountId = await resolveDefaultAccountId(event.userId);
    await prisma.transaction.create({
      data: {
        userId: event.userId,
        type: "INCOME",
        amount: event.incomeAmount,
        date: event.startAt,
        description: event.title,
        accountId,
        categoryId: event.categoryId,
        projectId: event.projectId,
        eventId: event.id,
      },
    });
  }
}
