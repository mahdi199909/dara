import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { linkVisionProjectSchema } from "@/lib/schemas/vision";
import { linkVisionProject } from "@/lib/visionServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

/** Puts a project the person already has under this goal. */
async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const body = linkVisionProjectSchema.parse(await req.json());
    const { before, after } = await withTransaction(async () => linkVisionProject(userId, params.id, body.projectId), {
      operation: "PROJECT_UPDATE",
      entityType: "Project",
      entityId: body.projectId,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "Project", entityId: body.projectId, oldValue: before, newValue: after, ipAddress, userAgent });

    return NextResponse.json({ project: after });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/vision/[id]/projects", POST);
export { loggedPOST as POST };
