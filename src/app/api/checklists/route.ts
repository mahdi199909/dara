import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createChecklistItemSchema, createChecklistItemsSchema } from "@/lib/schemas/checklists";
import { createChecklistItem, createChecklistItems, listChecklistItems } from "@/lib/checklistsServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

/** Every list with all its items, flat (id + parentId) — the screen builds the tree. */
async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ items: await listChecklistItems(userId) });
  } catch (err) {
    return handleApiError(err);
  }
}

/** One item ({ parentId?, title }) — or several under one parent ({ parentId, titles }). */
async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const raw = await req.json();
    const { ipAddress, userAgent } = requestMeta(req);

    if (raw && typeof raw === "object" && "titles" in raw) {
      const body = createChecklistItemsSchema.parse(raw);
      const items = await withTransaction(async () => createChecklistItems(userId, body), { operation: "CHECKLIST_CREATE", entityType: "ChecklistItem" });
      for (const item of items) await writeAuditLog({ userId, action: "CREATE", entityType: "ChecklistItem", entityId: item.id, newValue: item, ipAddress, userAgent });
      return NextResponse.json({ items }, { status: 201 });
    }

    const body = createChecklistItemSchema.parse(raw);
    const item = await withTransaction(async () => createChecklistItem(userId, body), { operation: "CHECKLIST_CREATE", entityType: "ChecklistItem" });
    await writeAuditLog({ userId, action: "CREATE", entityType: "ChecklistItem", entityId: item.id, newValue: item, ipAddress, userAgent });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/checklists", GET);
const loggedPOST = withApiLogging("POST", "/api/checklists", POST);
export { loggedGET as GET, loggedPOST as POST };
