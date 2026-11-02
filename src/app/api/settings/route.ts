import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { updateSettingsSchema } from "@/lib/schemas/settings";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET() {
  try {
    const userId = await requireUserId();
    // Deliberately not an unconditional upsert: Prisma bumps @updatedAt even for an empty update,
    // which made every page load look like an edit (see src/lib/profileSync.ts — settings sync
    // depends on updatedAt meaning "a person last changed these").
    const [existing, user] = await Promise.all([
      prisma.settings.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);
    const settings = existing ?? (await prisma.settings.upsert({ where: { userId }, update: {}, create: { userId } }));

    return NextResponse.json({
      settings,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      hourlyValue: computeHourlyValue(settings),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = updateSettingsSchema.parse(await req.json());
    const { name, dashboardCardPrefs, ...settingsBody } = body;

    const existing = await prisma.settings.findUnique({ where: { userId } });

    // The name and the settings are one save.
    const settings = await withTransaction(
      async () => {
        if (name) {
          await prisma.user.update({ where: { id: userId }, data: { name } });
        }

        const settings = await prisma.settings.upsert({
          where: { userId },
          update: {
            ...settingsBody,
            dashboardCardPrefs: dashboardCardPrefs ? JSON.stringify(dashboardCardPrefs) : undefined,
          },
          create: { userId, ...settingsBody },
        });
        return settings;
      },
      { operation: "SETTINGS_UPDATE", entityType: "Settings" }
    );

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CHANGE_SETTINGS",
      entityType: "Settings",
      entityId: settings.id,
      oldValue: existing,
      newValue: settings,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ settings, hourlyValue: computeHourlyValue(settings) });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/settings", GET);
const loggedPATCH = withApiLogging("PATCH", "/api/settings", PATCH);
export { loggedGET as GET, loggedPATCH as PATCH };
