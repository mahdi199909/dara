// The audit layer's vocabulary: for every kind of audited write, in one table,
//   - the legacy `action` the History screen has always keyed its labels on (CREATE, COMPLETE_TASK …),
//   - the canonical *fact* it records (TASK_UPDATED, EXPENSE_CREATED …) — what the `event` column holds,
//   - and the application-log event written once the operation succeeded (TASK_UPDATE_SUCCESS …).
//
// The audit trail says what happened to a person's data ("the task was updated"); the application log
// says what the system did ("the update operation succeeded"). Same domains and the same stems, two
// layers: TASK_UPDATED in the database, TASK_UPDATE_SUCCESS in the log, joined by request/entity ids.
//
// Adding an audited operation means adding a row here: a test scans every audit call in the code and
// fails on a pair that is not in the table, so the vocabulary cannot silently fall behind.
// Isomorphic (no node: imports) — the phone's writer uses the same table as the server's.
import type { EventName } from "./events";

export interface AuditVocabularyEntry {
  /** The legacy `action` column value. */
  action: string;
  entityType: string;
  /** The canonical fact, DOMAIN_PAST-TENSE — stored in the `event` column. */
  event: string;
  /** Written to the application log after the operation succeeded (only where the catalogue has one). */
  logEvent?: EventName;
}

function entry(entityType: string, action: string, event: string, logEvent?: EventName): AuditVocabularyEntry {
  return logEvent ? { entityType, action, event, logEvent } : { entityType, action, event };
}

export const AUDIT_VOCABULARY: readonly AuditVocabularyEntry[] = [
  // People and their settings. (Sign-in and sign-out already have their own security events in the log.)
  entry("User", "REGISTER", "USER_REGISTERED"),
  entry("User", "LOGIN", "USER_LOGGED_IN"),
  entry("User", "LOGOUT", "USER_LOGGED_OUT"),
  entry("Settings", "CHANGE_SETTINGS", "SETTINGS_UPDATED", "SETTINGS_UPDATE_SUCCESS"),
  entry("License", "LICENSE_TRIAL_START", "LICENSE_TRIAL_STARTED", "LICENSE_TRIAL_START_SUCCESS"),

  // Owner-only administration (an /api/admin route): the actor is the signed-in owner.
  entry("License", "ADMIN_LICENSE_UPDATE", "LICENSE_ADMIN_UPDATED"),
  entry("AppRelease", "ADMIN_RELEASE_UPDATE", "RELEASE_ADMIN_UPDATED"),
  entry("LogSettings", "ADMIN_LOG_LEVEL_UPDATE", "LOG_LEVEL_ADMIN_UPDATED"),

  // Work
  entry("Task", "CREATE", "TASK_CREATED", "TASK_CREATE_SUCCESS"),
  entry("Task", "UPDATE", "TASK_UPDATED", "TASK_UPDATE_SUCCESS"),
  entry("Task", "DELETE", "TASK_DELETED", "TASK_DELETE_SUCCESS"),
  entry("Task", "COMPLETE_TASK", "TASK_COMPLETED", "TASK_COMPLETE_SUCCESS"),
  entry("Project", "CREATE", "PROJECT_CREATED", "PROJECT_CREATE_SUCCESS"),
  entry("Project", "UPDATE", "PROJECT_UPDATED", "PROJECT_UPDATE_SUCCESS"),
  entry("Project", "DELETE", "PROJECT_DELETED", "PROJECT_DELETE_SUCCESS"),
  entry("Project", "COMPLETE_PROJECT", "PROJECT_COMPLETED", "PROJECT_COMPLETE_SUCCESS"),
  entry("Activity", "CREATE", "ACTIVITY_CREATED", "ACTIVITY_CREATE_SUCCESS"),
  entry("Activity", "UPDATE", "ACTIVITY_UPDATED", "ACTIVITY_UPDATE_SUCCESS"),
  entry("Activity", "DELETE", "ACTIVITY_DELETED", "ACTIVITY_DELETE_SUCCESS"),
  entry("Activity", "TIMER_START", "TIMER_STARTED", "TIME_TIMER_START_SUCCESS"),
  entry("Activity", "TIMER_STOP", "TIMER_STOPPED", "TIME_TIMER_STOP_SUCCESS"),
  entry("TimeEntry", "CREATE", "TIME_ENTRY_CREATED", "TIME_ENTRY_CREATE_SUCCESS"),
  entry("Category", "CREATE", "CATEGORY_CREATED", "CATEGORY_CREATE_SUCCESS"),
  entry("Category", "UPDATE", "CATEGORY_UPDATED", "CATEGORY_UPDATE_SUCCESS"),
  entry("Category", "DELETE", "CATEGORY_DELETED", "CATEGORY_DELETE_SUCCESS"),
  entry("Category", "REORDER", "CATEGORIES_REORDERED", "CATEGORY_REORDER_SUCCESS"),
  entry("Budget", "CREATE", "BUDGET_CREATED", "BUDGET_CREATE_SUCCESS"),
  entry("Budget", "UPDATE", "BUDGET_UPDATED", "BUDGET_UPDATE_SUCCESS"),
  entry("Budget", "DELETE", "BUDGET_DELETED", "BUDGET_DELETE_SUCCESS"),

  // Calendar and habits
  entry("Event", "CREATE", "EVENT_CREATED", "EVENT_CREATE_SUCCESS"),
  entry("Event", "UPDATE", "EVENT_UPDATED", "EVENT_UPDATE_SUCCESS"),
  entry("Event", "DELETE", "EVENT_DELETED", "EVENT_DELETE_SUCCESS"),
  entry("DailyNote", "CREATE", "NOTE_CREATED", "NOTE_CREATE_SUCCESS"),
  entry("DailyNote", "UPDATE", "NOTE_UPDATED", "NOTE_UPDATE_SUCCESS"),
  entry("DailyNote", "DELETE", "NOTE_DELETED", "NOTE_DELETE_SUCCESS"),
  entry("EventCompletion", "EVENT_COMPLETE", "EVENT_COMPLETED", "EVENT_COMPLETE_SUCCESS"),
  entry("EventCompletion", "EVENT_UNCOMPLETE", "EVENT_UNCOMPLETED"),
  entry("Reminder", "CREATE", "REMINDER_CREATED"),
  entry("Reminder", "DELETE", "REMINDER_DELETED"),
  entry("Habit", "CREATE", "HABIT_CREATED", "HABIT_CREATE_SUCCESS"),
  entry("Habit", "UPDATE", "HABIT_UPDATED", "HABIT_UPDATE_SUCCESS"),
  entry("Habit", "DELETE", "HABIT_DELETED", "HABIT_DELETE_SUCCESS"),
  entry("Habit", "HABIT_PROMOTE_TRIAL", "HABIT_PROMOTED"),
  entry("HabitCheckIn", "HABIT_CHECKIN", "HABIT_CHECKED_IN", "HABIT_CHECKIN_SUCCESS"),
  entry("HabitCheckIn", "HABIT_UNCHECK", "HABIT_UNDONE", "HABIT_UNDO_SUCCESS"),
  entry("HabitCheckIn", "HABIT_LOG_DURATION", "HABIT_DURATION_LOGGED"),

  // Money
  entry("FinanceAccount", "CREATE", "ACCOUNT_CREATED", "ACCOUNT_CREATE_SUCCESS"),
  entry("FinanceAccount", "UPDATE", "ACCOUNT_UPDATED", "ACCOUNT_UPDATE_SUCCESS"),
  entry("FinanceAccount", "DELETE", "ACCOUNT_DELETED", "ACCOUNT_DELETE_SUCCESS"),
  entry("Transaction", "CREATE_EXPENSE", "EXPENSE_CREATED", "EXPENSE_CREATE_SUCCESS"),
  entry("Transaction", "CREATE_INCOME", "INCOME_CREATED", "INCOME_CREATE_SUCCESS"),
  entry("Transaction", "CREATE_TRANSFER", "ACCOUNT_TRANSFERRED", "ACCOUNT_TRANSFER_SUCCESS"),
  entry("Transaction", "UPDATE", "TRANSACTION_UPDATED", "TRANSACTION_UPDATE_SUCCESS"),
  entry("Transaction", "DELETE", "TRANSACTION_DELETED", "TRANSACTION_DELETE_SUCCESS"),
  entry("InstallmentPlan", "CREATE", "INSTALLMENT_PLAN_CREATED", "INSTALLMENT_CREATE_SUCCESS"),
  entry("InstallmentPlan", "UPDATE", "INSTALLMENT_PLAN_UPDATED", "INSTALLMENT_UPDATE_SUCCESS"),
  entry("InstallmentPlan", "DELETE", "INSTALLMENT_PLAN_DELETED", "INSTALLMENT_DELETE_SUCCESS"),
  entry("Installment", "PAYMENT", "INSTALLMENT_PAID", "INSTALLMENT_PAY_SUCCESS"),
  entry("Asset", "CREATE", "ASSET_CREATED", "ASSET_CREATE_SUCCESS"),
  entry("Asset", "UPDATE", "ASSET_UPDATED", "ASSET_UPDATE_SUCCESS"),
  entry("Asset", "DELETE", "ASSET_DELETED", "ASSET_DELETE_SUCCESS"),
  entry("VirtualAssetEntry", "DELETE", "VIRTUAL_ASSET_ENTRY_DELETED"),

  // Backups. Their application-log events (BACKUP_*, RESTORE_*) are written by the backup code itself,
  // which knows whether a restore was complete or partial — so no logEvent here.
  entry("Backup", "BACKUP_EXPORT", "BACKUP_EXPORTED"),
  entry("Backup", "BACKUP_IMPORT", "BACKUP_IMPORTED"),
];

const BY_PAIR = new Map<string, AuditVocabularyEntry>(AUDIT_VOCABULARY.map((item) => [`${item.entityType}|${item.action}`, item]));
const BY_EVENT = new Map<string, AuditVocabularyEntry>(AUDIT_VOCABULARY.map((item) => [item.event, item]));

/** The vocabulary row for a legacy (entityType, action) pair, if the pair is known. */
export function auditEntryFor(entityType: string, action: string): AuditVocabularyEntry | undefined {
  return BY_PAIR.get(`${entityType}|${action}`);
}

/** The vocabulary row for a canonical event name, if known. */
export function auditEntryForEvent(event: string): AuditVocabularyEntry | undefined {
  return BY_EVENT.get(event);
}

/** MyEntityType → MY_ENTITY_TYPE. */
function snakeUpper(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

/**
 * The canonical event for a write. Known pairs come from the table; an unknown pair gets a
 * deterministic name (ENTITY_ACTION) so a new call site is still recorded — and the vocabulary test
 * fails until the pair is given a proper row.
 */
export function auditEventFor(entityType: string, action: string): string {
  return auditEntryFor(entityType, action)?.event ?? `${snakeUpper(entityType)}_${snakeUpper(action)}`;
}

export interface ResolvedAuditIdentity {
  /** The legacy action (what History labels). */
  action: string;
  entityType: string;
  event: string;
  logEvent?: EventName;
}

/**
 * Accepts either naming: the legacy `action` (CREATE, COMPLETE_TASK) or the canonical `event`
 * (TASK_COMPLETED — what the audit.log() facade's callers write), and returns both, so a row is always
 * stored with its legacy action (History keeps working) and its canonical event.
 */
export function resolveAuditIdentity(input: { action?: string; event?: string; entityType?: string }): ResolvedAuditIdentity {
  const fromEvent = input.event ? auditEntryForEvent(input.event) : undefined;
  if (fromEvent) return { action: fromEvent.action, entityType: input.entityType ?? fromEvent.entityType, event: fromEvent.event, logEvent: fromEvent.logEvent };

  const entityType = input.entityType ?? "Unknown";
  const action = input.action ?? input.event ?? "UNKNOWN";
  const known = auditEntryFor(entityType, action);
  return { action, entityType, event: input.event ?? known?.event ?? auditEventFor(entityType, action), logEvent: known?.logEvent };
}
