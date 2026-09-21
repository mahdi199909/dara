// Authentication and authorisation events. These are security events: they are never sampled away
// (see sampling.ts) and they say what happened without saying who to a stranger reading the logs —
// an e-mail address appears only as a keyed hash ("em_3f9a…"), so two failures for the same account
// can be seen to belong together, but the address cannot be read back out of the log.
//
// The client's IP address is recorded here (it is what one investigates a burst of failures by) and
// nowhere in ordinary request records — see doc/logging/security.md.
import { createHmac } from "node:crypto";
import type { ErrorCode } from "../core/errorCodes";
import { metrics } from "../core/metrics";
import { getLogger } from "../root";
import { getRequestContext, setRequestErrorCode, setRequestUser } from "./requestContext";

const log = getLogger("auth", "events");

/** The counts an "authentication failures" panel is built from: sign-ins, refusals, throttling, bad sessions. */
const authEventsTotal = metrics.counter("auth_events_total", "Authentication and access events, by event.");
function count(event: string): void {
  try {
    authEventsTotal.inc({ event });
  } catch {
    // a metric must never break a sign-in
  }
}

/**
 * A stable, keyed pseudonym for an e-mail address. The key is derived from the server's own secret,
 * so someone holding only the logs cannot test guessed addresses against it.
 */
export function emailPseudonym(email: string): string {
  const secret = process.env.LOG_HASH_SECRET || process.env.JWT_SECRET || "dev-only-secret-change-me-in-production";
  const digest = createHmac("sha256", `parva-log-pseudonym:${secret}`).update(email.trim().toLowerCase()).digest("hex");
  return `em_${digest.slice(0, 12)}`;
}

/** The response of a refused request carries this code; the completion record reads it from the request. */
function noteCode(code: ErrorCode): void {
  setRequestErrorCode(code);
}

export type LoginFailureReason = "no_such_user" | "wrong_password";

export function logLoginFailed(input: { email: string; reason: LoginFailureReason; ip: string | null }): void {
  noteCode("AUTH-001");
  count("login_failed");
  log.warn("AUTH_LOGIN_FAILED", { errorCode: "AUTH-001", reason: input.reason, emailHash: emailPseudonym(input.email), ip: input.ip });
}

export function logRateLimited(input: { email: string; ip: string | null }): void {
  noteCode("AUTH-002");
  count("rate_limited");
  log.warn("AUTH_RATE_LIMITED", { errorCode: "AUTH-002", emailHash: emailPseudonym(input.email), ip: input.ip });
}

export function logLoginSuccess(input: { userId: string; ip: string | null }): void {
  setRequestUser(input.userId);
  count("login_success");
  log.info("AUTH_LOGIN_SUCCESS", { ip: input.ip });
}

export function logRegisterSuccess(input: { userId: string; ip: string | null }): void {
  setRequestUser(input.userId);
  count("register_success");
  log.info("AUTH_REGISTER_SUCCESS", { ip: input.ip });
}

export function logRegisterFailed(input: { email: string; reason: "email_taken"; ip: string | null }): void {
  noteCode("AUTH-005");
  count("register_failed");
  log.warn("AUTH_REGISTER_FAILED", { errorCode: "AUTH-005", reason: input.reason, emailHash: emailPseudonym(input.email), ip: input.ip });
}

export function logLogout(input: { userId?: string }): void {
  if (input.userId) setRequestUser(input.userId);
  count("logout");
  log.info("AUTH_LOGOUT_SUCCESS");
}

/** A protected route was called without a usable session (no token, or one that does not verify). */
export function logSessionInvalid(reason: "missing" | "invalid"): void {
  noteCode("AUTH-003");
  count("session_invalid");
  log.warn("AUTH_SESSION_INVALID", { errorCode: "AUTH-003", reason, route: getRequestContext()?.route });
}

/** A signed-in user tried something reserved for the owner (an /api/admin route). */
export function logForbidden(input: { userId: string; what: string }): void {
  setRequestUser(input.userId);
  noteCode("AUTH-004");
  count("forbidden");
  log.warn("AUTH_FORBIDDEN", { errorCode: "AUTH-004", what: input.what });
}
