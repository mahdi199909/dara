import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";

const schema = z.object({ offsetMinutes: z.number().int().min(0) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const event = await prisma.event.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!event) throw new ApiError("رویداد پیدا نشد.", 404);

    const { offsetMinutes } = schema.parse(await req.json());
    const reminder = await prisma.reminder.create({
      data: {
        userId,
        targetType: "EVENT",
        eventId: event.id,
        title: `یادآوری: ${event.title}`,
        offsetMinutes,
        remindAt: new Date(event.startAt.getTime() - offsetMinutes * 60000),
      },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Reminder",
      entityId: reminder.id,
      newValue: reminder,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ reminder }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
