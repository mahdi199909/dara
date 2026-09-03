import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeDailyMomentCandidates } from "@/lib/insightsData";

export async function GET() {
  try {
    const userId = await requireUserId();
    const candidates = await computeDailyMomentCandidates(userId);
    return NextResponse.json({ candidates });
  } catch (err) {
    return handleApiError(err);
  }
}
