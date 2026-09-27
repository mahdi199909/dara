import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { ApiError } from "./apiErrorBase";
import { sessionSecret } from "./sessionSecret";
import { logSessionInvalid, logAccountDisabled } from "./observability/server/authEvents";
import { setRequestUser } from "./observability/server/requestContext";
import type { NextRequest } from "next/server";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "hesabkon_session";
// Deliberately very long-lived, not a typical web session — FirstRunGate.tsx's on-device login
// makes an explicit promise to the user ("این فقط یک‌بار لازمه — بعدش دیگه نیازی به ورود دوباره
// نیست", i.e. "only needed once, never again"), and there is no refresh-token mechanism to renew
// it silently. A short-lived token would otherwise expire invisibly in the background — every
// sync/license call after that starts failing 401 and is swallowed by nativeOnboarding.ts's own
// catch-alls, so the user would see nothing wrong locally while cross-device sync silently and
// permanently stopped.
//
// Long-lived but revocable: every token carries the account's `sessionVersion` (claim `sv`), and every
// authenticated request checks it against the database. A password reset or change, "sign out of all
// devices" and an owner's suspension bump the version, which ends every token issued before.
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

/** How stale `lastSeenAt` may get before a request refreshes it (one small write per user per window). */
const LAST_SEEN_REFRESH_MS = 5 * 60_000;

export interface SessionPayload {
  userId: string;
  email: string;
  /** The account's sessionVersion when the token was issued; tokens from before it existed have none (= 0). */
  sv?: number;
  [key: string]: unknown;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(sessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string") return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

/**
 * Signs a person in: a token bound to their current session version, the web cookie, and the
 * last-login stamp. Every way in (password, one-time code, password reset, registration) ends here.
 * The token is also returned for the Android app, which carries it as a bearer token.
 */
export async function issueSession(user: { id: string; email: string; sessionVersion?: number | null }): Promise<string> {
  const token = await createSessionToken({ userId: user.id, email: user.email, sv: user.sessionVersion ?? 0 });
  await setSessionCookie(token);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastSeenAt: new Date() } }).catch(() => undefined);
  return token;
}

type SessionUser = { id: string; email: string; sessionVersion: number; disabledAt: Date | null; lastSeenAt: Date | null };

/** The account behind a verified token, or why it cannot be used. */
async function resolveSession(payload: SessionPayload): Promise<{ user: SessionUser } | { refused: "invalid" | "disabled" }> {
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, sessionVersion: true, disabledAt: true, lastSeenAt: true },
  });
  if (!user) return { refused: "invalid" };
  // Suspension first: suspending also moves the session version on, and the person should be told why.
  if (user.disabledAt) return { refused: "disabled" };
  if ((payload.sv ?? 0) !== user.sessionVersion) return { refused: "invalid" };
  if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    // Best effort, never in the request's way.
    void prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return { user };
}

/** Server Component / Route Handler helper: returns the current authenticated user, or null. */
export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const resolved = await resolveSession(payload);
  if (!("user" in resolved)) return null;
  setRequestUser(payload.userId);
  return prisma.user.findUnique({ where: { id: payload.userId } });
}

/**
 * Route Handler helper: returns userId or throws a 401-friendly error. Accepts an optional
 * `req` so callers reachable cross-origin from the Android app (see src/lib/nativeCors.ts) can
 * also authenticate via `Authorization: Bearer <token>` — the session cookie itself can't cross
 * from a Capacitor WebView origin to this deployment (SameSite), so the native app carries the
 * same session JWT as a bearer token instead. Web callers never send this header; cookie auth
 * is unaffected.
 *
 * A token whose session version is stale (signed out everywhere, password changed) is refused like an
 * invalid one; a suspended account gets a 403 AUTH-007 so the app can say why.
 */
export async function requireUserId(req?: NextRequest): Promise<string> {
  const cookieToken = (await cookies()).get(COOKIE_NAME)?.value;
  const bearerToken = req?.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token = cookieToken ?? bearerToken;
  if (!token) {
    logSessionInvalid("missing");
    throw new AuthError();
  }
  const payload = await verifySessionToken(token);
  if (!payload) {
    logSessionInvalid("invalid");
    throw new AuthError();
  }
  const resolved = await resolveSession(payload);
  if ("refused" in resolved) {
    if (resolved.refused === "disabled") {
      logAccountDisabled({ userId: payload.userId });
      throw accountDisabledError();
    }
    logSessionInvalid("invalid");
    throw new AuthError();
  }
  setRequestUser(payload.userId);
  return payload.userId;
}

export function accountDisabledError(): ApiError {
  return new ApiError("این حساب غیرفعال شده است. برای پیگیری با پشتیبانی تماس بگیرید.", 403, "AUTH-007");
}

/** Ends every session of an account (including the caller's, unless a new one is issued right after). */
export async function revokeAllSessions(userId: string): Promise<{ id: string; email: string; sessionVersion: number }> {
  return prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } }, select: { id: true, email: true, sessionVersion: true } });
}

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthError";
  }
}

export { COOKIE_NAME };
