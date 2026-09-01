import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { computeRealCost } from "@/lib/timeCost";
import { renameProjectCategory, deactivateProjectCategory, syncProjectCompletionAsset } from "@/lib/projectSync";
import { PROJECT_STATUSES } from "@/lib/types";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  color: z.string().max(20).optional(),
});

async function getOwned(userId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, userId, deletedAt: null } });
  if (!project) throw new ApiError("پروژه پیدا نشد.", 404);
  return project;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const project = await getOwned(userId, params.id);

    const [tasks, activities, transactions, events, settings, virtualAssetEntry] = await Promise.all([
      prisma.task.findMany({ where: { projectId: project.id, deletedAt: null }, orderBy: { createdAt: "desc" } }),
      prisma.activity.findMany({ where: { projectId: project.id, deletedAt: null }, include: { category: true }, orderBy: { createdAt: "desc" } }),
      prisma.transaction.findMany({ where: { projectId: project.id, deletedAt: null }, orderBy: { date: "desc" } }),
      prisma.event.findMany({ where: { projectId: project.id, deletedAt: null }, orderBy: { startAt: "desc" } }),
      prisma.settings.findUnique({ where: { userId } }),
      prisma.virtualAssetEntry.findFirst({ where: { projectId: project.id } }),
    ]);

    const hourlyValue = computeHourlyValue(settings ?? {});

    // Time comes straight from Activities/Tasks (there's no financial-ledger equivalent for
    // time itself). Money (direct cost, income) is read from Transactions only — every
    // Activity/Task directCost/incomeAmount is already mirrored into a linked Transaction
    // (see lib/directCostSync.ts), so summing both would double-count.
    const activityDurationMin = activities.reduce((s, a) => s + a.totalDurationMin, 0);
    const taskDurationMin = tasks.reduce((s, t) => {
      if (!t.startAt || !t.endAt) return s;
      return s + Math.max(0, Math.round((new Date(t.endAt).getTime() - new Date(t.startAt).getTime()) / 60000));
    }, 0);
    const totalDurationMin = activityDurationMin + taskDurationMin;

    const directCost = transactions.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);
    const income = transactions.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const { timeCost, realCost } = computeRealCost(totalDurationMin, directCost, hourlyValue);

    const doneTasks = tasks.filter((t) => t.status === "DONE").length;
    const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

    return NextResponse.json({
      project,
      tasks,
      activities,
      transactions,
      events,
      virtualAssetEntry,
      summary: {
        progress,
        totalTasks: tasks.length,
        doneTasks,
        totalDurationMin,
        directCost,
        income,
        netCashFlow: income - directCost,
        timeCost,
        realCost,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    const wasCompleted = existing.status === "COMPLETED";
    const willBeCompleted = body.status === "COMPLETED";

    const project = await prisma.project.update({
      where: { id: params.id },
      data: {
        ...body,
        completedAt: !wasCompleted && willBeCompleted ? new Date() : body.status && body.status !== "COMPLETED" ? null : undefined,
      },
    });

    if (body.name && body.name !== existing.name) await renameProjectCategory(project.id, body.name);
    if (body.status !== undefined) await syncProjectCompletionAsset(project.id);

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: !wasCompleted && willBeCompleted ? "COMPLETE_PROJECT" : "UPDATE",
      entityType: "Project",
      entityId: project.id,
      oldValue: existing,
      newValue: project,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ project });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.project.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    await deactivateProjectCategory(params.id);

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Project",
      entityId: params.id,
      oldValue: existing,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
