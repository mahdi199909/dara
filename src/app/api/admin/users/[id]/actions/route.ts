import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { revokeAllSessions } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { logSessionsRevoked } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Account-level actions from /dashboard. Nothing here deletes data: suspension is reversible, and a
// suspended account keeps everything it had.
const schema = z.object({ action: z.enum(["disable", "enable", "signout", "verify-email"]) });

const EVENT = {
  disable: "USER_ADMIN_DISABLED",
  enable: "USER_ADMIN_ENABLED",
  signout: "USER_ADMIN_SESSIONS_REVOKED",
  "verify-email": "USER_ADMIN_VERIFIED",
} as const;

async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const adminId = await requireAdmin();
    const { action } = schema.parse(await req.json());
    const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, disabledAt: true, emailVerifiedAt: true } });
    if (!target) throw new ApiError("کاربر پیدا نشد.", 404);
    if (target.id === adminId && (action === "disable" || action === "signout")) {
      throw new ApiError("این کار روی حساب خودتان مجاز نیست.", 422, "VAL-001");
    }

    const now = new Date();
    switch (action) {
      case "disable":
        // Suspending also ends every session, so an open app or tab stops at its next request.
        await prisma.user.update({ where: { id: target.id }, data: { disabledAt: now, sessionVersion: { increment: 1 } } });
        logSessionsRevoked({ userId: target.id, by: "admin" });
        break;
      case "enable":
        await prisma.user.update({ where: { id: target.id }, data: { disabledAt: null } });
        break;
      case "signout":
        await revokeAllSessions(target.id);
        logSessionsRevoked({ userId: target.id, by: "admin" });
        break;
      case "verify-email":
        if (!target.emailVerifiedAt) await prisma.user.update({ where: { id: target.id }, data: { emailVerifiedAt: now } });
        break;
    }

    await audit.log({
      event: EVENT[action],
      entityType: "User",
      entityId: target.id,
      metadata: { targetUserId: target.id, action },
      source: "admin",
      req,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/admin/users/[id]/actions", POST);
export { loggedPOST as POST };
