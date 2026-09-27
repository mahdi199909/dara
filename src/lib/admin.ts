// Gate for the owner-only /api/admin/* routes and the /dashboard pages — this app has no roles, just
// one operator (see adminIdentity.ts for who, and why an address alone is not enough).
import { requireUserId } from "./auth";
import { prisma } from "./db";
import { ApiError } from "./apiError";
import { isAdminAccount } from "./adminIdentity";
import { logForbidden } from "./observability/server/authEvents";

export async function requireAdmin(): Promise<string> {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, createdAt: true, disabledAt: true } });
  if (!isAdminAccount(user)) {
    logForbidden({ userId, what: "admin" });
    throw new ApiError("دسترسی ندارید.", 403, "AUTH-004");
  }
  return userId;
}
