// One-time codes: a 6-digit number sent by email or SMS to verify an address/phone, sign in without
// the password, or reset it. Only an HMAC of the code is stored (keyed with the server secret, bound to
// the purpose and target), so a database leak does not hand out working codes.
//
// Limits, per target (address or phone) and purpose:
//   - a code lives CODE_TTL_MS and dies after MAX_ATTEMPTS wrong tries or its first use;
//   - a new code may be asked for once per RESEND_COOLDOWN_MS, at most MAX_PER_HOUR per hour;
//   - asking for a new code retires every older unused one.
// Per-client-address limits live in the routes (rateLimit.ts).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { ApiError } from "./apiError";
import { sessionSecret } from "./sessionSecret";

export type OtpPurpose = "VERIFY_EMAIL" | "VERIFY_PHONE" | "LOGIN_OTP" | "RESET_PASSWORD";
export type OtpChannel = "EMAIL" | "SMS";

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_PER_HOUR = 5;

function hashCode(purpose: OtpPurpose, target: string, code: string): string {
  const key = Buffer.concat([Buffer.from("parva-otp:"), Buffer.from(process.env.OTP_SECRET || ""), Buffer.from(sessionSecret())]);
  return createHmac("sha256", key).update(`${purpose}:${target}:${code}`).digest("hex");
}

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Seconds until a new code may be requested for this target, 0 when it may be now. */
export async function secondsUntilResend(purpose: OtpPurpose, target: string, now = new Date()): Promise<number> {
  const latest = await prisma.verificationCode.findFirst({ where: { purpose, target }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (!latest) return 0;
  const wait = latest.createdAt.getTime() + RESEND_COOLDOWN_MS - now.getTime();
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/**
 * Creates a fresh code and returns it in clear, for the caller to send. Throws a 429 (AUTH-010) while
 * the cooldown or the hourly cap for this target is in force.
 */
export async function issueCode(input: { purpose: OtpPurpose; channel: OtpChannel; target: string; userId?: string | null; ipAddress?: string | null }): Promise<{ code: string; expiresAt: Date }> {
  const now = new Date();
  const wait = await secondsUntilResend(input.purpose, input.target, now);
  if (wait > 0) throw new ApiError(`برای درخواست کد جدید ${wait} ثانیه صبر کنید.`, 429, "AUTH-010", { retryAfterSeconds: wait });

  const lastHour = await prisma.verificationCode.count({ where: { target: input.target, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
  if (lastHour >= MAX_PER_HOUR) throw new ApiError("تعداد درخواست کد در این ساعت به سقف رسیده است. کمی بعد دوباره تلاش کنید.", 429, "AUTH-010", { retryAfterSeconds: 3600 });

  await prisma.verificationCode.updateMany({ where: { purpose: input.purpose, target: input.target, consumedAt: null }, data: { consumedAt: now } });
  await pruneOldCodes(now);

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await prisma.verificationCode.create({
    data: {
      purpose: input.purpose,
      channel: input.channel,
      target: input.target,
      userId: input.userId ?? null,
      codeHash: hashCode(input.purpose, input.target, code),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
    },
  });
  return { code, expiresAt };
}

export type ConsumeResult = { ok: true; userId: string | null } | { ok: false; reason: "none" | "expired" | "exhausted" | "mismatch" };

/**
 * Checks a typed code against the newest live one for this target and purpose; on a match marks it used
 * (atomically — two requests racing with the same code cannot both win).
 */
export async function consumeCode(input: { purpose: OtpPurpose; target: string; code: string }, now = new Date()): Promise<ConsumeResult> {
  const typed = input.code.trim();
  const row = await prisma.verificationCode.findFirst({
    where: { purpose: input.purpose, target: input.target, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, reason: "none" };
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "exhausted" };

  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashCode(input.purpose, input.target, /^\d{6}$/.test(typed) ? typed : "invalid"), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await prisma.verificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: "mismatch" };
  }

  const claimed = await prisma.verificationCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  if (claimed.count !== 1) return { ok: false, reason: "none" };
  return { ok: true, userId: row.userId };
}

/** The one message every failed code check shows — it does not say which of wrong/expired/used it was. */
export function codeRejected(): ApiError {
  return new ApiError("کد واردشده اشتباه است یا منقضی شده. کد جدید بگیرید.", 400, "AUTH-006");
}

/** Old rows are useless after a day (the hourly cap looks back one hour); every new code clears them out. */
export async function pruneOldCodes(now = new Date()): Promise<number> {
  const { count } = await prisma.verificationCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return count;
}
