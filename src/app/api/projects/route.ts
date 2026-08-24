import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { createProjectCategory } from "@/lib/projectSync";
import { PROJECT_STATUSES } from "@/lib/types";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  color: z.string().max(20).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const projects = await prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { tasks: { where: { deletedAt: null } } } },
      },
    });
    return NextResponse.json({ projects });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createSchema.parse(await req.json());
    const project = await prisma.project.create({ data: { ...body, userId } });

    // Every project gets a matching category (defaults to "دارایی") so project work
    // categorizes naturally in Quick Capture — see lib/projectSync.ts.
    await createProjectCategory(project);

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "Project",
      entityId: project.id,
      newValue: project,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
