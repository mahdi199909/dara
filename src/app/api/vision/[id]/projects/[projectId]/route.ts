import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { unlinkVisionProject } from "@/lib/visionServer";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

/** Takes a project out from under this goal (the project itself stays). */
async function DELETE(req: NextRequest, props: { params: Promise<{ id: string; projectId: string }> }) {
  const params = await props.params;
  try {
    const userId = await requireUserId();
    const { before, after } = await withTransaction(async () => unlinkVisionProject(userId, params.id, params.projectId), {
      operation: "PROJECT_UPDATE",
      entityType: "Project",
      entityId: params.projectId,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "Project", entityId: params.projectId, oldValue: before, newValue: after, ipAddress, userAgent });

    return NextResponse.json({ project: after });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedDELETE = withApiLogging("DELETE", "/api/vision/[id]/projects/[projectId]", DELETE);
export { loggedDELETE as DELETE };
