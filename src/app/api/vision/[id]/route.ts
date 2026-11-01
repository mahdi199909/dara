import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { updateVisionItemSchema } from "@/lib/schemas/vision";
import { deleteVisionItem, getOwnedVisionItem, getVisionDetail, updateVisionItem } from "@/lib/visionServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    return NextResponse.json(await getVisionDetail(userId, params.id));
  } catch (err) {
    return handleApiError(err);
  }
}

async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedVisionItem(userId, params.id);
    const body = updateVisionItemSchema.parse(await req.json());
    const item = await withTransaction(async () => updateVisionItem(userId, params.id, body), { operation: "VISION_UPDATE", entityType: "VisionItem", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "VisionItem", entityId: params.id, oldValue: existing, newValue: item, ipAddress, userAgent });

    return NextResponse.json({ item });
  } catch (err) {
    return handleApiError(err);
  }
}

async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const existing = await getOwnedVisionItem(userId, params.id);
    const result = await withTransaction(async () => deleteVisionItem(userId, params.id), { operation: "VISION_DELETE", entityType: "VisionItem", entityId: params.id });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "VisionItem", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/vision/[id]", GET);
const loggedPATCH = withApiLogging("PATCH", "/api/vision/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/vision/[id]", DELETE);
export { loggedGET as GET, loggedPATCH as PATCH, loggedDELETE as DELETE };
