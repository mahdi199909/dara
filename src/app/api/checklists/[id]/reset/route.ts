import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { resetChecklistItem } from "@/lib/checklistsServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

/** «از نو»: unticks the item and everything below it, so the list can be used again. */
async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const result = await withTransaction(async () => resetChecklistItem(userId, params.id), {
      operation: "CHECKLIST_RESET",
      entityType: "ChecklistItem",
      entityId: params.id,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CHECKLIST_RESET", entityType: "ChecklistItem", entityId: params.id, metadata: result, ipAddress, userAgent });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/checklists/[id]/reset", POST);
export { loggedPOST as POST };
