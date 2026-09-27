import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const { ipAddress, userAgent } = requestMeta(req);
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    await prisma.user.update({ where: { id: userId }, data: { phone: null, phoneVerifiedAt: null } });
    if (before?.phone) {
      await writeAuditLog({ userId, action: "REMOVE_PHONE", entityType: "User", entityId: userId, oldValue: { phone: before.phone }, ipAddress, userAgent });
    }
    return withCors(NextResponse.json({ ok: true }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/phone/remove", POST);
export { loggedPOST as POST };
