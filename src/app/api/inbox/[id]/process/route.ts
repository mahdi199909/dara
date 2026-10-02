import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { processInboxItemSchema } from "@/lib/schemas/inbox";
import { getOwnedInboxItem, processInboxItem } from "@/lib/inboxServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

/** Called once the item has been saved as a task, an event, a transaction… — it leaves the inbox. */
async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedInboxItem(userId, params.id);
    const body = processInboxItemSchema.parse(await req.json());
    const result = await withTransaction(async () => processInboxItem(userId, params.id, body.to), { operation: "INBOX_PROCESS", entityType: "InboxItem", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "INBOX_PROCESS", entityType: "InboxItem", entityId: params.id, oldValue: existing, metadata: { to: body.to }, ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/inbox/[id]/process", POST);
export { loggedPOST as POST };
