import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { rankTitleSuggestions, type TitleUsageStat } from "@/lib/titleSuggestions";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") ?? "";

    const [taskGroups, eventGroups] = await Promise.all([
      prisma.task.groupBy({ by: ["title"], where: { userId, deletedAt: null }, _count: { _all: true }, _max: { createdAt: true } }),
      prisma.event.groupBy({ by: ["title"], where: { userId, deletedAt: null }, _count: { _all: true }, _max: { createdAt: true } }),
    ]);

    // Task and Event titles share one suggestion pool — a title's count/recency is combined
    // across both, since from the user's perspective it's the same text they typed before,
    // regardless of which entity Quick Capture happened to create for it.
    const byTitle = new Map<string, TitleUsageStat>();
    for (const g of [...taskGroups, ...eventGroups]) {
      const lastUsedAt = (g._max.createdAt ?? new Date(0)).toISOString();
      const existing = byTitle.get(g.title);
      if (!existing) {
        byTitle.set(g.title, { title: g.title, count: g._count._all, lastUsedAt });
      } else {
        existing.count += g._count._all;
        if (lastUsedAt > existing.lastUsedAt) existing.lastUsedAt = lastUsedAt;
      }
    }

    const suggestions = rankTitleSuggestions([...byTitle.values()], query, new Date());
    return NextResponse.json({ suggestions });
  } catch (err) {
    return handleApiError(err);
  }
}
