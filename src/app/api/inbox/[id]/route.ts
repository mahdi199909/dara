import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { updateInboxItemSchema } from "@/lib/schemas/inbox";
import { deleteInboxItem, getOwnedInboxItem, updateInboxItem } from "@/lib/inboxServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedInboxItem(userId, params.id);
    const body = updateInboxItemSchema.parse(await req.json());
    const item = await withTransaction(async () => updateInboxItem(userId, params.id, body), { operation: "INBOX_UPDATE", entityType: "InboxItem", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "InboxItem", entityId: params.id, oldValue: existing, newValue: item, ipAddress, userAgent });

    return NextResponse.json({ item });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Dropped without being turned into anything. */
async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedInboxItem(userId, params.id);
    const result = await withTransaction(async () => deleteInboxItem(userId, params.id), { operation: "INBOX_DELETE", entityType: "InboxItem", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "InboxItem", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/inbox/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/inbox/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
