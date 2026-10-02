// CORS for the public routes the static site on parvaapp.ir calls (today: /api/checkup and
// /api/checkup/event). Kept apart from nativeCors.ts on purpose: that one answers "*" for the six routes
// the Android app calls with a bearer token; these answer only the site's own origins.
//
// CORS alone stops nothing a script outside a browser does — curl sends whatever Origin it likes, or none.
// What it does stop is another website using its visitors' browsers to write here, and the routes back it
// up by refusing (403) any request whose Origin is not on the list, preflight or not: a text/plain POST
// never triggers a preflight, so the header check is the real gate, not the browser.
//
// The list comes from CHECKUP_ALLOWED_ORIGINS (comma-separated, exact origins); outside production any
// http://localhost:<port> or http://127.0.0.1:<port> is allowed too, for previewing the page locally.
const DEFAULT_ORIGINS = "https://parvaapp.ir,https://www.parvaapp.ir";
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function allowedOrigins(): string[] {
  return (process.env.CHECKUP_ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  return process.env.NODE_ENV !== "production" && DEV_ORIGIN.test(origin);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** The preflight answer: the CORS headers for an allowed origin, none (so the browser refuses) otherwise. */
export function publicPreflight(req: Request): Response {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: isAllowedOrigin(origin) ? corsHeaders(origin) : { Vary: "Origin" } });
}

export function withPublicCors<T extends Response>(req: Request, res: T): T {
  const origin = req.headers.get("origin");
  if (isAllowedOrigin(origin)) for (const [key, value] of Object.entries(corsHeaders(origin))) res.headers.set(key, value);
  else res.headers.set("Vary", "Origin");
  return res;
}
