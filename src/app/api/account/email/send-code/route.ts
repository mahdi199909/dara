import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { requestContactCode } from "@/lib/codeFlows";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user) throw new ApiError("حساب پیدا نشد.", 404);
    if (user.emailVerifiedAt) return withCors(NextResponse.json({ ok: true, alreadyVerified: true }));
    const answer = await requestContactCode({ userId, channel: "EMAIL", target: user.email, ip: requestMeta(req).ipAddress });
    return withCors(NextResponse.json(answer));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/email/send-code", POST);
export { loggedPOST as POST };
