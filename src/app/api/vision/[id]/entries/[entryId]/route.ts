import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { deleteVisionEntry, getOwnedVisionEntry } from "@/lib/visionServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function DELETE(req: NextRequest, props: { params: Promise<{ id: string; entryId: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedVisionEntry(userId, params.id, params.entryId);
    const result = await withTransaction(async () => deleteVisionEntry(userId, params.id, params.entryId), {
      operation: "VISION_ENTRY_DELETE",
      entityType: "VisionEntry",
      entityId: params.entryId,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "VisionEntry", entityId: params.entryId, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedDELETE = withApiLogging("DELETE", "/api/vision/[id]/entries/[entryId]", DELETE);
export { loggedDELETE as DELETE };
