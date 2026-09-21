import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { updateNoteSchema } from "@/lib/schemas/notes";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function getOwned(userId: string, id: string) {
  const note = await prisma.dailyNote.findFirst({ where: { id, userId, deletedAt: null } });
  if (!note) throw new ApiError("نوت پیدا نشد.", 404);
  return note;
}

async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateNoteSchema.parse(await req.json());

    const note = await withTransaction(async () => prisma.dailyNote.update({ where: { id: params.id }, data: { day: body.day, content: body.content } }), {
      operation: "NOTE_UPDATE",
      entityType: "DailyNote",
      entityId: params.id,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "UPDATE", entityType: "DailyNote", entityId: note.id, oldValue: existing, newValue: note, ipAddress, userAgent });

    return NextResponse.json({ note: { id: note.id, day: note.day, content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt } });
  } catch (err) {
    return handleApiError(err);
  }
}

async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await withTransaction(async () => prisma.dailyNote.update({ where: { id: params.id }, data: { deletedAt: new Date() } }), {
      operation: "NOTE_DELETE",
      entityType: "DailyNote",
      entityId: params.id,
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "DELETE", entityType: "DailyNote", entityId: params.id, oldValue: existing, ipAddress, userAgent });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPATCH = withApiLogging("PATCH", "/api/notes/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/notes/[id]", DELETE);
export { loggedPATCH as PATCH, loggedDELETE as DELETE };
