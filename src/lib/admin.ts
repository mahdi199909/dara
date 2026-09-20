// Gate for the handful of /api/admin/* routes behind the single owner account (see
// src/app/(app)/admin/page.tsx) — this app has no multi-admin/role concept, just one operator.
import { requireUserId } from "./auth";
import { prisma } from "./db";
import { ApiError } from "./apiError";
import { logForbidden } from "./observability/server/authEvents";

export async function requireAdmin(): Promise<string> {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || !process.env.ADMIN_EMAIL || user.email !== process.env.ADMIN_EMAIL) {
    logForbidden({ userId, what: "admin" });
    throw new ApiError("دسترسی ندارید.", 403, "AUTH-004");
  }
  return userId;
}
