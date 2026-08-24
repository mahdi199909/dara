import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET() {
  try {
    const userId = await requireUserId();
    const entries = await prisma.virtualAssetEntry.findMany({
      where: { userId },
      include: { activity: true, task: true, project: true, habitCheckIn: { include: { habit: true } } },
      orderBy: { date: "desc" },
    });

    const total = entries.reduce((s, e) => s + e.totalValue, 0);

    const categoryIds = Array.from(new Set(entries.filter((e) => e.categoryId).map((e) => e.categoryId as string)));
    const categories = categoryIds.length
      ? await prisma.category.findMany({ where: { id: { in: categoryIds } } })
      : [];
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const byCategory = new Map<string, { categoryId: string; name: string; icon: string | null; total: number; entries: typeof entries }>();
    const projectEntries: typeof entries = [];
    const habitEntries: typeof entries = [];

    for (const e of entries) {
      if (e.projectId) {
        projectEntries.push(e);
        continue;
      }
      if (e.habitCheckInId) {
        habitEntries.push(e);
        continue;
      }
      if (!e.categoryId) continue;
      const cat = categoryMap.get(e.categoryId);
      const key = e.categoryId;
      const bucket = byCategory.get(key) ?? {
        categoryId: key,
        name: cat?.name ?? "بدون دسته‌بندی",
        icon: cat?.icon ?? null,
        total: 0,
        entries: [],
      };
      bucket.total += e.totalValue;
      bucket.entries.push(e);
      byCategory.set(key, bucket);
    }

    return NextResponse.json({
      entries,
      total,
      byCategory: Array.from(byCategory.values()).sort((a, b) => b.total - a.total),
      projectEntries,
      habitEntries,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
