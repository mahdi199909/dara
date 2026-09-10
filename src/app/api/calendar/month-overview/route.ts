import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeCalendarMonthOverview } from "@/lib/reportEngine";
import { jalaliMonthRange, toJalali } from "@/lib/jalali";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const { jy: curJy, jm: curJm } = toJalali(new Date());
    const jy = Number(searchParams.get("jy") ?? curJy);
    const jm = Number(searchParams.get("jm") ?? curJm);
    const { start, end } = jalaliMonthRange(jy, jm);

    const settings = await prisma.settings.findUnique({
      where: { userId },
      select: { calendarFeaturedType: true, calendarFeaturedId: true },
    });

    const overview = await computeCalendarMonthOverview(
      userId,
      start,
      end,
      settings?.calendarFeaturedType ?? null,
      settings?.calendarFeaturedId ?? null
    );
    return NextResponse.json({ overview, jy, jm });
  } catch (err) {
    return handleApiError(err);
  }
}
