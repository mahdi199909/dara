import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { syncTaskDirectCostTransaction, syncTaskIncomeTransaction, syncTaskVirtualAsset } from "@/lib/directCostSync";
import { updateTaskSchema } from "@/lib/schemas/tasks";

async function getOwned(userId: string, id: string) {
  const task = await prisma.task.findFirst({ where: { id, userId, deletedAt: null } });
  if (!task) throw new ApiError("کار پیدا نشد.", 404);
  return task;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateTaskSchema.parse(await req.json());

    const wasDone = existing.status === "DONE";
    const willBeDone = body.status === "DONE";

    const task = await prisma.task.update({
      where: { id: params.id },
      data: {
        ...body,
        dueDate: body.dueDate === undefined ? undefined : body.dueDate ? new Date(body.dueDate) : null,
        startAt: body.startAt === undefined ? undefined : body.startAt ? new Date(body.startAt) : null,
        endAt: body.endAt === undefined ? undefined : body.endAt ? new Date(body.endAt) : null,
        completedAt: !wasDone && willBeDone ? new Date() : willBeDone === false ? null : undefined,
      },
    });

    if (body.directCost !== undefined) await syncTaskDirectCostTransaction(task.id);
    if (body.incomeAmount !== undefined) await syncTaskIncomeTransaction(task.id);
    if (body.startAt !== undefined || body.endAt !== undefined || body.categoryId !== undefined) {
      await syncTaskVirtualAsset(task.id);
    }

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: !wasDone && willBeDone ? "COMPLETE_TASK" : "UPDATE",
      entityType: "Task",
      entityId: task.id,
      oldValue: existing,
      newValue: task,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ task });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.task.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Task",
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
