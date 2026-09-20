import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { reorderCategoriesSchema } from "@/lib/schemas/categories";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// Whole-list reorder, not a series of one-off "move to position N" calls — see
// reorderCategoriesSchema's own doc comment. Ids the caller doesn't own (or that don't exist /
// are already deleted) are silently skipped, same posture as the on-device repository's
// reorderCategories, since a stale client-side list shouldn't block reordering everything else.
async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const { orderedIds } = reorderCategoriesSchema.parse(await req.json());

    const owned = await prisma.category.findMany({ where: { userId, deletedAt: null }, select: { id: true } });
    const ownedIds = new Set(owned.map((c) => c.id));

    let sortOrder = 0;
    for (const id of orderedIds) {
      if (!ownedIds.has(id)) continue;
      await prisma.category.update({ where: { id }, data: { sortOrder } });
      sortOrder++;
    }

    await audit.log({ event: "CATEGORIES_REORDERED", entityType: "Category", metadata: { count: sortOrder }, req });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/categories/reorder", PATCH);
export { loggedPATCH as PATCH };
