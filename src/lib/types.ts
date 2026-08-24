// Shared enum-like string unions matching the string columns in prisma/schema.prisma.
// SQLite has no native enum type, so these are validated at the Zod layer instead.

export const CATEGORY_KINDS = ["PRODUCTIVE", "NEUTRAL", "WASTE"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const VALUE_TYPES = ["EXPENSE", "ASSET"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  EXPENSE: "هزینه",
  ASSET: "دارایی",
};

export const CAPTURE_TYPES = ["TASK", "EVENT"] as const;
export type CaptureEntityType = (typeof CAPTURE_TYPES)[number];

export const CAPTURE_TYPE_LABELS: Record<CaptureEntityType, string> = {
  TASK: "کار",
  EVENT: "رویداد",
};

export const PROJECT_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RECURRENCE_FREQS = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const REMINDER_TARGET_TYPES = ["EVENT", "INSTALLMENT", "CUSTOM"] as const;
export type ReminderTargetType = (typeof REMINDER_TARGET_TYPES)[number];

export const ACCOUNT_TYPES = ["BANK_CARD", "BANK_ACCOUNT", "CASH", "WALLET", "INVESTMENT"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE", "TRANSFER"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const INSTALLMENT_STATUSES = ["PENDING", "PAID", "OVERDUE"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export const ASSET_TRANSACTION_TYPES = ["VALUE_UPDATE", "EXPENSE", "SALE"] as const;
export type AssetTransactionType = (typeof ASSET_TRANSACTION_TYPES)[number];

export const REMINDER_OFFSET_PRESETS = [
  { label: "5 دقیقه قبل", minutes: 5 },
  { label: "10 دقیقه قبل", minutes: 10 },
  { label: "15 دقیقه قبل", minutes: 15 },
  { label: "30 دقیقه قبل", minutes: 30 },
  { label: "1 ساعت قبل", minutes: 60 },
  { label: "1 روز قبل", minutes: 60 * 24 },
] as const;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK_CARD: "کارت بانکی",
  BANK_ACCOUNT: "حساب بانکی",
  CASH: "پول نقد",
  WALLET: "کیف پول",
  INVESTMENT: "سرمایه‌گذاری",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "انجام‌نشده",
  IN_PROGRESS: "در حال انجام",
  DONE: "انجام‌شده",
  CANCELLED: "لغوشده",
};

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  PRODUCTIVE: "مفید",
  NEUTRAL: "خنثی",
  WASTE: "اتلاف‌وقت",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: "فعال",
  COMPLETED: "تکمیل‌شده",
  ARCHIVED: "بایگانی",
};

// Display/input scale for money — see lib/money.ts for the conversion math. All amounts are
// still stored as integer Toman everywhere (DB, API bodies); this only governs presentation.
export const CURRENCY_UNITS = ["RIAL", "TOMAN", "THOUSAND_TOMAN"] as const;
export type CurrencyUnit = (typeof CURRENCY_UNITS)[number];

export const CURRENCY_UNIT_LABELS: Record<CurrencyUnit, string> = {
  RIAL: "ریال",
  TOMAN: "تومان",
  THOUSAND_TOMAN: "هزار تومان",
};
