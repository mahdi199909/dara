import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";

const SINGLETON_ID = "singleton";

// Same shape as android/app/build.gradle's default before any release has been configured —
// every installed build reads as both "latest" and "always allowed" until an admin sets real
// values here, so this feature is a no-op out of the box rather than blocking everyone on day one.
async function getOrInitRelease() {
  const existing = await prisma.appRelease.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.appRelease.create({
    data: { id: SINGLETON_ID, latestVersionCode: 1, minSupportedVersionCode: 1, downloadUrl: "" },
  });
}

export async function GET() {
  try {
    await requireAdmin();
    const release = await getOrInitRelease();
    return NextResponse.json({ release });
  } catch (err) {
    return handleApiError(err);
  }
}

const updateSchema = z.object({
  latestVersionCode: z.number().int().min(1),
  minSupportedVersionCode: z.number().int().min(1),
  downloadUrl: z.string().min(1),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = updateSchema.parse(await req.json());
    if (body.minSupportedVersionCode > body.latestVersionCode) {
      return NextResponse.json({ error: "حداقل نسخه مجاز نمی‌تواند بیشتر از نسخه فعلی باشد." }, { status: 422 });
    }
    await getOrInitRelease();
    const release = await prisma.appRelease.update({ where: { id: SINGLETON_ID }, data: body });
    return NextResponse.json({ release });
  } catch (err) {
    return handleApiError(err);
  }
}
