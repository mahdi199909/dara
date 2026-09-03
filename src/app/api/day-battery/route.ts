import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeDayBattery } from "@/lib/reportEngine";

export async function GET() {
  try {
    const userId = await requireUserId();
    const battery = await computeDayBattery(userId);
    return NextResponse.json({ battery });
  } catch (err) {
    return handleApiError(err);
  }
}
