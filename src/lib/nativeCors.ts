// CORS for the handful of routes the Android app's Capacitor WebView calls directly over the
// network (see src/lib/remoteAuth.ts: /api/auth/login, /api/auth/register, /api/license/status).
// Every other /api/* route is either same-origin only (web) or never reached at all on native
// (see src/lib/localDispatcher.ts), so this stays scoped to exactly those three.
//
// Allow-Origin "*" is safe here because the native flow no longer relies on cookies for these
// calls (see requireUserId's Authorization-header fallback in src/lib/auth.ts) — there's no
// credential to leak cross-origin, just a bearer token the client already holds.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function withCors<T extends Response>(res: T): T {
  for (const [key, value] of Object.entries(CORS_HEADERS)) res.headers.set(key, value);
  return res;
}
