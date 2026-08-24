import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { addManualTimeEntry } from "@/lib/activityService";

const schema = z.object({
  durationMin: z.number().int().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const activity = await prisma.activity.findFirst({ where: { id: params.id, userId, deletedAt: null } });
    if (!activity) throw new ApiError("فعالیت پیدا نشد.", 404);

    const body = schema.parse(await req.json());
    if (!body.durationMin && !(body.startAt && body.endAt)) {
      throw new ApiError("مدت زمان یا بازه شروع/پایان را وارد کنید.", 400);
    }

    const timeEntry = await addManualTimeEntry(params.id, {
      durationMin: body.durationMin,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "TimeEntry",
      entityId: timeEntry.id,
      newValue: timeEntry,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ timeEntry }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
