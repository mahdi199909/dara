import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
}

const loggedGET = withApiLogging("GET", "/api/auth/me", GET);
export { loggedGET as GET };
