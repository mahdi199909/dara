import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const q = new URL(req.url).searchParams.get("q")?.trim();
    if (!q || q.length < 1) return NextResponse.json({ results: [] });

    const contains = { contains: q };

    const [tasks, activities, events, transactions, assets, projects, categories] = await Promise.all([
      prisma.task.findMany({ where: { userId, deletedAt: null, title: contains }, take: 10 }),
      prisma.activity.findMany({ where: { userId, deletedAt: null, title: contains }, take: 10 }),
      prisma.event.findMany({ where: { userId, deletedAt: null, title: contains }, take: 10 }),
      prisma.transaction.findMany({ where: { userId, deletedAt: null, description: contains }, take: 10 }),
      prisma.asset.findMany({ where: { userId, deletedAt: null, name: contains }, take: 10 }),
      prisma.project.findMany({ where: { userId, deletedAt: null, name: contains }, take: 10 }),
      prisma.category.findMany({ where: { userId, deletedAt: null, name: contains }, take: 10 }),
    ]);

    const results = [
      ...tasks.map((t) => ({ type: "Task", id: t.id, title: t.title, href: `/tasks?highlight=${t.id}` })),
      ...activities.map((a) => ({ type: "Activity", id: a.id, title: a.title, href: `/?highlight=${a.id}` })),
      ...events.map((e) => ({ type: "Event", id: e.id, title: e.title, href: `/calendar?highlight=${e.id}` })),
      ...transactions.map((t) => ({
        type: "Transaction",
        id: t.id,
        title: t.description || "تراکنش",
        href: `/finance?highlight=${t.id}`,
      })),
      ...assets.map((a) => ({ type: "Asset", id: a.id, title: a.name, href: `/assets?highlight=${a.id}` })),
      ...projects.map((p) => ({ type: "Project", id: p.id, title: p.name, href: `/projects/${p.id}` })),
      ...categories.map((c) => ({ type: "Category", id: c.id, title: c.name, href: `/settings?tab=categories` })),
    ];

    return NextResponse.json({ results });
  } catch (err) {
    return handleApiError(err);
  }
}
