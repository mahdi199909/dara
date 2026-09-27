// Who the owner is. Edge-safe (the middleware imports it): no Prisma, no node: modules.
//
// The owner chose one account: m.gh.hut@gmail.com. In production that is the only admin, whatever the
// environment says — an ADMIN_EMAIL left over in a .env can no longer hand the dashboard to someone else.
// Outside production ADMIN_EMAIL (comma-separated) may name others, so local testing does not need the
// owner's address.
export const OWNER_ADMIN_EMAIL = "m.gh.hut@gmail.com";

/**
 * An account with the owner's address that was created after this date must have verified the address
 * before it gets the dashboard — otherwise whoever registered that address first would be the owner.
 * Older accounts predate the verification feature and are the owner's own.
 */
export const ADMIN_TRUST_CUTOFF = new Date("2026-09-28T00:00:00Z");

export function adminEmails(): string[] {
  if (process.env.NODE_ENV === "production") return [OWNER_ADMIN_EMAIL];
  const configured = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : [OWNER_ADMIN_EMAIL];
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return Boolean(email) && adminEmails().includes(String(email).trim().toLowerCase());
}

/** The full check, given the account row (requireAdmin and the dashboard layout run it). */
export function isAdminAccount(user: { email: string; emailVerifiedAt: Date | null; createdAt: Date; disabledAt: Date | null } | null): boolean {
  if (!user || user.disabledAt || !isAdminEmail(user.email)) return false;
  // Development and the tests register throwaway admins with no mail server to verify them.
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(user.emailVerifiedAt) || user.createdAt < ADMIN_TRUST_CUTOFF;
}
