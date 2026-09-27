// Sign-in by one-time code, password reset, and the signed-in account's security settings — from the
// web and from the app alike. These always talk to the real server: on the web through same-origin
// fetch (the session cookie), in the app to REMOTE_API_BASE with the stored session token as a bearer
// (see remoteAuth.ts for why the app cannot use the cookie). None of this touches the phone's own data.
import { ApiClientError, isNativePlatform } from "./apiClient";
import { REMOTE_API_BASE } from "./remoteAuth";
import { remoteFetch } from "./remoteFetch";

async function readError(res: Response): Promise<never> {
  let message = "خطایی رخ داد. دوباره تلاش کنید.";
  let details: unknown;
  let code: string | undefined;
  try {
    const body = await res.json();
    message = body.error ?? message;
    details = body.details;
    code = typeof body.code === "string" ? body.code : undefined;
  } catch {
    // not JSON
  }
  throw new ApiClientError(message, res.status, details, code);
}

/** The session token the app keeps (web callers use the cookie and pass nothing). */
async function nativeToken(): Promise<string | null> {
  const { getCachedLicense } = await import("./nativeOnboarding");
  return (await getCachedLicense())?.token ?? null;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const init: RequestInit = { method, headers: body !== undefined ? { "Content-Type": "application/json" } : {} };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res: Response;
  if (isNativePlatform()) {
    if (opts.auth) {
      const token = await nativeToken();
      if (!token) throw new ApiClientError("این دستگاه هنوز به حساب کاربری وصل نشده است. اول وارد حساب شوید.", 401);
      (init.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
    res = await remoteFetch(`${REMOTE_API_BASE}${path}`, init);
  } else {
    res = await fetch(path, init);
  }
  if (!res.ok) return readError(res);
  return res.json() as Promise<T>;
}

// ---- signing in without being signed in ------------------------------------------------------

export interface AuthResult {
  user: { id: string; name: string; email: string };
  token: string;
}

type AuthBody = { id: string; name: string; email: string; token: string };
const toResult = ({ token, ...user }: AuthBody): AuthResult => ({ user, token });

export interface CodeSent {
  ok: true;
  channel: "EMAIL" | "SMS";
  sentTo: string;
  retryAfterSeconds: number;
}

export function requestCode(purpose: "LOGIN_OTP" | "RESET_PASSWORD", identifier: string): Promise<CodeSent> {
  return call("POST", "/api/auth/code/request", { purpose, identifier });
}

export function loginWithCode(identifier: string, code: string): Promise<AuthResult> {
  return call<AuthBody>("POST", "/api/auth/code/login", { identifier, code }).then(toResult);
}

export function resetPasswordWithCode(identifier: string, code: string, newPassword: string): Promise<AuthResult> {
  return call<AuthBody>("POST", "/api/auth/code/reset-password", { identifier, code, newPassword }).then(toResult);
}

export function loginWithPassword(identifier: string, password: string): Promise<AuthResult> {
  return call<AuthBody>("POST", "/api/auth/login", { identifier, password }).then(toResult);
}

// ---- the signed-in account --------------------------------------------------------------------

export interface AccountSecurity {
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  passwordChangedAt: string | null;
  isAdmin: boolean;
  channels: { email: boolean; sms: boolean };
}

export function getAccountSecurity(): Promise<AccountSecurity> {
  return call("GET", "/api/account", undefined, { auth: true });
}

export function sendEmailVerificationCode(): Promise<CodeSent | { ok: true; alreadyVerified: true }> {
  return call("POST", "/api/account/email/send-code", {}, { auth: true });
}

export function verifyEmail(code: string): Promise<{ ok: true }> {
  return call("POST", "/api/account/email/verify", { code }, { auth: true });
}

export function sendPhoneVerificationCode(phone: string): Promise<CodeSent & { phone: string }> {
  return call("POST", "/api/account/phone/send-code", { phone }, { auth: true });
}

export function verifyPhone(phone: string, code: string): Promise<{ ok: true; phone: string }> {
  return call("POST", "/api/account/phone/verify", { phone, code }, { auth: true });
}

export function removePhone(): Promise<{ ok: true }> {
  return call("POST", "/api/account/phone/remove", {}, { auth: true });
}

/** In the app, the fresh token replaces the stored one — the old one stopped working with the change. */
async function keepNewToken(token: string): Promise<void> {
  if (!isNativePlatform()) return;
  const { replaceCachedToken } = await import("./nativeOnboarding");
  await replaceCachedToken(token);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { token } = await call<{ ok: true; token: string }>("POST", "/api/account/password", { currentPassword, newPassword }, { auth: true });
  await keepNewToken(token);
}

export async function signOutEverywhereElse(): Promise<void> {
  const { token } = await call<{ ok: true; token: string }>("POST", "/api/account/logout-all", {}, { auth: true });
  await keepNewToken(token);
}
