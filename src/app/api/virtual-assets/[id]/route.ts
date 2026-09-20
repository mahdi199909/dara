import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { deleteVirtualAssetEntriesWithTombstones } from "@/lib/tombstones";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// No edit here, deliberately: a VirtualAssetEntry's value is derived from a real
// activity/task/project/habit check-in (see prisma/schema.prisma's own comment on this model) —
// letting it be typed over directly would let a number appear on screen with no real row behind
// it, which the app's own no-fabricated-numbers rule forbids. Delete only removes this specific
// credit; if the same source is touched again later, its sync function (recalcActivityDuration,
// syncProjectCompletionAsset, syncHabitCheckInVirtualAsset, ...) will just recreate it — the same
// "hard delete, doesn't stick against a live source" trade-off already accepted for
// EventCompletion/Reminder elsewhere in this schema.
async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await prisma.virtualAssetEntry.findFirst({ where: { id: params.id, userId } });
    if (!existing) throw new ApiError("دارایی مجازی پیدا نشد.", 404);

    await deleteVirtualAssetEntriesWithTombstones({ id: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "VirtualAssetEntry",
      entityId: params.id,
      oldValue: existing,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedDELETE = withApiLogging("DELETE", "/api/virtual-assets/[id]", DELETE);
export { loggedDELETE as DELETE };
