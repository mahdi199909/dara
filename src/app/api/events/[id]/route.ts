import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { syncEventDirectCostTransaction, syncEventIncomeTransaction } from "@/lib/directCostSync";
import { RECURRENCE_FREQS, VALUE_TYPES } from "@/lib/types";
import { assertNoOverlap } from "@/lib/timeOverlapServer";
import { occupiedRange } from "@/lib/timeOverlap";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

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
  directCost: tomanInt().min(0).optional(),
  incomeAmount: tomanInt().min(0).optional(),
  recurrenceFreq: z.enum(RECURRENCE_FREQS).optional(),
  recurrenceInterval: z.number().int().min(1).optional(),
  recurrenceUntil: z.string().datetime().nullable().optional(),
  recurrenceCount: z.number().int().min(1).max(500).nullable().optional(),
  // Set by a client that already saw the overlap warning and chose to save anyway (see src/lib/timeOverlap.ts).
  allowOverlap: z.boolean().optional(),
});

async function getOwned(userId: string, id: string) {
  const event = await prisma.event.findFirst({ where: { id, userId, deletedAt: null } });
  if (!event) throw new ApiError("رویداد پیدا نشد.", 404);
  return event;
}

async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const { allowOverlap, ...body } = updateSchema.parse(await req.json());

    // Only when the time itself changes; a recurring series or an all-day entry is not checked.
    if (body.startAt !== undefined || body.endAt !== undefined || body.allDay !== undefined || body.recurrenceFreq !== undefined) {
      const allDay = body.allDay ?? existing.allDay;
      const freq = body.recurrenceFreq ?? existing.recurrenceFreq;
      if (!allDay && freq === "NONE") {
        await assertNoOverlap(userId, occupiedRange(body.startAt ?? existing.startAt, body.endAt ?? existing.endAt), {
          allowOverlap,
          self: { kind: "EVENT", id: existing.id },
        });
      }
    }

    const event = await withTransaction(
      async () => {
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
        return event;
      },
      { operation: "EVENT_UPDATE", entityType: "Event", entityId: params.id }
    );

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

async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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

const loggedPATCH = withApiLogging("PATCH", "/api/events/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/events/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
