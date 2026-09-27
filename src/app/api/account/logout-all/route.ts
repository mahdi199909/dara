import { NextRequest, NextResponse } from "next/server";
import { requireUserId, issueSession, revokeAllSessions } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { logSessionsRevoked } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// "Sign out of every other device": ends every session, then signs this one back in with a fresh token.
export async function OPTIONS() {
  return corsPreflight();
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const { ipAddress, userAgent } = requestMeta(req);
    const user = await revokeAllSessions(userId);
    const token = await issueSession(user);
    await writeAuditLog({ userId, action: "LOGOUT_ALL", entityType: "User", entityId: userId, ipAddress, userAgent });
    logSessionsRevoked({ userId, by: "self" });
    return withCors(NextResponse.json({ ok: true, token }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/account/logout-all", POST);
export { loggedPOST as POST };
