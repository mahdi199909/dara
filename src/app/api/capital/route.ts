import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { recordDailyCapitalSnapshot } from "@/lib/reportEngine";
import { capitalRangeSchema } from "@/lib/schemas/capital";

const RANGE_TAKE: Record<string, number | undefined> = { "30": 30, "90": 90, all: undefined };

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const range = capitalRangeSchema.parse(new URL(req.url).searchParams.get("range") ?? undefined);
    // Sequential, not Promise.all: the snapshot upsert below must land before this query reads
    // the history, or today's data point would be missing from the sparkline until the next call.
    const capital = await recordDailyCapitalSnapshot(userId);
    const snapshots = await prisma.capitalSnapshot.findMany({ where: { userId }, orderBy: { date: "desc" }, take: RANGE_TAKE[range] });
    return NextResponse.json({ capital, snapshots: snapshots.reverse() });
  } catch (err) {
    return handleApiError(err);
  }
}
