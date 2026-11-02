import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createVisionEntrySchema } from "@/lib/schemas/vision";
import { addVisionEntry } from "@/lib/visionServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const body = createVisionEntrySchema.parse(await req.json());
    const entry = await withTransaction(async () => addVisionEntry(userId, params.id, body), { operation: "VISION_ENTRY_CREATE", entityType: "VisionEntry", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "VisionEntry", entityId: entry.id ?? params.id, newValue: entry, ipAddress, userAgent });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/vision/[id]/entries", POST);
export { loggedPOST as POST };
