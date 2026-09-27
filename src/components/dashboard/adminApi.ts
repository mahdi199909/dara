// The dashboard's writes. Web only (the dashboard never runs in the app), so plain fetch.
import { ApiClientError } from "@/lib/apiClient";

export async function adminPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  let json: { error?: string; details?: unknown; code?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) throw new ApiClientError(json?.error ?? "خطایی رخ داد.", res.status, json?.details, json?.code);
  return json as T;
}

export type LicenseChangeBody =
  | { action: "extend"; days: number }
  | { action: "shorten"; days: number }
  | { action: "set_until"; until: string }
  | { action: "lifetime" }
  | { action: "free" }
  | { action: "trial"; days: number };

export function changeLicense(userId: string, change: LicenseChangeBody) {
  return adminPost<{ status: string; endsAt: string | null; daysRemaining: number | null }>(`/api/admin/users/${encodeURIComponent(userId)}/license`, change);
}

export function accountAction(userId: string, action: "disable" | "enable" | "signout" | "verify-email") {
  return adminPost<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}/actions`, { action });
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "خطایی رخ داد.";
}
