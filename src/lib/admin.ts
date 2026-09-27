// Gate for the owner-only /api/admin/* routes and the /dashboard pages — this app has no roles, just
// one operator (see adminIdentity.ts for who, and why an address alone is not enough).
import { requireUserId } from "./auth";
import { prisma } from "./db";
import { ApiError } from "./apiError";
import { isAdminAccount } from "./adminIdentity";
import { logForbidden } from "./observability/server/authEvents";
import { verifyPassword } from "./password";
import { checkRateLimit, LIMITS } from "./rateLimit";

export async function requireAdmin(): Promise<string> {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, createdAt: true, disabledAt: true } });
  if (!isAdminAccount(user)) {
    logForbidden({ userId, what: "admin" });
    throw new ApiError("دسترسی ندارید.", 403, "AUTH-004");
  }
  return userId;
}

/**
 * Step-up check for the owner's most sensitive actions (saving API keys, erasing an account's data,
 * deleting an account): the owner types their password again, so a session left open on a shared
 * computer — or a stolen cookie — is not enough on its own.
 */
export async function confirmAdminPassword(adminId: string, password: unknown): Promise<void> {
  const rl = checkRateLimit(`admin-confirm:${adminId}`, LIMITS.passwordChangePerAccount);
  if (!rl.allowed) throw new ApiError("تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-002");
  const admin = await prisma.user.findUnique({ where: { id: adminId }, select: { passwordHash: true } });
  if (typeof password !== "string" || password.length === 0 || password.length > 200 || !admin || !(await verifyPassword(password, admin.passwordHash))) {
    throw new ApiError("رمز عبور خودتان را درست وارد کنید.", 403, "AUTH-001");
  }
}
