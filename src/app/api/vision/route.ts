import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createVisionItemSchema } from "@/lib/schemas/vision";
import { createVisionItem, listVision } from "@/lib/visionServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ items: await listVision(userId) });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createVisionItemSchema.parse(await req.json());
    const item = await withTransaction(async () => createVisionItem(userId, body), { operation: "VISION_CREATE", entityType: "VisionItem" });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "VisionItem", entityId: item.id, newValue: item, ipAddress, userAgent });

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/vision", GET);
const loggedPOST = withApiLogging("POST", "/api/vision", POST);
export { loggedGET as GET, loggedPOST as POST };
