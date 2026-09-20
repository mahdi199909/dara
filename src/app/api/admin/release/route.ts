import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { handleApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { RELEASE_SINGLETON_ID } from "@/lib/appRelease";
import { resolveAppRelease } from "@/lib/appVersion";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The row is an OVERRIDE on top of the release that ships in code (see resolveAppRelease): the
// newest version and its download link are announced without anyone touching this screen, and
// what is saved here only adds a minimum-version lock-out, a higher version number or a
// different link. A fresh row is therefore a no-op — it changes nothing for any installed build.
async function getOrInitRelease() {
  const existing = await prisma.appRelease.findUnique({ where: { id: RELEASE_SINGLETON_ID } });
  if (existing) return existing;
  return prisma.appRelease.create({
    data: { id: RELEASE_SINGLETON_ID, latestVersionCode: 1, minSupportedVersionCode: 1, downloadUrl: "" },
  });
}

async function GET() {
  try {
    await requireAdmin();
    const release = await getOrInitRelease();
    // `effective` is exactly what the apps are told right now.
    return NextResponse.json({ release, effective: resolveAppRelease(release) });
  } catch (err) {
    return handleApiError(err);
  }
}

const updateSchema = z.object({
  latestVersionCode: z.number().int().min(1),
  minSupportedVersionCode: z.number().int().min(1),
  // Empty means "use the permanent static link" (see APK_STATIC_URL).
  downloadUrl: z.string().trim().refine((url) => url === "" || /^https?:\/\//i.test(url), "لینک دانلود باید با http یا https شروع شود."),
});

async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const body = updateSchema.parse(await req.json());
    if (body.minSupportedVersionCode > body.latestVersionCode) {
      return NextResponse.json({ error: "حداقل نسخه مجاز نمی‌تواند بیشتر از نسخه فعلی باشد." }, { status: 422 });
    }
    const before = await getOrInitRelease();
    const release = await prisma.appRelease.update({ where: { id: RELEASE_SINGLETON_ID }, data: body });
    // What every installed app is told about updates just changed (a forced-update lock-out included).
    await audit.log({ event: "RELEASE_ADMIN_UPDATED", entityType: "AppRelease", entityId: RELEASE_SINGLETON_ID, before, after: release, source: "admin", req });
    return NextResponse.json({ release, effective: resolveAppRelease(release) });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/admin/release", GET);
const loggedPATCH = withApiLogging("PATCH", "/api/admin/release", PATCH);
export { loggedGET as GET, loggedPATCH as PATCH };
