import { NextResponse } from "next/server";
import { getCurrentUser, clearSessionCookie } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    await writeAuditLog({ userId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id });
  }
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
