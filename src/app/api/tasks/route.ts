import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction, syncTaskVirtualAsset } from "@/lib/directCostSync";
import { TASK_STATUSES, VALUE_TYPES } from "@/lib/types";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: z.string().datetime().optional(),
  categoryId: z.string().optional(),
  projectId: z.string().optional(),
  estimatedCost: z.number().int().min(0).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  directCost: z.number().int().min(0).optional(),
  incomeAmount: z.number().int().min(0).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const projectId = searchParams.get("projectId");

    const tasks = await prisma.task.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(projectId ? { projectId } : {}),
      },
      include: { category: true, project: true },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description,
        status: body.status,
        categoryId: body.categoryId,
        projectId: body.projectId,
        estimatedCost: body.estimatedCost,
        valueType: body.valueType,
        directCost: body.directCost ?? 0,
        incomeAmount: body.incomeAmount ?? 0,
        userId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : undefined,
      },
    });

    if (task.directCost > 0) await syncTaskDirectCostTransaction(task.id);
    if (task.incomeAmount > 0) await syncTaskIncomeTransaction(task.id);
    if (task.startAt && task.endAt) await syncTaskVirtualAsset(task.id);
    const fresh = await prisma.task.findUnique({ where: { id: task.id }, include: { category: true, project: true } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Task",
      entityId: task.id,
      newValue: fresh,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ task: fresh }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
