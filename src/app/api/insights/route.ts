import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeDailyInsight } from "@/lib/insightsData";

export async function GET() {
  try {
    const userId = await requireUserId();
    const insight = await computeDailyInsight(userId);
    return NextResponse.json({ insight });
  } catch (err) {
    return handleApiError(err);
  }
}
