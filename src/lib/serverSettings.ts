// Email/SMS settings the owner can set from /dashboard instead of the server's .env. A value saved in the
// dashboard wins over the environment; clearing it falls back to the environment again. Values are stored
// encrypted (secretBox.ts) and the secret ones (passwords, API keys) are write-only: the dashboard is told
// only whether they are set and where from.
import { prisma } from "./db";
import { open, seal } from "./secretBox";
import { getLogger } from "./observability/root";

const log = getLogger("auth", "messaging");

export interface SettingField {
  key: string;
  label: string;
  group: "email" | "sms";
  /** Write-only: never sent back to the browser. */
  secret: boolean;
}

export const MESSAGING_FIELDS: readonly SettingField[] = [
  { key: "SMTP_HOST", label: "سرور SMTP", group: "email", secret: false },
  { key: "SMTP_PORT", label: "پورت", group: "email", secret: false },
  { key: "SMTP_SECURE", label: "اتصال امن مستقیم (true برای پورت 465)", group: "email", secret: false },
  { key: "SMTP_USER", label: "نام کاربری", group: "email", secret: false },
  { key: "SMTP_PASS", label: "رمز SMTP", group: "email", secret: true },
  { key: "SMTP_FROM", label: "فرستنده (مثل Parva <no-reply@parvaapp.ir>)", group: "email", secret: false },
  { key: "SMS_PROVIDER", label: "سرویس پیامک (kavenegar یا smsir)", group: "sms", secret: false },
  { key: "KAVENEGAR_API_KEY", label: "کلید API کاوه‌نگار", group: "sms", secret: true },
  { key: "KAVENEGAR_OTP_TEMPLATE", label: "نام قالب تأیید کاوه‌نگار", group: "sms", secret: false },
  { key: "SMSIR_API_KEY", label: "کلید API sms.ir", group: "sms", secret: true },
  { key: "SMSIR_TEMPLATE_ID", label: "شناسه‌ی قالب sms.ir", group: "sms", secret: false },
  { key: "SMSIR_PARAM_NAME", label: "نام پارامتر کد در قالب sms.ir", group: "sms", secret: false },
];

const FIELD_KEYS = new Set(MESSAGING_FIELDS.map((f) => f.key));

export type MessagingConfig = Record<string, string | undefined>;

const CACHE_MS = 30_000;
let cache: { at: number; stored: Map<string, string | null> } | null = null;

/** Decrypted dashboard values (null = stored but unreadable). */
async function storedValues(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.stored;
  const stored = new Map<string, string | null>();
  try {
    const rows = await prisma.serverSetting.findMany({ where: { key: { in: [...FIELD_KEYS] } } });
    for (const row of rows) {
      const value = open(row.key, row.value);
      if (value === null) log.warn("AUTH_MESSAGE_SEND_FAILED", { errorCode: "AUTH-008", setting: row.key, note: "stored setting could not be decrypted (server key changed?) — re-enter it in the dashboard" });
      stored.set(row.key, value);
    }
  } catch {
    // Table missing (a database older than this code) or unreachable: the environment still works.
  }
  cache = { at: Date.now(), stored };
  return stored;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** What messaging.ts sends with: the dashboard's value when there is one, else the environment's. */
export async function messagingConfig(): Promise<MessagingConfig> {
  const stored = await storedValues();
  const config: MessagingConfig = {};
  for (const { key } of MESSAGING_FIELDS) {
    const fromDashboard = stored.get(key);
    config[key] = fromDashboard ?? (process.env[key] || undefined);
  }
  return config;
}

export interface SettingView {
  key: string;
  label: string;
  group: "email" | "sms";
  secret: boolean;
  source: "dashboard" | "env" | null;
  /** Only for non-secret fields. */
  value: string | null;
  /** A stored value the server can no longer decrypt. */
  unreadable: boolean;
}

/** The dashboard's read view: never contains a secret value. */
export async function describeMessagingSettings(): Promise<SettingView[]> {
  const stored = await storedValues();
  return MESSAGING_FIELDS.map((f) => {
    const hasStored = stored.has(f.key);
    const storedValue = stored.get(f.key);
    const envValue = process.env[f.key] || null;
    const source = hasStored ? "dashboard" : envValue ? "env" : null;
    const value = f.secret ? null : hasStored ? (storedValue ?? null) : envValue;
    return { key: f.key, label: f.label, group: f.group, secret: f.secret, source, value, unreadable: hasStored && storedValue === null };
  });
}

export class SettingsValidationError extends Error {}

/**
 * Applies the owner's edits: a string sets (encrypted), null clears (back to the environment), an absent
 * key is left alone. Returns the names that changed — never their values.
 */
export async function saveMessagingSettings(changes: Record<string, string | null>, actorUserId: string): Promise<string[]> {
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    if (!FIELD_KEYS.has(key)) throw new SettingsValidationError(`تنظیم ناشناخته: ${key}`);
    if (raw === null) {
      await prisma.serverSetting.deleteMany({ where: { key } });
      changed.push(key);
      continue;
    }
    const value = raw.trim();
    if (value.length === 0 || value.length > 500) throw new SettingsValidationError(`مقدار «${key}» خالی یا بیش از حد طولانی است.`);
    if (/[\r\n]/.test(value)) throw new SettingsValidationError(`مقدار «${key}» نباید چندخطی باشد.`);
    if (key === "SMTP_PORT" && !/^\d{1,5}$/.test(value)) throw new SettingsValidationError("پورت باید عدد باشد.");
    if (key === "SMTP_SECURE" && !["true", "false"].includes(value)) throw new SettingsValidationError("اتصال امن باید true یا false باشد.");
    if (key === "SMS_PROVIDER" && !["kavenegar", "smsir"].includes(value.toLowerCase())) throw new SettingsValidationError("سرویس پیامک باید kavenegar یا smsir باشد.");
    if (key === "SMSIR_TEMPLATE_ID" && !/^\d+$/.test(value)) throw new SettingsValidationError("شناسه‌ی قالب sms.ir باید عدد باشد.");
    const sealed = seal(key, key === "SMS_PROVIDER" ? value.toLowerCase() : value);
    await prisma.serverSetting.upsert({ where: { key }, create: { key, value: sealed, updatedBy: actorUserId }, update: { value: sealed, updatedBy: actorUserId } });
    changed.push(key);
  }
  invalidateSettingsCache();
  return changed;
}
