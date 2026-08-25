import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction, syncTaskVirtualAsset } from "@/lib/directCostSync";
import { createTaskSchema } from "@/lib/schemas/tasks";

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
    const body = createTaskSchema.parse(await req.json());

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
