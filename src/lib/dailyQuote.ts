// Fetches today's quote-of-the-day — server-sourced content (content/quotes.md via
// /api/quotes/today), deliberately never cached in the local SQLite mirror like the rest of the
// app's data. On native, a relative fetch resolves against the WebView's bundled-asset origin
// rather than the internet (same reasoning as src/lib/remoteAuth.ts), so this builds an absolute
// URL there; on web a relative fetch already reaches the real server.
function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

const REMOTE_API_BASE = process.env.NEXT_PUBLIC_REMOTE_API_BASE ?? "https://hesabkon-app-production.up.railway.app";

export async function fetchDailyQuote(): Promise<string | null> {
  const url = isNativePlatform() ? `${REMOTE_API_BASE}/api/quotes/today` : "/api/quotes/today";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body: { quote: string | null } = await res.json();
    return body.quote;
  } catch {
    return null;
  }
}
