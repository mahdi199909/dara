import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { syncEventDirectCostTransaction, syncEventIncomeTransaction } from "@/lib/directCostSync";
import { RECURRENCE_FREQS, VALUE_TYPES } from "@/lib/types";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  directCost: z.number().int().min(0).optional(),
  incomeAmount: z.number().int().min(0).optional(),
  recurrenceFreq: z.enum(RECURRENCE_FREQS).optional(),
  recurrenceInterval: z.number().int().min(1).optional(),
  recurrenceUntil: z.string().datetime().nullable().optional(),
  recurrenceCount: z.number().int().min(1).max(500).nullable().optional(),
});

async function getOwned(userId: string, id: string) {
  const event = await prisma.event.findFirst({ where: { id, userId, deletedAt: null } });
  if (!event) throw new ApiError("رویداد پیدا نشد.", 404);
  return event;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    const event = await prisma.event.update({
      where: { id: params.id },
      data: {
        ...body,
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : undefined,
        recurrenceUntil: body.recurrenceUntil === undefined ? undefined : body.recurrenceUntil ? new Date(body.recurrenceUntil) : null,
      },
    });

    if (body.directCost !== undefined) await syncEventDirectCostTransaction(event.id);
    if (body.incomeAmount !== undefined) await syncEventIncomeTransaction(event.id);

    if (body.startAt) {
      const reminders = await prisma.reminder.findMany({ where: { eventId: event.id } });
      for (const r of reminders) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: { remindAt: new Date(event.startAt.getTime() - r.offsetMinutes * 60000), notified: false },
        });
      }
    }

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "Event",
      entityId: event.id,
      oldValue: existing,
      newValue: event,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ event });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.event.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Event",
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
