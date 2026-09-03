import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { recordDailyCapitalSnapshot } from "@/lib/reportEngine";

export async function GET() {
  try {
    const userId = await requireUserId();
    // Sequential, not Promise.all: the snapshot upsert below must land before this query reads
    // the history, or today's data point would be missing from the sparkline until the next call.
    const capital = await recordDailyCapitalSnapshot(userId);
    const snapshots = await prisma.capitalSnapshot.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 30 });
    return NextResponse.json({ capital, snapshots: snapshots.reverse() });
  } catch (err) {
    return handleApiError(err);
  }
}
