import { NextResponse } from "next/server";
import { getCurrentUser, clearSessionCookie } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { logLogout } from "@/lib/observability/server/authEvents";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await writeAuditLog({ userId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id });
  }
  clearSessionCookie();
  logLogout({ userId: user?.id });
  return NextResponse.json({ ok: true });
}

const loggedPOST = withApiLogging("POST", "/api/auth/logout", POST);
export { loggedPOST as POST };
