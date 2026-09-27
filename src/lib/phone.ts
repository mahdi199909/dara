// Iranian mobile numbers, the only kind the SMS providers used here deliver to. Stored as 09xxxxxxxxx.
// Isomorphic (no server imports): the sign-in form uses it to tell a phone number from an email.

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    return String(p >= 0 ? p : ARABIC_DIGITS.indexOf(ch));
  });
}

/** "۰۹۱۲ ۳۴۵ ۶۷۸۹", "+98 912-345-6789", "00989123456789", "9123456789" → "09123456789"; anything else → null. */
export function normalizeIranMobile(input: string): string | null {
  let digits = toLatinDigits(input).replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98") && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) digits = "0" + digits;
  return /^09\d{9}$/.test(digits) ? digits : null;
}

/** Whether a sign-in field holds a phone number rather than an email address. */
export function looksLikePhone(input: string): boolean {
  return !input.includes("@") && normalizeIranMobile(input) !== null;
}

/** 09123456789 → 0912***6789, for messages that must not reveal the whole number. */
export function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 4)}***${phone.slice(7)}` : phone;
}

/** someone@example.com → so*****@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
