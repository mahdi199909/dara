import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";

const bodySchema = z.object({ occurrenceDate: z.string().datetime() });

/**
 * Toggles completion for one occurrence of an event (identified by its own startAt, since a
 * recurring event has no per-occurrence row — see EventCompletion in prisma/schema.prisma).
 * Only completed occurrences count toward the Reports time totals.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const event = await prisma.event.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!event) throw new ApiError("رویداد پیدا نشد.", 404);

    const { occurrenceDate } = bodySchema.parse(await req.json());
    const date = new Date(occurrenceDate);

    const existing = await prisma.eventCompletion.findUnique({
      where: { eventId_occurrenceDate: { eventId: event.id, occurrenceDate: date } },
    });

    const { ipAddress, userAgent } = requestMeta(req);

    if (existing) {
      await prisma.eventCompletion.delete({ where: { id: existing.id } });
      await writeAuditLog({
        userId,
        action: "EVENT_UNCOMPLETE",
        entityType: "EventCompletion",
        entityId: existing.id,
        oldValue: existing,
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ isDone: false });
    }

    const completion = await prisma.eventCompletion.create({ data: { eventId: event.id, occurrenceDate: date } });
    await writeAuditLog({
      userId,
      action: "EVENT_COMPLETE",
      entityType: "EventCompletion",
      entityId: completion.id,
      newValue: completion,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ isDone: true });
  } catch (err) {
    return handleApiError(err);
  }
}
