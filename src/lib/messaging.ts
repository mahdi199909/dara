// Sending one-time codes by email (SMTP) and SMS (an Iranian gateway). Server only.
//
// Configuration lives in the server's .env (see .env.example and DEPLOYMENT.md "Email and SMS"):
//   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for 465), SMTP_USER, SMTP_PASS, SMTP_FROM
//   SMS_PROVIDER = kavenegar | smsir
//     kavenegar: KAVENEGAR_API_KEY, KAVENEGAR_OTP_TEMPLATE (a "verify lookup" template with %token)
//     smsir:     SMSIR_API_KEY, SMSIR_TEMPLATE_ID, SMSIR_PARAM_NAME (default CODE)
//
// When a channel is not configured: outside production the message is written to the log and kept in
// an in-memory outbox (dev and the tests read codes from there); in production the request is refused
// with AUTH-008, so nobody waits for a code that will never arrive.
import nodemailer, { type Transporter } from "nodemailer";
import { ApiError } from "./apiError";
import { getLogger } from "./observability/root";
import { APP_DISPLAY_NAME } from "./appVersion";
import type { OtpPurpose } from "./otp";

const log = getLogger("auth", "messaging");

export interface OutboxMessage {
  channel: "EMAIL" | "SMS";
  to: string;
  subject?: string;
  text: string;
  code?: string;
  at: Date;
}

const devOutbox: OutboxMessage[] = [];

/** Dev and tests only: what would have been sent. */
export function getDevOutbox(): readonly OutboxMessage[] {
  return devOutbox;
}

export function clearDevOutbox(): void {
  devOutbox.length = 0;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function smsProvider(): "kavenegar" | "smsir" | null {
  const p = (process.env.SMS_PROVIDER ?? "").toLowerCase();
  if (p === "kavenegar" && process.env.KAVENEGAR_API_KEY && process.env.KAVENEGAR_OTP_TEMPLATE) return "kavenegar";
  if (p === "smsir" && process.env.SMSIR_API_KEY && process.env.SMSIR_TEMPLATE_ID) return "smsir";
  return null;
}

export function smsConfigured(): boolean {
  return smsProvider() !== null;
}

/** Whether codes can reach people on this channel (always true outside production — the dev outbox). */
export function channelAvailable(channel: "EMAIL" | "SMS"): boolean {
  if (!isProduction()) return true;
  return channel === "EMAIL" ? emailConfigured() : smsConfigured();
}

function unavailable(channel: "EMAIL" | "SMS"): ApiError {
  return new ApiError(
    channel === "EMAIL" ? "ارسال ایمیل روی سرور هنوز راه‌اندازی نشده است. لطفاً با پشتیبانی تماس بگیرید." : "ارسال پیامک روی سرور هنوز راه‌اندازی نشده است. لطفاً از ایمیل استفاده کنید.",
    503,
    "AUTH-008"
  );
}

/** Throws AUTH-008 up front when a channel cannot deliver, before any code is created. */
export function assertChannelAvailable(channel: "EMAIL" | "SMS"): void {
  if (!channelAvailable(channel)) throw unavailable(channel);
}

const PURPOSE_TEXT: Record<OtpPurpose, string> = {
  VERIFY_EMAIL: "تأیید ایمیل",
  VERIFY_PHONE: "تأیید شماره موبایل",
  LOGIN_OTP: "ورود به حساب",
  RESET_PASSWORD: "بازیابی رمز عبور",
};

let transport: Transporter | null = null;

function smtp(): Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    // Never follow a message's own file/URL references (defence in depth: only our text is sent).
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  return transport;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendEmail(input: { to: string; subject: string; text: string; html?: string; code?: string }): Promise<void> {
  if (!emailConfigured()) {
    if (isProduction()) throw unavailable("EMAIL");
    devOutbox.push({ channel: "EMAIL", to: input.to, subject: input.subject, text: input.text, code: input.code, at: new Date() });
    log.info("AUTH_OTP_SENT", { channel: "EMAIL", dev: true, note: "SMTP not configured — message kept in the dev outbox", devText: input.text });
    return;
  }
  try {
    await smtp().sendMail({ from: process.env.SMTP_FROM, to: input.to, subject: input.subject, text: input.text, html: input.html });
  } catch (err) {
    log.error("AUTH_MESSAGE_SEND_FAILED", { errorCode: "AUTH-008", channel: "EMAIL", error: err instanceof Error ? { type: err.name, message: err.message } : undefined });
    throw new ApiError("ارسال ایمیل ناموفق بود. چند دقیقه بعد دوباره تلاش کنید.", 503, "AUTH-008");
  }
}

async function sendSms(phone: string, code: string, text: string): Promise<void> {
  const provider = smsProvider();
  if (!provider) {
    if (isProduction()) throw unavailable("SMS");
    devOutbox.push({ channel: "SMS", to: phone, text, code, at: new Date() });
    log.info("AUTH_OTP_SENT", { channel: "SMS", dev: true, note: "SMS not configured — message kept in the dev outbox", devText: text });
    return;
  }
  try {
    const res =
      provider === "kavenegar"
        ? await fetch(
            `https://api.kavenegar.com/v1/${encodeURIComponent(process.env.KAVENEGAR_API_KEY!)}/verify/lookup.json?` +
              new URLSearchParams({ receptor: phone, token: code, template: process.env.KAVENEGAR_OTP_TEMPLATE! }).toString(),
            { method: "POST", signal: AbortSignal.timeout(15_000) }
          )
        : await fetch("https://api.sms.ir/v1/send/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": process.env.SMSIR_API_KEY! },
            body: JSON.stringify({ mobile: phone, templateId: Number(process.env.SMSIR_TEMPLATE_ID), parameters: [{ name: process.env.SMSIR_PARAM_NAME || "CODE", value: code }] }),
            signal: AbortSignal.timeout(15_000),
          });
    if (!res.ok) throw new Error(`${provider} answered HTTP ${res.status}`);
  } catch (err) {
    log.error("AUTH_MESSAGE_SEND_FAILED", { errorCode: "AUTH-008", channel: "SMS", provider, error: err instanceof Error ? { type: err.name, message: err.message } : undefined });
    throw new ApiError("ارسال پیامک ناموفق بود. چند دقیقه بعد دوباره تلاش کنید یا از ایمیل استفاده کنید.", 503, "AUTH-008");
  }
}

/** Sends a one-time code in Persian. The code is never logged in production. */
export async function sendCode(input: { channel: "EMAIL" | "SMS"; to: string; code: string; purpose: OtpPurpose }): Promise<void> {
  const what = PURPOSE_TEXT[input.purpose];
  const text = `کد ${what} در ${APP_DISPLAY_NAME}: ${input.code}\nاین کد تا ۱۰ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.`;
  if (input.channel === "SMS") return sendSms(input.to, input.code, text);
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8">
<p>کد ${escapeHtml(what)} در ${escapeHtml(APP_DISPLAY_NAME)}:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold" dir="ltr">${escapeHtml(input.code)}</p>
<p>این کد تا ۱۰ دقیقه معتبر است. اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید؛ حساب شما امن است.</p>
</div>`;
  await sendEmail({ to: input.to, subject: `${what} — ${APP_DISPLAY_NAME}`, text, html, code: input.code });
}

/** For the admin dashboard's "send a test" button. */
export async function sendTestMessage(channel: "EMAIL" | "SMS", to: string): Promise<void> {
  if (channel === "EMAIL") {
    await sendEmail({ to, subject: `آزمایش ایمیل — ${APP_DISPLAY_NAME}`, text: `این یک پیام آزمایشی از پنل مدیریت ${APP_DISPLAY_NAME} است.` });
  } else {
    await sendSms(to, "123456", `پیام آزمایشی ${APP_DISPLAY_NAME}`);
  }
}
