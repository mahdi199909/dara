import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError, ApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { applyLicenseChange, effectiveLicense, LicenseChangeError, MAX_EXTENSION_DAYS, type LicenseChange } from "@/lib/license";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The owner extends, shortens or sets someone's subscription. The phone learns the new state on its next
// license refresh (every launch/resume — see refreshLicenseStatus).
const days = z.number().int().min(1).max(MAX_EXTENSION_DAYS);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend"), days }),
  z.object({ action: z.literal("shorten"), days }),
  z.object({ action: z.literal("set_until"), until: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) }),
  z.object({ action: z.literal("lifetime") }),
  z.object({ action: z.literal("free") }),
  z.object({ action: z.literal("trial"), days }),
]);

async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    await requireAdmin();
    const body = schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!user) throw new ApiError("کاربر پیدا نشد.", 404);

    const before = await prisma.license.findUnique({ where: { userId: user.id } });
    const change: LicenseChange =
      body.action === "set_until"
        ? { action: "set_until", until: /^\d{4}-\d{2}-\d{2}$/.test(body.until) ? new Date(`${body.until}T23:59:59`) : new Date(body.until) }
        : body;
    let next;
    try {
      next = applyLicenseChange(before, change);
    } catch (err) {
      if (err instanceof LicenseChangeError) throw new ApiError(err.message, 422, "VAL-001");
      throw err;
    }

    const license = await prisma.license.upsert({
      where: { userId: user.id },
      create: { userId: user.id, status: next.status, currentPeriodEnd: next.currentPeriodEnd, trialEndsAt: next.trialEndsAt },
      update: { status: next.status, currentPeriodEnd: next.currentPeriodEnd, trialEndsAt: next.trialEndsAt },
    });

    // The audit row belongs to the acting owner; the account changed is named only by id.
    await audit.log({
      event: "LICENSE_ADMIN_UPDATED",
      entityType: "License",
      entityId: license.id,
      before: before ?? undefined,
      after: license,
      metadata: { targetUserId: user.id, change: body },
      source: "admin",
      req,
    });

    const eff = effectiveLicense(license);
    return NextResponse.json({ license, status: eff.status, endsAt: eff.endsAt, daysRemaining: eff.daysRemaining });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/admin/users/[id]/license", POST);
export { loggedPOST as POST };
