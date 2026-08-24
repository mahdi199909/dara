import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeCategoryCalendar } from "@/lib/reportEngine";
import { jalaliMonthRange, toJalali } from "@/lib/jalali";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const { jy: curJy, jm: curJm } = toJalali(new Date());
    const jy = Number(searchParams.get("jy") ?? curJy);
    const jm = Number(searchParams.get("jm") ?? curJm);
    const { start, end } = jalaliMonthRange(jy, jm);

    const categories = await computeCategoryCalendar(userId, start, end);
    return NextResponse.json({ categories, jy, jm });
  } catch (err) {
    return handleApiError(err);
  }
}
