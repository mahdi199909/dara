import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { computeIdentityStatements } from "@/lib/identityData";

export async function GET() {
  try {
    const userId = await requireUserId();
    const statements = await computeIdentityStatements(userId);
    return NextResponse.json({ statements });
  } catch (err) {
    return handleApiError(err);
  }
}
