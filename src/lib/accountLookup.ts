// Turning what someone typed into a sign-in field ("email or mobile number") into an account.
import { z } from "zod";
import { prisma } from "./db";
import { ApiError } from "./apiError";
import { normalizeIranMobile } from "./phone";

export type Identifier = { channel: "EMAIL"; target: string } | { channel: "SMS"; target: string };

export function parseIdentifier(raw: string): Identifier {
  const value = raw.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!z.string().email().max(254).safeParse(email).success) throw new ApiError("ایمیل نامعتبر است.", 400, "VAL-001");
    return { channel: "EMAIL", target: email };
  }
  const phone = normalizeIranMobile(value);
  if (!phone) throw new ApiError("ایمیل یا شماره موبایل معتبر وارد کنید (مثل 09121234567).", 400, "VAL-001");
  return { channel: "SMS", target: phone };
}

const ACCOUNT_SELECT = { id: true, email: true, name: true, passwordHash: true, sessionVersion: true, disabledAt: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true, mustChangePassword: true } as const;

/**
 * The account an identifier points at. A phone number only counts once it was verified on that account,
 * except for password sign-in (`unverifiedPhoneOk`): a number signed up without a code can sign in with its password.
 * One-time-code flows never use that, so a code only ever opens the account of whoever really holds the number.
 */
export async function findAccount(id: Identifier, opts: { unverifiedPhoneOk?: boolean } = {}) {
  if (id.channel === "EMAIL") return prisma.user.findUnique({ where: { email: id.target }, select: ACCOUNT_SELECT });
  return prisma.user.findFirst({ where: opts.unverifiedPhoneOk ? { phone: id.target } : { phone: id.target, phoneVerifiedAt: { not: null } }, select: ACCOUNT_SELECT });
}

/** What to show (and send as the legacy `email` field) for an account: its email, else its phone. */
export function accountLabel(u: { email: string | null; phone?: string | null }): string {
  return u.email ?? u.phone ?? "";
}

// bcrypt only reads the first 72 bytes; a longer password would silently be cut there.
export const passwordSchema = z
  .string()
  .min(8, "رمز عبور باید حداقل ۸ کاراکتر باشد.")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "رمز عبور خیلی طولانی است (حداکثر ۷۲ بایت).");

export const codeSchema = z.string().trim().regex(/^[0-9۰-۹]{6}$/, "کد ۶ رقمی را وارد کنید.");

/** Persian digits typed into a code field count too. */
export function latinCode(code: string): string {
  return code.trim().replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

/** A bcrypt hash of a random string, so a sign-in for an unknown account costs as long as a real one. */
export const TIMING_DUMMY_HASH = "$2a$10$ULWlGbDYoLX68fBlZCjvi.Fg33EYxpCskaELHQF97lkCGcUIN0xVe";
