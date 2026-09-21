// The phone's calls to the server, with the headers that tie them to its own log lines:
//
//   traceparent        W3C trace context; the cycle's trace id, a fresh span for this request
//   X-Parva-Device-Id  this installation (a random id, see observability/client/identity.ts)
//   X-Parva-Sync-Id    the sync cycle the request belongs to, when it is one
//
// The server reads them (src/lib/observability/server/requestContext.ts) and stamps them on every record of the
// request. They are only ever ids: nothing about the person or the data.
//
// COMPATIBILITY. The app calls the server from a WebView with another origin, so the browser asks the server's
// permission (a CORS preflight) before sending any header it does not know. A server built before these headers
// existed does not list them, so the browser refuses the request — and fetch() reports that exactly like being
// offline (a TypeError, no detail). Without care, updating the app before the server would stop every sync. So a
// request that fails that way is tried once more without the headers; if THAT works, the server does not accept
// them yet, and for the next half hour requests go without (then it is tried again, so an upgraded server is
// noticed without restarting the app). The retry is safe: a refused preflight means the request was never sent.
import { formatTraceparent, getLogger, newSpanId, newTraceId } from "./observability";
import { getClientDeviceId } from "./observability/client/clientContext";

const log = getLogger("sync", "remote");

/** How long requests go without the headers after a server refused them. */
export const CORRELATION_RETRY_AFTER_MS = 30 * 60 * 1000;

export interface RequestCorrelation {
  syncId?: string;
  traceId?: string;
}

let refusedAt: number | null = null;

/** Tests: forget what an earlier server did. */
export function resetRemoteFetchState(): void {
  refusedAt = null;
}

export function correlationHeaders(correlation: RequestCorrelation = {}): Record<string, string> {
  const headers: Record<string, string> = {
    traceparent: formatTraceparent({ traceId: correlation.traceId ?? newTraceId(), spanId: newSpanId(), sampled: true }),
  };
  const deviceId = getClientDeviceId();
  if (deviceId) headers["X-Parva-Device-Id"] = deviceId;
  if (correlation.syncId) headers["X-Parva-Sync-Id"] = correlation.syncId;
  return headers;
}

/** True while requests are going out without the headers because a server refused them. */
export function correlationRefused(now: number = Date.now()): boolean {
  return refusedAt !== null && now - refusedAt < CORRELATION_RETRY_AFTER_MS;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => (out[key] = value));
    return out;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

export async function remoteFetch(url: string, init: RequestInit = {}, correlation?: RequestCorrelation): Promise<Response> {
  if (correlationRefused()) return fetch(url, init);

  const withHeaders: RequestInit = { ...init, headers: { ...headersToRecord(init.headers), ...correlationHeaders(correlation) } };
  try {
    const response = await fetch(url, withHeaders);
    refusedAt = null;
    return response;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // Either we are offline (this second attempt fails too, and its error is the one that propagates) or the server
    // refused the headers (this one succeeds).
    const response = await fetch(url, init);
    refusedAt = Date.now();
    log.info("SYNC_CORRELATION_UNSUPPORTED", { layer: "local", retryAfterMs: CORRELATION_RETRY_AFTER_MS, syncId: correlation?.syncId });
    return response;
  }
}
