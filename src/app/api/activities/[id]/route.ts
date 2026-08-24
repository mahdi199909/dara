import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { recalcActivityDuration, syncDirectCostTransaction } from "@/lib/activityService";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  directCost: z.number().int().min(0).optional(),
});

async function getOwned(userId: string, id: string) {
  const activity = await prisma.activity.findFirst({ where: { id, userId, deletedAt: null } });
  if (!activity) throw new ApiError("فعالیت پیدا نشد.", 404);
  return activity;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    await getOwned(userId, params.id);
    const activity = await prisma.activity.findUnique({
      where: { id: params.id },
      include: { category: true, project: true, task: true, timeEntries: { orderBy: { startAt: "desc" } }, virtualAssetEntry: true },
    });
    return NextResponse.json({ activity });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    const activity = await prisma.activity.update({ where: { id: params.id }, data: body });
    if (body.categoryId !== undefined) await recalcActivityDuration(activity.id);
    if (body.directCost !== undefined) await syncDirectCostTransaction(activity.id);

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "Activity",
      entityId: activity.id,
      oldValue: existing,
      newValue: activity,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ activity });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.activity.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Activity",
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
