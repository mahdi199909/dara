// What a License row means right now, and how the owner changes it. Pure functions (no Prisma), shared
// by /api/license/status, the admin dashboard and their tests.

export type LicenseStatus = "TRIAL" | "FREE" | "SUBSCRIBED" | "LIFETIME";

export interface LicenseRow {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface EffectiveLicense {
  status: LicenseStatus;
  /** When the current paid period or trial runs out; null for LIFETIME and FREE. */
  endsAt: Date | null;
  /** Whole days left (rounded up), null when nothing runs out. */
  daysRemaining: number | null;
}

const DAY_MS = 86_400_000;

/** A lapsed trial or subscription reads back as FREE even though the stored row still says otherwise. */
export function effectiveLicense(license: LicenseRow | null, now = new Date()): EffectiveLicense {
  if (!license) return { status: "FREE", endsAt: null, daysRemaining: null };
  if (license.status === "LIFETIME") return { status: "LIFETIME", endsAt: null, daysRemaining: null };
  if (license.status === "SUBSCRIBED" && license.currentPeriodEnd && license.currentPeriodEnd > now) {
    return { status: "SUBSCRIBED", endsAt: license.currentPeriodEnd, daysRemaining: daysBetween(now, license.currentPeriodEnd) };
  }
  if (license.trialEndsAt && license.trialEndsAt > now) {
    return { status: "TRIAL", endsAt: license.trialEndsAt, daysRemaining: daysBetween(now, license.trialEndsAt) };
  }
  return { status: "FREE", endsAt: null, daysRemaining: null };
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
}

export const MAX_EXTENSION_DAYS = 3650;

export type LicenseChange =
  /** Add days to whatever is running now (an active subscription or trial), or start from today. */
  | { action: "extend"; days: number }
  /** Take days off an active subscription (a mistaken extension); never below today. */
  | { action: "shorten"; days: number }
  | { action: "set_until"; until: Date }
  | { action: "lifetime" }
  | { action: "free" }
  | { action: "trial"; days: number };

export class LicenseChangeError extends Error {}

/** The row after the owner's change. Extending a running trial turns it into a subscription from the trial's end. */
export function applyLicenseChange(current: LicenseRow | null, change: LicenseChange, now = new Date()): LicenseRow {
  const effective = effectiveLicense(current, now);
  switch (change.action) {
    case "extend": {
      assertDays(change.days);
      if (effective.status === "LIFETIME") throw new LicenseChangeError("این کاربر اشتراک مادام‌العمر دارد؛ تمدید معنا ندارد.");
      const base = effective.endsAt && effective.endsAt > now ? effective.endsAt : now;
      return { status: "SUBSCRIBED", currentPeriodEnd: new Date(base.getTime() + change.days * DAY_MS), trialEndsAt: current?.trialEndsAt ?? null };
    }
    case "shorten": {
      assertDays(change.days);
      if (effective.status !== "SUBSCRIBED" || !effective.endsAt) throw new LicenseChangeError("فقط اشتراک فعال را می‌شود کوتاه کرد.");
      const end = new Date(Math.max(now.getTime(), effective.endsAt.getTime() - change.days * DAY_MS));
      return { status: "SUBSCRIBED", currentPeriodEnd: end, trialEndsAt: current?.trialEndsAt ?? null };
    }
    case "set_until": {
      if (!(change.until instanceof Date) || Number.isNaN(change.until.getTime())) throw new LicenseChangeError("تاریخ نامعتبر است.");
      if (change.until <= now) throw new LicenseChangeError("تاریخ پایان باید بعد از امروز باشد.");
      if (change.until.getTime() - now.getTime() > MAX_EXTENSION_DAYS * DAY_MS) throw new LicenseChangeError("این تاریخ بیش از حد دور است.");
      return { status: "SUBSCRIBED", currentPeriodEnd: change.until, trialEndsAt: current?.trialEndsAt ?? null };
    }
    case "lifetime":
      return { status: "LIFETIME", currentPeriodEnd: null, trialEndsAt: current?.trialEndsAt ?? null };
    case "free":
      // The trial is over too — otherwise effectiveLicense would still read an unexpired trial as TRIAL.
      return { status: "FREE", currentPeriodEnd: null, trialEndsAt: null };
    case "trial":
      assertDays(change.days);
      return { status: "TRIAL", currentPeriodEnd: null, trialEndsAt: new Date(now.getTime() + change.days * DAY_MS) };
  }
}

function assertDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXTENSION_DAYS) throw new LicenseChangeError(`تعداد روز باید بین ۱ و ${MAX_EXTENSION_DAYS} باشد.`);
}
