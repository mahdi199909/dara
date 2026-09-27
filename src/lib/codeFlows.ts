// The steps behind "sign in with a one-time code", "forgot password" and verifying an address or a
// phone. Routes stay thin; this is where the order of checks lives.
//
// Anti-enumeration: asking for a sign-in or reset code answers the same way whether or not an account
// exists (a code row is even created, and never sent, so the resend cooldown behaves identically).
import { prisma } from "./db";
import { ApiError } from "./apiError";
import { issueCode, consumeCode, codeRejected, RESEND_COOLDOWN_MS, type OtpPurpose } from "./otp";
import { assertChannelAvailable, sendCode } from "./messaging";
import { findAccount, parseIdentifier, latinCode, type Identifier } from "./accountLookup";
import { hitLimits, LIMITS } from "./rateLimit";
import { maskEmail, maskPhone } from "./phone";
import { logCodeFailed, logCodeSent, logRateLimited } from "./observability/server/authEvents";

export interface CodeSentAnswer {
  ok: true;
  channel: "EMAIL" | "SMS";
  /** Where the code went, partly hidden ("so*****@gmail.com", "0912***6789"). */
  sentTo: string;
  /** When the next code may be requested. */
  retryAfterSeconds: number;
}

function masked(id: Identifier): string {
  return id.channel === "EMAIL" ? maskEmail(id.target) : maskPhone(id.target);
}

function tooMany(retryAfterMs: number): ApiError {
  return new ApiError("درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-002", { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) });
}

/** Per-address throttle for asking for codes, on top of otp.ts's per-target cooldown. */
function limitRequest(ip: string | null): void {
  const rl = hitLimits([[`code:req:ip:${ip ?? "unknown"}`, LIMITS.codeRequestPerIp]]);
  if (!rl.allowed) {
    logRateLimited({ email: "code-request", ip });
    throw tooMany(rl.retryAfterMs);
  }
}

/** Per-address and per-target throttle for typing codes. */
function limitVerify(ip: string | null, target: string): void {
  const rl = hitLimits([
    [`code:verify:ip:${ip ?? "unknown"}`, LIMITS.codeVerifyPerIp],
    [`code:verify:target:${target}`, LIMITS.codeVerifyPerTarget],
  ]);
  if (!rl.allowed) {
    logRateLimited({ email: target, ip });
    throw tooMany(rl.retryAfterMs);
  }
}

/** Sign-in or password-reset code for someone who is not signed in. */
export async function requestPublicCode(input: { purpose: "LOGIN_OTP" | "RESET_PASSWORD"; identifier: string; ip: string | null }): Promise<CodeSentAnswer> {
  limitRequest(input.ip);
  const id = parseIdentifier(input.identifier);
  await assertChannelAvailable(id.channel);

  const user = await findAccount(id);
  const usable = user && !user.disabledAt;
  const { code } = await issueCode({ purpose: input.purpose, channel: id.channel, target: id.target, userId: usable ? user.id : null, ipAddress: input.ip });
  if (usable) {
    await sendCode({ channel: id.channel, to: id.target, code, purpose: input.purpose });
    logCodeSent({ purpose: input.purpose, channel: id.channel, target: id.target, userId: user.id, ip: input.ip });
  }
  return { ok: true, channel: id.channel, sentTo: masked(id), retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

/**
 * Checks a sign-in or reset code and returns the account it belongs to. A code created for an address
 * with no account (see requestPublicCode) has no userId and always fails.
 */
export async function verifyPublicCode(input: { purpose: "LOGIN_OTP" | "RESET_PASSWORD"; identifier: string; code: string; ip: string | null }) {
  const id = parseIdentifier(input.identifier);
  limitVerify(input.ip, id.target);
  const result = await consumeCode({ purpose: input.purpose, target: id.target, code: latinCode(input.code) });
  if (!result.ok || !result.userId) {
    logCodeFailed({ purpose: input.purpose, target: id.target, reason: result.ok ? "no_account" : result.reason, ip: input.ip });
    throw codeRejected();
  }
  const user = await findAccount(id);
  // The account behind the code must still be the one the identifier names (e.g. the phone was not moved meanwhile).
  if (!user || user.id !== result.userId) {
    logCodeFailed({ purpose: input.purpose, target: id.target, reason: "account_changed", ip: input.ip });
    throw codeRejected();
  }
  return { id, user };
}

/** Verification code to the signed-in person's own address or a phone number they are adding. */
export async function requestContactCode(input: { userId: string; channel: "EMAIL" | "SMS"; target: string; ip: string | null }): Promise<CodeSentAnswer> {
  limitRequest(input.ip);
  await assertChannelAvailable(input.channel);
  const purpose: OtpPurpose = input.channel === "EMAIL" ? "VERIFY_EMAIL" : "VERIFY_PHONE";
  const { code } = await issueCode({ purpose, channel: input.channel, target: input.target, userId: input.userId, ipAddress: input.ip });
  await sendCode({ channel: input.channel, to: input.target, code, purpose });
  logCodeSent({ purpose, channel: input.channel, target: input.target, userId: input.userId, ip: input.ip });
  const id: Identifier = { channel: input.channel, target: input.target };
  return { ok: true, channel: input.channel, sentTo: masked(id), retryAfterSeconds: RESEND_COOLDOWN_MS / 1000 };
}

export async function verifyContactCode(input: { userId: string; channel: "EMAIL" | "SMS"; target: string; code: string; ip: string | null }): Promise<void> {
  limitVerify(input.ip, input.target);
  const purpose: OtpPurpose = input.channel === "EMAIL" ? "VERIFY_EMAIL" : "VERIFY_PHONE";
  const result = await consumeCode({ purpose, target: input.target, code: latinCode(input.code) });
  if (!result.ok || result.userId !== input.userId) {
    logCodeFailed({ purpose, target: input.target, reason: result.ok ? "other_account" : result.reason, ip: input.ip });
    throw codeRejected();
  }
}

/** A phone number may belong to one account; someone else's unverified claim on it does not count. */
export async function assertPhoneFree(phone: string, userId: string): Promise<void> {
  const owner = await prisma.user.findFirst({ where: { phone, phoneVerifiedAt: { not: null }, NOT: { id: userId } }, select: { id: true } });
  if (owner) throw new ApiError("این شماره موبایل به حساب دیگری متصل است.", 409, "AUTH-009");
}
