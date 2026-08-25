// The Android app's ONE deliberate exception to "never talk to a server": on Capacitor, a
// relative fetch("/api/...") resolves against the WebView's own bundled-asset origin
// (capacitor://localhost), not the internet, so this is the only place in the app that builds
// an ABSOLUTE URL and calls the real remote deployment directly — see src/lib/nativeOnboarding.ts,
// which is the only caller. Every other /api/* call in the app goes through apiClient.ts's
// local-dispatcher branching instead; this module must never be used for anything else.
import { ApiClientError } from "./apiClient";

// Overridable at build time (e.g. for a staging backend) via NEXT_PUBLIC_REMOTE_API_BASE;
// defaults to the real production deployment.
const REMOTE_API_BASE = process.env.NEXT_PUBLIC_REMOTE_API_BASE ?? "https://dara.mganic.ir";

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

export function remoteLogin(email: string, password: string): Promise<RemoteUser> {
  return fetch(`${REMOTE_API_BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((res) => handle<RemoteUser>(res));
}

export function remoteRegister(name: string, email: string, password: string): Promise<RemoteUser> {
  return fetch(`${REMOTE_API_BASE}/api/auth/register`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  }).then((res) => handle<RemoteUser>(res));
}

export interface RemoteLicenseStatus {
  status: "TRIAL" | "FREE" | "SUBSCRIBED" | "LIFETIME";
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

/** Must be called right after remoteLogin/remoteRegister so the session cookie those set is attached. */
export function fetchRemoteLicenseStatus(): Promise<RemoteLicenseStatus> {
  return fetch(`${REMOTE_API_BASE}/api/license/status`, { credentials: "include" }).then((res) => handle<RemoteLicenseStatus>(res));
}
