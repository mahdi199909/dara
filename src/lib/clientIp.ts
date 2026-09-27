// Which address a request came from — for rate limits, the audit trail and the logs.
//
// In production the app is only reachable through nginx on the same host (docker-compose.yml publishes
// the app port on 127.0.0.1 alone). A proxy *appends* the address it saw to X-Forwarded-For, so the
// left-most entries are whatever the client chose to send and can be forged; only the last
// TRUSTED_PROXY_HOPS entries (default 1: nginx) were written by something we run. Reading the first
// entry — what this used to do — let anyone pick their own address and walk around every per-IP limit.
export function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? raw : 1;
}

export function clientIp(req: Request): string | null {
  const hops = trustedProxyHops();
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (hops > 0 && forwarded.length > 0) {
    // The entry the outermost trusted proxy appended: hops=1 → the last one.
    return forwarded[Math.max(0, forwarded.length - hops)] ?? null;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}
