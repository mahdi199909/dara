import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function POST(_req: Request, { params }: { params: { id: string } }) {
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

const loggedPOST = withApiLogging("POST", "/api/notifications/[id]/read", POST);
export { loggedPOST as POST };
