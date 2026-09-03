import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { CURRENCY_UNITS } from "@/lib/types";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  currency: z.string().max(10).optional(),
  currencyDisplayUnit: z.enum(CURRENCY_UNITS).optional(),
  calendarType: z.enum(["jalali", "gregorian"]).optional(),
  monthlyIncome: z.number().int().min(0).nullable().optional(),
  workingHoursMonth: z.number().int().min(1).max(744).nullable().optional(),
  hourlyValueOverride: z.number().int().min(0).nullable().optional(),
  dashboardCardPrefs: z.record(z.boolean()).optional(),
  dailyQuoteEnabled: z.boolean().optional(),
  wakeHour: z.number().int().min(0).max(23).optional(),
  sleepHour: z.number().int().min(0).max(23).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const [settings, user] = await Promise.all([
      prisma.settings.upsert({ where: { userId }, update: {}, create: { userId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);

    return NextResponse.json({
      settings,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      hourlyValue: computeHourlyValue(settings),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = updateSchema.parse(await req.json());
    const { name, dashboardCardPrefs, ...settingsBody } = body;

    const existing = await prisma.settings.findUnique({ where: { userId } });

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
