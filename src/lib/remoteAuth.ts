// The Android app's ONE deliberate exception to "never talk to a server": on Capacitor, a
// relative fetch("/api/...") resolves against the WebView's own bundled-asset origin
// (capacitor://localhost), not the internet, so absolute URLs against REMOTE_API_BASE are the
// only way to reach the real remote deployment. This module's own functions are called only from
// src/lib/nativeOnboarding.ts; src/local/sync.ts is the other, separate caller of REMOTE_API_BASE
// (it needs raw fetch(), not the JSON-error-shape handling `handle()` below provides). Every
// other /api/* call in the app goes through apiClient.ts's local-dispatcher branching instead.
import { ApiClientError } from "./apiClient";

// Overridable at build time (e.g. for a staging backend) via NEXT_PUBLIC_REMOTE_API_BASE.
// Temporarily pointed at Railway's own domain instead of dara.mganic.ir — that custom domain's
// DNS has stopped resolving entirely (unrelated to any app code; confirmed 2026-08-26 against
// public resolvers). Switch back to https://dara.mganic.ir once that's fixed.
export const REMOTE_API_BASE = process.env.NEXT_PUBLIC_REMOTE_API_BASE ?? "https://hesabkon-app-production.up.railway.app";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = "خطایی رخ داد. دوباره تلاش کنید.";
    let details: unknown;
    try {
      const body = await res.json();
      message = body.error ?? message;
      details = body.details;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiClientError(message, res.status, details);
  }
  return res.json();
}

export interface RemoteUser {
  id: string;
  name: string;
  email: string;
}

// Login/register return the session JWT in the body (not just a cookie) specifically for this
// native flow: a SameSite=Lax cookie set by a cross-origin response never gets attached to the
// Capacitor WebView's follow-up cross-origin request, so the app carries this token explicitly
// as an Authorization header instead (see requireUserId in src/lib/auth.ts).
export interface RemoteAuthResult {
  user: RemoteUser;
  token: string;
}

export function remoteLogin(email: string, password: string): Promise<RemoteAuthResult> {
  return fetch(`${REMOTE_API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((res) => handle<{ id: string; name: string; email: string; token: string }>(res))
    .then(({ token, ...user }) => ({ user, token }));
}

export function remoteRegister(name: string, email: string, password: string): Promise<RemoteAuthResult> {
  return fetch(`${REMOTE_API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  }).then((res) => handle<{ id: string; name: string; email: string; token: string }>(res))
    .then(({ token, ...user }) => ({ user, token }));
}

export interface RemoteLicenseStatus {
  status: "TRIAL" | "FREE" | "SUBSCRIBED" | "LIFETIME";
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export function fetchRemoteLicenseStatus(token: string): Promise<RemoteLicenseStatus> {
  return fetch(`${REMOTE_API_BASE}/api/license/status`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((res) => handle<RemoteLicenseStatus>(res));
}
