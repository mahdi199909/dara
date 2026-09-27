import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { codeSchema } from "@/lib/accountLookup";
import { verifyContactCode } from "@/lib/codeFlows";
import { logContactVerified } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

const schema = z.object({ code: codeSchema });

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const { ipAddress, userAgent } = requestMeta(req);
    const body = schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user) throw new ApiError("حساب پیدا نشد.", 404);
    if (!user.emailVerifiedAt) {
      await verifyContactCode({ userId, channel: "EMAIL", target: user.email, code: body.code, ip: ipAddress });
      await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await writeAuditLog({ userId, action: "VERIFY_EMAIL", entityType: "User", entityId: userId, ipAddress, userAgent });
      logContactVerified({ userId, channel: "EMAIL" });
    }
    return withCors(NextResponse.json({ ok: true, emailVerified: true }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/email/verify", POST);
export { loggedPOST as POST };
