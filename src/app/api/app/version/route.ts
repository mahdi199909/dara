import { NextResponse } from "next/server";
import { getAppRelease } from "@/lib/appRelease";
import { corsPreflight, withCors } from "@/lib/nativeCors";

// Public on purpose (see PUBLIC_API_PREFIXES in src/middleware.ts): the Android app asks this on
// every launch and resume, including phones that only ever worked offline and hold no login, so
// nobody is left on an old build just because they never signed in. It carries no user data.
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  const release = await getAppRelease();
  return withCors(NextResponse.json(release, { headers: { "Cache-Control": "no-store" } }));
}
