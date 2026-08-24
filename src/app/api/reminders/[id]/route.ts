import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const reminder = await prisma.reminder.findFirst({ where: { id: params.id, userId } });
    if (!reminder) throw new ApiError("یادآوری پیدا نشد.", 404);

    await prisma.reminder.delete({ where: { id: params.id } });
    await writeAuditLog({ userId, action: "DELETE", entityType: "Reminder", entityId: params.id, oldValue: reminder });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
