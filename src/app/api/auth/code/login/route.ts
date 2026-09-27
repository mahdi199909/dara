import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { issueSession, accountDisabledError } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { codeSchema } from "@/lib/accountLookup";
import { verifyPublicCode } from "@/lib/codeFlows";
import { logAccountDisabled, logCodeLogin } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Public: sign in with the code sent by /api/auth/code/request (purpose LOGIN_OTP). Same answer shape
// as /api/auth/login, so the web and the app treat both ways in alike.
const schema = z.object({
  identifier: z.string().min(1).max(254),
  code: codeSchema,
});

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const { ipAddress, userAgent } = requestMeta(req);
    const body = schema.parse(await req.json());
    const { id, user } = await verifyPublicCode({ purpose: "LOGIN_OTP", identifier: body.identifier, code: body.code, ip: ipAddress });
    if (user.disabledAt) {
      logAccountDisabled({ userId: user.id });
      throw accountDisabledError();
    }

    // A code that arrived by email proves the person reads that inbox.
    if (id.channel === "EMAIL" && !user.emailVerifiedAt) {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }

    const token = await issueSession(user);
    await writeAuditLog({ userId: user.id, action: "LOGIN_OTP", entityType: "User", entityId: user.id, newValue: { channel: id.channel }, ipAddress, userAgent });
    logCodeLogin({ userId: user.id, channel: id.channel, ip: ipAddress });

    return withCors(NextResponse.json({ id: user.id, name: user.name, email: user.email, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/code/login", POST);
export { loggedPOST as POST };
