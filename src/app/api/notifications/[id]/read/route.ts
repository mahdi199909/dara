import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const notification = await prisma.notification.findFirst({ where: { id: params.id, userId } });
    if (!notification) throw new ApiError("اعلان پیدا نشد.", 404);

    await prisma.notification.update({ where: { id: params.id }, data: { isRead: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
