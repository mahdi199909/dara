import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeUpgradeEffect } from "@/lib/reportEngine";

// 15 seconds: long enough to cover the round trip from "user just saved a record" to this
// endpoint's next SWR poll, short enough that reloading the page an hour later never resurfaces
// a stale toast for an entry the user has already seen and moved on from.
const FRESHNESS_WINDOW_MS = 15_000;

export async function GET() {
  try {
    const userId = await requireUserId();
    const latest = await prisma.virtualAssetEntry.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });

    if (!latest || Date.now() - latest.createdAt.getTime() > FRESHNESS_WINDOW_MS) {
      return NextResponse.json({ effect: null });
    }

    const effect = await computeUpgradeEffect(userId, latest.id);
    return NextResponse.json({ effect });
  } catch (err) {
    return handleApiError(err);
  }
}
