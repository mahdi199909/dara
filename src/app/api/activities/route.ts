import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { addManualTimeEntry, startTimer, syncDirectCostTransaction } from "@/lib/activityService";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  categoryId: z.string().optional(),
  taskId: z.string().optional(),
  projectId: z.string().optional(),
  directCost: z.number().int().min(0).optional(),
  durationMin: z.number().int().min(0).optional(),
  startTimerNow: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const projectId = searchParams.get("projectId");
    const categoryId = searchParams.get("categoryId");
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    const activities = await prisma.activity.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(projectId ? { projectId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: { category: true, project: true, task: true, timeEntries: true, virtualAssetEntry: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({ activities });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const activity = await prisma.activity.create({
      data: {
        userId,
        title: body.title,
        notes: body.notes,
        categoryId: body.categoryId,
        taskId: body.taskId,
        projectId: body.projectId,
        directCost: body.directCost ?? 0,
      },
    });

    if (body.durationMin && body.durationMin > 0) {
      await addManualTimeEntry(activity.id, { durationMin: body.durationMin });
    } else if (body.startTimerNow) {
      await startTimer(userId, activity.id);
    }

    if (activity.directCost > 0) await syncDirectCostTransaction(activity.id);

    const fresh = await prisma.activity.findUnique({
      where: { id: activity.id },
      include: { category: true, timeEntries: true, virtualAssetEntry: true },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Activity",
      entityId: activity.id,
      newValue: fresh,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ activity: fresh }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
