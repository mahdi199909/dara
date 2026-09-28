import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
// The isomorphic core only (no node: modules) — this file runs on the Edge runtime.
import { newId } from "@/lib/observability/core/ids";
import { getLogger } from "@/lib/observability/root";
import { sessionSecret } from "@/lib/sessionSecret";
import { isAdminEmail } from "@/lib/adminIdentity";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "hesabkon_session";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password"];
// /api/auth/code/* (sign-in and password-reset codes) is for people who are not signed in yet; the
// signed-in account routes live under /api/account and stay behind the session check.
const PUBLIC_API_PREFIXES = ["/api/auth/login", "/api/auth/register", "/api/auth/code/", "/api/quotes", "/api/app/version", "/api/app/apk"];
// The owner's area. The middleware can only read the token (no database here), so it turns away anyone
// whose token names another address; the pages and routes then check the account itself (requireAdmin).
const ADMIN_PAGE_PREFIXES = ["/dashboard", "/admin"];
const ADMIN_API_PREFIX = "/api/admin";
// /api/metrics has no session (a Prometheus scraper has none): the route guards itself with its own bearer token. Exactly
// that path, not a prefix — nothing else may become public by starting with the same letters.
const PUBLIC_API_PATHS = ["/api/metrics"];
// The APK download link (rewritten to /api/app/apk): people download the app before they have an account.
// robots.txt: crawlers must reach it (not a redirect to /login) to learn this host is not for indexing.
const PUBLIC_FILE_PATHS = ["/parvaapp.apk", "/robots.txt"];

const log = getLogger("auth", "middleware");

type SessionState = { state: "valid"; email: string | null } | { state: "missing" | "invalid" };

async function sessionState(req: NextRequest): Promise<SessionState> {
  // Falls back to `Authorization: Bearer <token>` alongside the cookie — see requireUserId in
  // src/lib/auth.ts for why: the Android app's Capacitor WebView can't rely on a cross-origin
  // cookie surviving to /api/license/status, so it carries the same session JWT as a bearer
  // token instead. Without this fallback here, this middleware 401s that request before the
  // route handler (which already accepts the header) ever runs.
  const bearerToken = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token = req.cookies.get(COOKIE_NAME)?.value ?? bearerToken;
  if (!token) return { state: "missing" };
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    return { state: "valid", email: typeof payload.email === "string" ? payload.email : null };
  } catch {
    return { state: "invalid" };
  }
}

/** The 401 for an API call with no usable session — logged here because the route never runs. */
function unauthenticatedApiResponse(req: NextRequest, reason: "missing" | "invalid"): NextResponse {
  const requestId = newId("req");
  log.warn("AUTH_SESSION_INVALID", {
    errorCode: "AUTH-003",
    reason,
    requestId,
    httpMethod: req.method,
    httpPath: req.nextUrl.pathname,
    statusCode: 401,
  });
  const response = NextResponse.json({ error: "احراز هویت نشده‌اید.", code: "AUTH-003", requestId }, { status: 401 });
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/icons") ||
    pathname === "/icon.png" ||
    PUBLIC_FILE_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  // CORS preflights never carry real credentials — let them fall through to the route's own
  // OPTIONS handler (src/lib/nativeCors.ts) so it can answer with the Access-Control-* headers
  // the browser is actually asking for. The real request right behind it still goes through the
  // auth check below as normal.
  if (req.method === "OPTIONS") return NextResponse.next();

  const session = await sessionState(req);
  const authed = session.state === "valid";
  const ownerToken = session.state === "valid" && isAdminEmail(session.email);

  // Signed in as anyone but the owner: the owner's area does not exist (a plain 404). Not signed in: the
  // usual trip to /login below, which shows nothing of the dashboard.
  if (ADMIN_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) && authed && !ownerToken) {
    return new NextResponse("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if ((pathname === ADMIN_API_PREFIX || pathname.startsWith(ADMIN_API_PREFIX + "/")) && authed && !ownerToken) {
    return NextResponse.json({ error: "دسترسی ندارید.", code: "AUTH-004" }, { status: 403 });
  }

  if (pathname.startsWith("/api")) {
    const isPublicApi = PUBLIC_API_PATHS.includes(pathname) || PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
    if (isPublicApi || authed) return NextResponse.next();
    return unauthenticatedApiResponse(req, session.state === "missing" ? "missing" : "invalid");
  }

  const isPublicPage = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!authed && !isPublicPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (authed && isPublicPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
