import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import type { NextRequest } from "next/server";

// First login on any device (web or Android) starts the user's one-time free trial — see the
// original product ask: "ابتدای عضویت یک ماه امکان ثبت رایگان داشته باشد."
const TRIAL_DAYS = 30;

export type LicenseStatus = "TRIAL" | "FREE" | "SUBSCRIBED" | "LIFETIME";

/**
 * Returns this user's licensing status, creating their License row (and starting the free
 * trial) the first time it's ever requested. The Android app calls this once right after its
 * first-run login and caches the result locally — every other app screen works entirely
 * offline, so this is deliberately the ONLY endpoint the on-device app calls outside of that
 * one-time check.
 *
 * `status` here is the *effective* status (a lapsed trial reads back as FREE) even though the
 * stored License.status may still literally say "TRIAL" until the user's next login re-derives
 * it — there's no background job flipping that column, by design.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();

    let license = await prisma.license.findUnique({ where: { userId } });
    if (!license) {
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
      license = await prisma.license.create({ data: { userId, status: "TRIAL", trialEndsAt } });

      const { ipAddress, userAgent } = requestMeta(req);
      await writeAuditLog({
        userId,
        action: "LICENSE_TRIAL_START",
        entityType: "License",
        entityId: license.id,
        newValue: license,
        ipAddress,
        userAgent,
      });
    }

    const now = new Date();
    let status: LicenseStatus;
    let trialDaysRemaining: number | null = null;

    if (license.status === "LIFETIME") {
      status = "LIFETIME";
    } else if (license.status === "SUBSCRIBED" && license.currentPeriodEnd && license.currentPeriodEnd > now) {
      status = "SUBSCRIBED";
    } else if (license.trialEndsAt && license.trialEndsAt > now) {
      status = "TRIAL";
      trialDaysRemaining = Math.max(0, Math.ceil((license.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
    } else {
      status = "FREE";
    }

    return NextResponse.json({
      status,
      trialDaysRemaining,
      trialEndsAt: license.trialEndsAt,
      currentPeriodEnd: license.currentPeriodEnd,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
