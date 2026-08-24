import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(8).nullable().optional(),
  color: z.string().max(20).optional(),
  categoryId: z.string().nullable().optional(),
  virtualAssetValuePerCheckIn: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  // isTrial: false promotes a trial habit to a permanent one (see the Habit model doc).
  isTrial: z.boolean().optional(),
  cue: z.string().max(300).nullable().optional(),
  celebration: z.string().max(300).nullable().optional(),
});

async function getOwned(userId: string, id: string) {
  const habit = await prisma.habit.findFirst({ where: { id, userId, deletedAt: null } });
  if (!habit) throw new ApiError("عادت پیدا نشد.", 404);
  return habit;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    const promoted = existing.isTrial && body.isTrial === false;

    const habit = await prisma.habit.update({
      where: { id: params.id },
      data: {
        ...body,
        // A promoted trial's createdAt still points at when the 3-day trial started. Left
        // as-is, computeAdherenceSeries (lib/habitStreak.ts) would treat the habit as
        // "eligible" retroactively for those trial days — which, if any were skipped
        // (likely, since testing imperfectly is the whole point of a trial), can instantly
        // break an already-established streak the moment the user clicks "keep". Resetting
        // createdAt to now makes the habit count only from the promotion moment forward,
        // matching the "a trial can never affect the established streak" guarantee.
        ...(promoted ? { createdAt: new Date() } : {}),
      },
      include: { category: true },
    });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: promoted ? "HABIT_PROMOTE_TRIAL" : "UPDATE",
      entityType: "Habit",
      entityId: habit.id,
      oldValue: existing,
      newValue: habit,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ habit });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.habit.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Habit",
      entityId: params.id,
      oldValue: existing,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
