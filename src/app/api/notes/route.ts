import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createNoteSchema, noteQuerySchema } from "@/lib/schemas/notes";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const params = new URL(req.url).searchParams;
    const query = noteQuerySchema.parse({
      day: params.get("day") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });

    // Days are "YYYY-MM-DD" text, which sorts and compares in calendar order.
    const day = query.day ? query.day : query.from || query.to ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } : undefined;
    const notes = await prisma.dailyNote.findMany({
      where: { userId, deletedAt: null, ...(day ? { day } : {}) },
      orderBy: [{ day: "asc" }, { createdAt: "asc" }],
      select: { id: true, day: true, content: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ notes });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createNoteSchema.parse(await req.json());

    const note = await withTransaction(async () => prisma.dailyNote.create({ data: { userId, day: body.day, content: body.content } }), {
      operation: "NOTE_CREATE",
      entityType: "DailyNote",
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({ userId, action: "CREATE", entityType: "DailyNote", entityId: note.id, newValue: note, ipAddress, userAgent });

    return NextResponse.json({ note: { id: note.id, day: note.day, content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt } }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/notes", GET);
const loggedPOST = withApiLogging("POST", "/api/notes", POST);
export { loggedGET as GET, loggedPOST as POST };
