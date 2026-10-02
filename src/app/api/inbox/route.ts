import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createInboxItemSchema } from "@/lib/schemas/inbox";
import { createInboxItem, listInboxItems } from "@/lib/inboxServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ items: await listInboxItems(userId) });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createInboxItemSchema.parse(await req.json());
    const item = await withTransaction(async () => createInboxItem(userId, body), { operation: "INBOX_CREATE", entityType: "InboxItem" });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "InboxItem", entityId: item.id, newValue: item, ipAddress, userAgent });

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/inbox", GET);
const loggedPOST = withApiLogging("POST", "/api/inbox", POST);
export { loggedGET as GET, loggedPOST as POST };
