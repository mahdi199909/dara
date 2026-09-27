// The owner's view of every account, for /dashboard. Server only; every caller has passed requireAdmin().
//
// Filtering and sorting happen in memory on purpose: "is this trial still running" depends on today, not
// on a stored column (see effectiveLicense), and the account count is small (hundreds to a few thousand).
import { prisma } from "./db";
import { effectiveLicense, type LicenseStatus } from "./license";
import { isAdminAccount } from "./adminIdentity";

export type UserFilter = "all" | "trial" | "subscribed" | "lifetime" | "free" | "expiring" | "disabled" | "unverified";
export type UserSort = "created" | "lastSeen" | "expiry" | "name";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  disabled: boolean;
  isAdmin: boolean;
  license: {
    stored: string | null;
    status: LicenseStatus;
    endsAt: string | null;
    daysRemaining: number | null;
  };
}

const EXPIRING_DAYS = 7;

export async function listUsers(input: { q?: string; filter?: UserFilter; sort?: UserSort; page?: number; pageSize?: number }, now = new Date()) {
  const q = input.q?.trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: q
      ? { OR: [{ email: { contains: q } }, { name: { contains: input.q!.trim() } }, { phone: { contains: q.replace(/\D/g, "") || q } }] }
      : undefined,
    select: {
      id: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      phone: true,
      phoneVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      lastLoginAt: true,
      disabledAt: true,
      license: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true } },
    },
  });

  let rows: AdminUserRow[] = users.map((u) => {
    const eff = effectiveLicense(u.license, now);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: Boolean(u.emailVerifiedAt),
      phone: u.phone,
      phoneVerified: Boolean(u.phone && u.phoneVerifiedAt),
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      disabled: Boolean(u.disabledAt),
      isAdmin: isAdminAccount({ email: u.email, emailVerifiedAt: u.emailVerifiedAt, createdAt: u.createdAt, disabledAt: u.disabledAt }),
      license: { stored: u.license?.status ?? null, status: eff.status, endsAt: eff.endsAt?.toISOString() ?? null, daysRemaining: eff.daysRemaining },
    };
  });

  const filter = input.filter ?? "all";
  rows = rows.filter((r) => {
    switch (filter) {
      case "trial":
        return r.license.status === "TRIAL";
      case "subscribed":
        return r.license.status === "SUBSCRIBED";
      case "lifetime":
        return r.license.status === "LIFETIME";
      case "free":
        return r.license.status === "FREE";
      case "expiring":
        return (r.license.status === "TRIAL" || r.license.status === "SUBSCRIBED") && (r.license.daysRemaining ?? Infinity) <= EXPIRING_DAYS;
      case "disabled":
        return r.disabled;
      case "unverified":
        return !r.emailVerified;
      default:
        return true;
    }
  });

  const sort = input.sort ?? "created";
  const time = (s: string | null) => (s ? Date.parse(s) : 0);
  rows.sort((a, b) => {
    switch (sort) {
      case "lastSeen":
        return time(b.lastSeenAt) - time(a.lastSeenAt);
      case "expiry": {
        // Soonest end first; lifetime and free (nothing ends) last.
        const ea = a.license.endsAt ? time(a.license.endsAt) : Infinity;
        const eb = b.license.endsAt ? time(b.license.endsAt) : Infinity;
        return ea - eb;
      }
      case "name":
        return a.name.localeCompare(b.name, "fa");
      default:
        return time(b.createdAt) - time(a.createdAt);
    }
  });

  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 200);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(input.page ?? 1, 1), pages);
  return { users: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pages, pageSize };
}

/** One account in depth: its row, how much it keeps, and what the owner changed on it. */
export async function userDetail(id: string, now = new Date()) {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      phone: true,
      phoneVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      lastLoginAt: true,
      passwordChangedAt: true,
      disabledAt: true,
      sessionVersion: true,
      license: { select: { id: true, status: true, trialEndsAt: true, currentPeriodEnd: true, createdAt: true, updatedAt: true } },
      _count: { select: { tasks: true, transactions: true, events: true, habits: true, projects: true, dailyNotes: true, accounts: true, installmentPlans: true } },
    },
  });
  if (!u) return null;
  const eff = effectiveLicense(u.license, now);
  const history = await prisma.auditLog.findMany({
    where: { source: "admin", OR: [{ entityId: u.id }, ...(u.license ? [{ entityId: u.license.id }] : []), { metadata: { contains: u.id } }] },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, event: true, action: true, createdAt: true, oldValue: true, newValue: true },
  });
  const recentLogins = await prisma.auditLog.findMany({
    where: { userId: u.id, action: { in: ["LOGIN", "LOGIN_OTP", "PASSWORD_RESET", "PASSWORD_CHANGE", "LOGOUT_ALL"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, action: true, createdAt: true, ipAddress: true, userAgent: true },
  });
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerifiedAt: u.emailVerifiedAt,
      phone: u.phone,
      phoneVerifiedAt: u.phoneVerifiedAt,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      lastLoginAt: u.lastLoginAt,
      passwordChangedAt: u.passwordChangedAt,
      disabledAt: u.disabledAt,
      sessionVersion: u.sessionVersion,
      isAdmin: isAdminAccount(u),
    },
    license: { row: u.license, status: eff.status, endsAt: eff.endsAt, daysRemaining: eff.daysRemaining },
    counts: u._count,
    history,
    recentLogins,
  };
}

/** The numbers at the top of the dashboard. */
export async function adminStats(now = new Date()) {
  const day = 86_400_000;
  const [users, codes24h] = await Promise.all([
    prisma.user.findMany({
      select: { createdAt: true, lastSeenAt: true, emailVerifiedAt: true, phoneVerifiedAt: true, disabledAt: true, license: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true } } },
    }),
    prisma.verificationCode.count({ where: { createdAt: { gt: new Date(now.getTime() - day) } } }),
  ]);
  const byStatus: Record<LicenseStatus, number> = { TRIAL: 0, SUBSCRIBED: 0, LIFETIME: 0, FREE: 0 };
  let expiring = 0;
  for (const u of users) {
    const eff = effectiveLicense(u.license, now);
    byStatus[eff.status]++;
    if ((eff.status === "TRIAL" || eff.status === "SUBSCRIBED") && (eff.daysRemaining ?? Infinity) <= EXPIRING_DAYS) expiring++;
  }
  const since = (ms: number) => new Date(now.getTime() - ms);
  return {
    totalUsers: users.length,
    newUsers7d: users.filter((u) => u.createdAt > since(7 * day)).length,
    newUsers30d: users.filter((u) => u.createdAt > since(30 * day)).length,
    active24h: users.filter((u) => u.lastSeenAt && u.lastSeenAt > since(day)).length,
    active7d: users.filter((u) => u.lastSeenAt && u.lastSeenAt > since(7 * day)).length,
    emailVerified: users.filter((u) => u.emailVerifiedAt).length,
    phoneVerified: users.filter((u) => u.phoneVerifiedAt).length,
    disabled: users.filter((u) => u.disabledAt).length,
    byStatus,
    expiringIn7d: expiring,
    codesSent24h: codes24h,
    // Sign-ups per day for the last 30 days, oldest first (the server's local calendar day).
    signupsByDay: Array.from({ length: 30 }, (_, i) => {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (29 - i));
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { day: localDayKey(start), count: users.filter((u) => u.createdAt >= start && u.createdAt < end).length };
    }),
  };
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
