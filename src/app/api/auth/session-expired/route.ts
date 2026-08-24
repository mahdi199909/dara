import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

/**
 * Clears an orphaned session cookie (valid JWT signature, but the referenced user no
 * longer exists) and redirects to /login in the SAME response. This must happen in a
 * Route Handler, not a Server Component, because only a response can carry both the
 * Set-Cookie and the redirect — otherwise middleware (which only checks JWT validity,
 * not DB existence) would keep bouncing the still-cookied browser back to "/".
 */
export async function GET(req: NextRequest) {
  clearSessionCookie();
  return NextResponse.redirect(new URL("/login", req.url));
}
