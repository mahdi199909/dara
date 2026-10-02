import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { updateChecklistItemSchema } from "@/lib/schemas/checklists";
import { deleteChecklistItem, getOwnedChecklistItem, updateChecklistItem } from "@/lib/checklistsServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedChecklistItem(userId, params.id);
    const body = updateChecklistItemSchema.parse(await req.json());

    const item = await withTransaction(async () => updateChecklistItem(userId, params.id, body), {
      operation: "CHECKLIST_UPDATE",
      entityType: "ChecklistItem",
      entityId: params.id,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "ChecklistItem", entityId: item.id, oldValue: existing, newValue: item, ipAddress, userAgent });

    return NextResponse.json({ item });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Deletes the item together with everything below it. */
async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedChecklistItem(userId, params.id);

    const ids = await withTransaction(async () => deleteChecklistItem(userId, params.id), {
      operation: "CHECKLIST_DELETE",
      entityType: "ChecklistItem",
      entityId: params.id,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "ChecklistItem", entityId: params.id, oldValue: existing, metadata: { deletedCount: ids.length }, ipAddress, userAgent });

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/checklists/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/checklists/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
