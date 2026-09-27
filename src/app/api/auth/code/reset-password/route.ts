import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { issueSession, accountDisabledError } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { codeSchema, passwordSchema } from "@/lib/accountLookup";
import { verifyPublicCode } from "@/lib/codeFlows";
import { logAccountDisabled, logPasswordReset } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Public: "forgot password". The code from /api/auth/code/request (purpose RESET_PASSWORD) plus a new
// password. Every existing session of the account ends (the session version moves on), and this device
// is signed in with a fresh one.
const schema = z.object({
  identifier: z.string().min(1).max(254),
  code: codeSchema,
  newPassword: passwordSchema,
});

export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const { ipAddress, userAgent } = requestMeta(req);
    const body = schema.parse(await req.json());
    const { id, user } = await verifyPublicCode({ purpose: "RESET_PASSWORD", identifier: body.identifier, code: body.code, ip: ipAddress });
    if (user.disabledAt) {
      logAccountDisabled({ userId: user.id });
      throw accountDisabledError();
    }

    const passwordHash = await hashPassword(body.newPassword);
    const now = new Date();
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: now,
        sessionVersion: { increment: 1 },
        ...(id.channel === "EMAIL" && !user.emailVerifiedAt ? { emailVerifiedAt: now } : {}),
      },
      select: { id: true, email: true, name: true, sessionVersion: true },
    });

    const token = await issueSession(updated);
    await writeAuditLog({ userId: user.id, action: "PASSWORD_RESET", entityType: "User", entityId: user.id, newValue: { channel: id.channel }, ipAddress, userAgent });
    logPasswordReset({ userId: user.id, ip: ipAddress });

    return withCors(NextResponse.json({ id: updated.id, name: updated.name, email: updated.email, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/auth/code/reset-password", POST);
export { loggedPOST as POST };
