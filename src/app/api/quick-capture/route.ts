import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { parseQuickCapture } from "@/lib/parser";
import { addManualTimeEntry, syncDirectCostTransaction } from "@/lib/activityService";
import { resolveDefaultAccountId } from "@/lib/accounts";

const schema = z.object({
  text: z.string().min(1).max(500),
  type: z.enum(["TASK", "ACTIVITY", "EVENT", "EXPENSE"]).optional(),
  title: z.string().max(200).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  amount: z.number().int().min(0).optional(),
  date: z.string().datetime().optional(),
  categoryId: z.string().optional(),
  projectId: z.string().optional(),
  accountId: z.string().optional(),
});

async function resolveCategory(userId: string, categoryId: string | undefined, hint: string | null) {
  if (categoryId) return categoryId;
  if (!hint) return undefined;
  const match = await prisma.category.findFirst({
    where: { userId, deletedAt: null, name: { equals: hint } },
  });
  return match?.id;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = schema.parse(await req.json());
    const parsed = parseQuickCapture(body.text);

    const type = body.type ?? parsed.suggestedType;
    const title = body.title ?? parsed.title;
    const durationMinutes = body.durationMinutes ?? parsed.durationMinutes ?? undefined;
    const amount = body.amount ?? parsed.amount ?? undefined;
    const date = body.date ? new Date(body.date) : parsed.date ?? undefined;
    const categoryId = await resolveCategory(userId, body.categoryId, parsed.categoryHint);

    const { ipAddress, userAgent } = requestMeta(req);
    let result: Record<string, unknown>;

    if (type === "TASK") {
      const task = await prisma.task.create({
        data: { userId, title, categoryId, projectId: body.projectId, dueDate: date },
      });
      await writeAuditLog({ userId, action: "CREATE", entityType: "Task", entityId: task.id, newValue: task, ipAddress, userAgent, metadata: { source: "quick_capture", rawText: body.text } });
      result = { entityType: "Task", entity: task };
    } else if (type === "ACTIVITY") {
      const activity = await prisma.activity.create({
        data: { userId, title, categoryId, projectId: body.projectId, directCost: amount ?? 0 },
      });
      if (durationMinutes && durationMinutes > 0) {
        await addManualTimeEntry(activity.id, { durationMin: durationMinutes });
      }
      if (activity.directCost > 0) await syncDirectCostTransaction(activity.id);
      const fresh = await prisma.activity.findUnique({ where: { id: activity.id }, include: { timeEntries: true, virtualAssetEntry: true } });
      await writeAuditLog({ userId, action: "CREATE", entityType: "Activity", entityId: activity.id, newValue: fresh, ipAddress, userAgent, metadata: { source: "quick_capture", rawText: body.text } });
      result = { entityType: "Activity", entity: fresh };
    } else if (type === "EVENT") {
      const startAt = date ?? new Date();
      const endAt = new Date(startAt.getTime() + (durationMinutes ?? 60) * 60000);
      const event = await prisma.event.create({
        data: { userId, title, startAt, endAt, categoryId, projectId: body.projectId },
      });
      await writeAuditLog({ userId, action: "CREATE", entityType: "Event", entityId: event.id, newValue: event, ipAddress, userAgent, metadata: { source: "quick_capture", rawText: body.text } });
      result = { entityType: "Event", entity: event };
    } else {
      const accountId = body.accountId ?? (await resolveDefaultAccountId(userId));
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: "EXPENSE",
          amount: amount ?? 0,
          date: date ?? new Date(),
          description: title,
          accountId,
          categoryId,
          projectId: body.projectId,
        },
      });
      await writeAuditLog({ userId, action: "CREATE_EXPENSE", entityType: "Transaction", entityId: transaction.id, newValue: transaction, ipAddress, userAgent, metadata: { source: "quick_capture", rawText: body.text } });
      result = { entityType: "Transaction", entity: transaction };
    }

    return NextResponse.json({ ...result, parsed }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
