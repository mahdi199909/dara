import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { confirmAdminPassword, requireAdmin } from "@/lib/admin";
import { revokeAllSessions } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { deleteAccount, eraseUserData } from "@/lib/accountErasure";
import { isAdminAccount } from "@/lib/adminIdentity";
import { logSessionsRevoked } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Account-level actions from /dashboard.
//   Reversible: disable (suspend: no sign-in, every session ends, data kept) / enable, sign out
//   everywhere, verify the email by hand.
//   Irreversible: erase-data (every record of the account on the server; the account stays) and
//   delete-account (the account too). Both require the account's email typed out and the owner's
//   own password (step-up), and neither can target the owner's own account.
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["disable", "enable", "signout", "verify-email"]) }),
  z.object({ action: z.enum(["erase-data", "delete-account"]), confirmEmail: z.string().max(254), password: z.string().min(1).max(200) }),
]);

const EVENT = {
  disable: "USER_ADMIN_DISABLED",
  enable: "USER_ADMIN_ENABLED",
  signout: "USER_ADMIN_SESSIONS_REVOKED",
  "verify-email": "USER_ADMIN_VERIFIED",
  "erase-data": "USER_ADMIN_DATA_ERASED",
  "delete-account": "USER_ADMIN_DELETED",
} as const;

async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const adminId = await requireAdmin();
    const body = schema.parse(await req.json());
    const { action } = body;
    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, email: true, disabledAt: true, emailVerifiedAt: true, createdAt: true },
    });
    if (!target) throw new ApiError("کاربر پیدا نشد.", 404);
    if ((target.id === adminId || isAdminAccount(target)) && action !== "enable" && action !== "verify-email") {
      throw new ApiError("این کار روی حساب مدیر مجاز نیست.", 422, "VAL-001");
    }

    let metadata: Record<string, unknown> = { targetUserId: target.id, action };
    const now = new Date();
    switch (body.action) {
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
      case "erase-data":
      case "delete-account": {
        if (body.confirmEmail.trim().toLowerCase() !== target.email) {
          throw new ApiError("ایمیل واردشده با ایمیل این حساب یکی نیست.", 422, "VAL-001");
        }
        await confirmAdminPassword(adminId, body.password);
        const counts = body.action === "erase-data" ? await eraseUserData(target.id) : await deleteAccount(target.id);
        logSessionsRevoked({ userId: target.id, by: "admin" });
        // How many rows went, per table — never what they said. The entry belongs to the owner, so it
        // survives the account it describes.
        metadata = { ...metadata, counts };
        break;
      }
    }

    await audit.log({ event: EVENT[action], entityType: "User", entityId: target.id, metadata, source: "admin", req });
    return NextResponse.json({ ok: true, ...(metadata.counts ? { counts: metadata.counts } : {}) });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/admin/users/[id]/actions", POST);
export { loggedPOST as POST };
