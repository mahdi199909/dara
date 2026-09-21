// The owner's panels talk to /api/admin/* with plain fetch: they exist on the web only (the phone has no server to
// administer), so there is no on-device dispatcher to route around — unlike apiClient.ts's helpers.
import { ApiClientError } from "@/lib/apiClient";

export async function adminFetch<T>(method: "GET" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let json: { error?: string; details?: unknown } | null = null;
  try {
    json = await res.json();
  } catch {
    // an empty or non-JSON body: the status still says what happened
  }
  if (!res.ok) throw new ApiClientError(json?.error ?? "خطایی رخ داد.", res.status, json?.details);
  return json as T;
}

export function errorText(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "خطایی رخ داد.";
}

/** "14:35" in the owner's own clock, for "until when" labels. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

/** The colour class of a log level: quiet levels quiet, the serious ones in the warning colour. */
export function levelTone(level: string): string {
  if (level === "CRITICAL") return "text-waste font-bold";
  if (level === "ERROR" || level === "WARN") return "text-waste";
  if (level === "TRACE" || level === "DEBUG") return "text-muted";
  return "text-ink";
}
