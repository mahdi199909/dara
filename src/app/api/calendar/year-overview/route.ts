import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeCalendarYearOverview } from "@/lib/reportEngine";
import { toJalali } from "@/lib/jalali";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const { jy: curJy } = toJalali(new Date());
    const jy = Number(searchParams.get("jy") ?? curJy);

    const settings = await prisma.settings.findUnique({
      where: { userId },
      select: { calendarFeaturedType: true, calendarFeaturedId: true },
    });

    const overview = await computeCalendarYearOverview(userId, jy, settings?.calendarFeaturedType ?? null, settings?.calendarFeaturedId ?? null);
    return NextResponse.json({ overview, jy });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/calendar/year-overview", GET);
export { loggedGET as GET };
