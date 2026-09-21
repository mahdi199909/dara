// The event catalogue: every event name a log call may use. Names are English, constant,
// machine-readable and independent of the message text: DOMAIN_ACTION_RESULT (for example
// TASK_CREATE_SUCCESS, SYNC_FAILED, DB_SLOW_QUERY). The `EventName` type is derived from the tables
// below, so a misspelled or invented event is a compile error at the call site rather than a
// silently un-searchable log line.
//
// Two kinds:
//  - operations: DOMAIN_ACTION with the standard results STARTED / SUCCESS / FAILED, generated from
//    OPERATIONS. STARTED is DEBUG, SUCCESS is INFO, FAILED is ERROR and is never sampled away.
//  - standalone events: things that are not a start/success/failure triple (a slow query, a sync
//    retry, a rejected payload), each with its own level and description.
import type { Level } from "./levels";

/**
 * The requirement list's "DATABASE" is the DB domain here (so DB_SLOW_QUERY etc.); the extra
 * domains below the first block exist because the events they carry need a home of their own.
 */
export const DOMAINS = [
  "AUTH",
  "USER",
  "TASK",
  "PROJECT",
  "ACTIVITY",
  "TIME",
  "CATEGORY",
  "CALENDAR",
  "EVENT",
  "HABIT",
  "ACCOUNT",
  "TRANSACTION",
  "EXPENSE",
  "INCOME",
  "INSTALLMENT",
  "DEBT",
  "ASSET",
  "REPORT",
  "CAPITAL",
  "NOTIFICATION",
  "SYNC",
  "DB",
  "API",
  "SYSTEM",
  "BACKUP",
  "EXPORT",
  "IMPORT",
  "SETTINGS",
  // added beyond the original list
  "HTTP",
  "PAYMENT",
  "RESTORE",
  "LOCAL_NOTIFICATION",
  "WIDGET",
  "LICENSE",
  "RELEASE",
  "JOB",
  "LOG",
  "AUDIT",
  "UI",
] as const;
export type Domain = (typeof DOMAINS)[number];

/** The modules a domain's events belong to by default — what `FINANCE=INFO` in LOG_LEVEL matches. */
export const MODULE_OF_DOMAIN: Readonly<Record<Domain, string>> = {
  AUTH: "auth",
  USER: "auth",
  TASK: "tasks",
  PROJECT: "projects",
  ACTIVITY: "activities",
  TIME: "activities",
  CATEGORY: "categories",
  CALENDAR: "calendar",
  EVENT: "calendar",
  HABIT: "habits",
  ACCOUNT: "finance",
  TRANSACTION: "finance",
  EXPENSE: "finance",
  INCOME: "finance",
  INSTALLMENT: "finance",
  DEBT: "finance",
  PAYMENT: "finance",
  ASSET: "assets",
  REPORT: "reports",
  CAPITAL: "capital",
  NOTIFICATION: "notifications",
  LOCAL_NOTIFICATION: "notifications",
  SYNC: "sync",
  DB: "database",
  API: "api",
  HTTP: "api",
  SYSTEM: "system",
  JOB: "system",
  LOG: "system",
  BACKUP: "backup",
  RESTORE: "backup",
  EXPORT: "backup",
  IMPORT: "backup",
  SETTINGS: "settings",
  WIDGET: "widgets",
  LICENSE: "release",
  RELEASE: "release",
  AUDIT: "audit",
  UI: "ui",
};

export const OPERATION_RESULTS = ["STARTED", "SUCCESS", "FAILED"] as const;

/** DOMAIN → the actions that get a STARTED / SUCCESS / FAILED triple. */
export const OPERATIONS = {
  TASK: ["CREATE", "UPDATE", "DELETE", "COMPLETE"],
  PROJECT: ["CREATE", "UPDATE", "DELETE", "COMPLETE"],
  ACTIVITY: ["CREATE", "UPDATE", "DELETE"],
  TIME: ["TIMER_START", "TIMER_STOP", "ENTRY_CREATE"],
  CATEGORY: ["CREATE", "UPDATE", "DELETE", "REORDER"],
  EVENT: ["CREATE", "UPDATE", "DELETE", "COMPLETE"],
  HABIT: ["CREATE", "UPDATE", "DELETE", "CHECKIN", "UNDO"],
  ACCOUNT: ["CREATE", "UPDATE", "DELETE", "TRANSFER"],
  TRANSACTION: ["CREATE", "UPDATE", "DELETE"],
  EXPENSE: ["CREATE", "UPDATE", "DELETE"],
  INCOME: ["CREATE", "UPDATE", "DELETE"],
  PAYMENT: ["CREATE", "UPDATE"],
  INSTALLMENT: ["CREATE", "UPDATE", "DELETE", "PAY"],
  DEBT: ["CREATE", "UPDATE"],
  ASSET: ["CREATE", "UPDATE", "DELETE"],
  CAPITAL: ["SNAPSHOT"],
  SETTINGS: ["UPDATE"],
  LICENSE: ["TRIAL_START", "STATUS_CHECK"],
} as const satisfies Partial<Record<Domain, readonly string[]>>;

type Operations = typeof OPERATIONS;
/** "TASK_CREATE", "TIME_TIMER_START" … — the prefix of an operation's three events. */
export type OperationBase = { [D in keyof Operations]: `${D & string}_${Operations[D][number]}` }[keyof Operations];
export type OperationEvent = `${OperationBase}_${(typeof OPERATION_RESULTS)[number]}`;

export interface StandaloneMeta {
  level: Level;
  description: string;
  /** Exempt from sampling, like everything at ERROR and above. */
  protected?: boolean;
  /** A security-relevant event (authentication, authorisation). Never sampled away. */
  security?: boolean;
  /** Fires per request/tick — the one kind of INFO that sampling may thin. */
  highVolume?: boolean;
}

function s(level: Level, description: string, flags: Omit<StandaloneMeta, "level" | "description"> = {}): StandaloneMeta {
  return { level, description, ...flags };
}

const STANDALONE = {
  // --- Authentication (security events: never sampled)
  AUTH_LOGIN_ATTEMPT: s("DEBUG", "A login request arrived.", { security: true }),
  AUTH_LOGIN_SUCCESS: s("INFO", "A login succeeded.", { security: true }),
  AUTH_LOGIN_FAILED: s("WARN", "A login was refused.", { security: true, protected: true }),
  AUTH_REGISTER_SUCCESS: s("INFO", "A new account was created.", { security: true }),
  AUTH_REGISTER_FAILED: s("WARN", "An account could not be created.", { security: true, protected: true }),
  AUTH_LOGOUT_SUCCESS: s("INFO", "A session was ended by the person.", { security: true }),
  AUTH_SESSION_CREATED: s("INFO", "A session token was issued.", { security: true }),
  AUTH_SESSION_EXPIRED: s("WARN", "An expired session token was presented.", { security: true, protected: true }),
  AUTH_SESSION_INVALID: s("WARN", "A missing or invalid session token was presented.", { security: true, protected: true }),
  AUTH_RATE_LIMITED: s("WARN", "Login attempts were throttled.", { security: true, protected: true }),
  AUTH_FORBIDDEN: s("WARN", "A signed-in user tried something they may not do.", { security: true, protected: true }),

  // --- HTTP and API
  HTTP_REQUEST_STARTED: s("DEBUG", "An HTTP request arrived.", { highVolume: true }),
  HTTP_REQUEST_COMPLETED: s("INFO", "An HTTP request finished (status, duration and size in the fields).", { highVolume: true }),
  API_UNHANDLED_ERROR: s("ERROR", "A route handler threw something it did not handle.", { protected: true }),
  API_SLOW_REQUEST: s("WARN", "An HTTP request took longer than the slow-request threshold."),

  // --- Database (server PostgreSQL and on-device SQLite)
  DB_CONNECTION_ERROR: s("ERROR", "The database could not be reached.", { protected: true }),
  DB_QUERY_ERROR: s("ERROR", "A database query failed.", { protected: true }),
  DB_TRANSACTION_FAILED: s("ERROR", "A database transaction failed.", { protected: true }),
  DB_TRANSACTION_ROLLBACK: s("WARN", "A database transaction was rolled back; nothing was committed.", { protected: true }),
  DB_TRANSACTION_COMMIT: s("DEBUG", "A database transaction was committed."),
  DB_SLOW_QUERY: s("WARN", "A database operation took longer than the slow-query threshold."),
  DB_CONNECTION_POOL_EXHAUSTED: s("ERROR", "No database connection became available in time.", { protected: true }),
  DB_LOCAL_RECOVERED: s("ERROR", "The on-device database file was corrupt; its backup copy was loaded instead.", { protected: true }),
  DB_LOCAL_FLUSH_CALLBACK_FAILED: s("ERROR", "A handler that runs after the on-device database is saved failed."),

  // --- Synchronisation (each cycle carries a sync_id in both the phone's and the server's logs)
  SYNC_STARTED: s("INFO", "A sync cycle began (the trigger is in the fields)."),
  SYNC_PENDING: s("DEBUG", "A local write is waiting for the next sync."),
  SYNC_PULL_STARTED: s("DEBUG", "Fetching changes from the server."),
  SYNC_PULL_SUCCESS: s("DEBUG", "Server changes were fetched and applied."),
  SYNC_PULL_FAILED: s("WARN", "Fetching changes from the server failed.", { protected: true }),
  SYNC_PULL_ROW_FAILED: s("WARN", "A row the server sent could not be stored on the device.", { protected: true }),
  SYNC_PUSH_STARTED: s("DEBUG", "Sending local changes to the server."),
  SYNC_PUSH_SUCCESS: s("DEBUG", "Local changes were sent and accepted."),
  SYNC_PUSH_FAILED: s("WARN", "Sending local changes to the server failed.", { protected: true }),
  SYNC_SUCCESS: s("INFO", "A sync cycle finished without any failure."),
  SYNC_COMPLETED: s("INFO", "A sync cycle reached its end; counts and duration are in the fields."),
  SYNC_FAILED: s("ERROR", "A sync cycle did not finish.", { protected: true }),
  SYNC_RETRY: s("WARN", "A failed sync will be tried again.", { protected: true }),
  SYNC_RERUN_QUEUED: s("DEBUG", "A sync was requested while one was running; one more run is queued."),
  SYNC_CONFLICT: s("INFO", "The same row changed on two sides; the newer edit won."),
  SYNC_PARTIAL_SUCCESS: s("WARN", "A sync finished, but the server refused some rows.", { protected: true }),
  SYNC_PAYLOAD_REJECTED: s("WARN", "The server refused a row or a whole request body.", { protected: true }),
  SYNC_SIZE_LIMIT_EXCEEDED: s("WARN", "A sync request exceeded the size limit and was split or refused.", { protected: true }),
  SYNC_CORRELATION_UNSUPPORTED: s("INFO", "The server did not accept the phone's correlation headers (an older server); requests go without them for a while."),

  // --- Notifications
  NOTIFICATION_CREATED: s("INFO", "An in-app notification was created."),
  NOTIFICATION_ACTIVATED: s("INFO", "A due reminder became an in-app notification."),
  NOTIFICATION_READ: s("DEBUG", "An in-app notification was marked read."),
  NOTIFICATION_SCHEDULED: s("INFO", "A reminder was scheduled."),
  NOTIFICATION_FAILED: s("ERROR", "A notification could not be created or delivered.", { protected: true }),
  LOCAL_NOTIFICATION_SCHEDULED: s("DEBUG", "A reminder was scheduled with the operating system.", { highVolume: true }),
  LOCAL_NOTIFICATION_RESCHEDULED: s("DEBUG", "A scheduled reminder was moved.", { highVolume: true }),
  LOCAL_NOTIFICATION_CANCELLED: s("DEBUG", "A scheduled reminder was cancelled.", { highVolume: true }),
  LOCAL_NOTIFICATION_RECONCILED: s("DEBUG", "The operating system's schedule was aligned with the database."),
  LOCAL_NOTIFICATION_FAILED: s("ERROR", "A reminder could not be scheduled, moved or cancelled with the operating system.", { protected: true }),
  LOCAL_NOTIFICATION_PERMISSION_FAILED: s("WARN", "Notification permission could not be requested or was not granted.", { protected: true }),

  // --- Widgets (they never write to the database: actions travel through an offline queue)
  WIDGET_ACTION_RECEIVED: s("DEBUG", "A home-screen widget action arrived."),
  WIDGET_QUEUE_ADDED: s("DEBUG", "A widget action was queued."),
  WIDGET_QUEUE_PROCESSED: s("DEBUG", "Queued widget actions were applied to the database."),
  WIDGET_QUEUE_FAILED: s("ERROR", "A queued widget action failed; it stays queued and the rest of the queue continues.", { protected: true }),
  WIDGET_REFRESH_FAILED: s("ERROR", "A home-screen widget could not be repainted or its data could not be prepared."),

  // --- Reports, capital, backup, export/import
  REPORT_GENERATION_STARTED: s("DEBUG", "A report started."),
  REPORT_GENERATION_COMPLETED: s("INFO", "A report finished (range, record count and duration in the fields)."),
  REPORT_GENERATION_FAILED: s("ERROR", "A report failed.", { protected: true }),
  REPORT_SLOW: s("WARN", "A report took longer than the slow-report threshold."),
  BACKUP_STARTED: s("INFO", "A backup export started."),
  BACKUP_COMPLETED: s("INFO", "A backup export finished (record count, file size, duration)."),
  BACKUP_FAILED: s("ERROR", "A backup export failed.", { protected: true }),
  RESTORE_STARTED: s("INFO", "A backup restore started."),
  RESTORE_COMPLETED: s("INFO", "A backup restore finished."),
  RESTORE_PARTIAL: s("WARN", "A backup was restored, but some rows were refused.", { protected: true }),
  RESTORE_FAILED: s("ERROR", "A backup restore failed.", { protected: true }),
  EXPORT_STARTED: s("INFO", "A data export started."),
  EXPORT_COMPLETED: s("INFO", "A data export finished."),
  EXPORT_FAILED: s("ERROR", "A data export failed.", { protected: true }),
  IMPORT_STARTED: s("INFO", "A data import started."),
  IMPORT_COMPLETED: s("INFO", "A data import finished."),
  IMPORT_FAILED: s("ERROR", "A data import failed.", { protected: true }),
  IMPORT_ROW_FAILED: s("WARN", "An imported row could not be stored on this pass."),

  // --- System, jobs, release, settings, categories, audit, UI
  SYSTEM_STARTED: s("INFO", "The process started."),
  SYSTEM_SHUTDOWN: s("INFO", "The process is shutting down."),
  SYSTEM_UNHANDLED_ERROR: s("CRITICAL", "An uncaught exception or unhandled promise rejection.", { protected: true }),
  SYSTEM_DEEP_LINK_FAILED: s("WARN", "The app's deep-link handler could not be set up."),
  JOB_STARTED: s("DEBUG", "A background job started."),
  JOB_COMPLETED: s("INFO", "A background job finished."),
  JOB_FAILED: s("ERROR", "A background job failed.", { protected: true }),
  JOB_SKIPPED: s("DEBUG", "A background job had nothing to do."),
  RELEASE_READ_FAILED: s("WARN", "The stored release override could not be read; the built-in release is used."),
  RELEASE_UPDATE_CHECK_FAILED: s("WARN", "The app could not check whether a newer version exists."),
  RELEASE_UPDATE_AVAILABLE: s("INFO", "A newer app version exists."),
  SETTINGS_THEME_SYNC_FAILED: s("WARN", "The status-bar colour could not follow the theme."),
  CATEGORY_DEFAULTS_FAILED: s("WARN", "Default categories could not be created or merged."),
  AUDIT_WRITE_FAILED: s("ERROR", "An audit entry could not be written; the operation itself was not affected.", { protected: true }),
  UI_RENDER_ERROR: s("ERROR", "A screen failed to render.", { protected: true }),

  // --- The logging system reporting on itself
  LOG_QUEUE_OVERFLOW: s("WARN", "The log queue was full and records were dropped.", { protected: true }),
  LOG_SINK_FAILED: s("ERROR", "A log sink failed to write; logging continues without it.", { protected: true }),
  LOG_INTERNAL_ERROR: s("ERROR", "A log record could not be built; a reduced record was written instead.", { protected: true }),
  LOG_LEVEL_CHANGED: s("INFO", "A log level was changed at runtime.", { protected: true }),
} satisfies Record<string, StandaloneMeta>;

export type EventName = OperationEvent | keyof typeof STANDALONE;

export interface EventMeta {
  name: EventName;
  domain: Domain;
  level: Level;
  description: string;
  protected: boolean;
  security: boolean;
  highVolume: boolean;
  kind: "operation" | "standalone";
}

/** Longest domain first, so LOCAL_NOTIFICATION_* is not mistaken for something shorter. */
const DOMAINS_LONGEST_FIRST: readonly Domain[] = [...DOMAINS].sort((a, b) => b.length - a.length);

export function domainOf(event: string): Domain | undefined {
  return DOMAINS_LONGEST_FIRST.find((domain) => event.startsWith(`${domain}_`));
}

export function moduleOfDomain(domain: Domain | undefined): string | undefined {
  return domain ? MODULE_OF_DOMAIN[domain] : undefined;
}

function lower(token: string): string {
  return token.toLowerCase().replace(/_/g, " ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "TASK_CREATE_SUCCESS" → "Task create success." — the fallback message for an event with none. */
export function humanizeEvent(event: string): string {
  return `${capitalize(lower(event))}.`;
}

function buildRegistry(): Record<EventName, EventMeta> {
  const registry: Record<string, EventMeta> = {};

  for (const [domain, actions] of Object.entries(OPERATIONS) as Array<[Domain, readonly string[]]>) {
    for (const action of actions) {
      for (const result of OPERATION_RESULTS) {
        const name = `${domain}_${action}_${result}` as EventName;
        registry[name] = {
          name,
          domain,
          level: result === "STARTED" ? "DEBUG" : result === "SUCCESS" ? "INFO" : "ERROR",
          description: `${capitalize(lower(domain))} ${lower(action)} ${result.toLowerCase()}.`,
          protected: result === "FAILED",
          security: false,
          highVolume: false,
          kind: "operation",
        };
      }
    }
  }

  for (const [name, meta] of Object.entries(STANDALONE)) {
    const domain = domainOf(name);
    if (!domain) throw new Error(`Event ${name} does not start with a known domain`); // caught by events.test.ts long before runtime
    registry[name] = {
      name: name as EventName,
      domain,
      level: meta.level,
      description: meta.description,
      protected: meta.protected === true || meta.security === true,
      security: meta.security === true,
      highVolume: meta.highVolume === true,
      kind: "standalone",
    };
  }

  return registry as Record<EventName, EventMeta>;
}

export const EVENTS: Readonly<Record<EventName, EventMeta>> = buildRegistry();
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EVENTS, value);
}

export function eventMeta(event: string): EventMeta | undefined {
  return isEventName(event) ? EVENTS[event] : undefined;
}

/** Upper-case words joined by underscores: at least a domain and one more word. */
export const EVENT_NAME_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;

/** Everything wrong with a candidate event name (empty = fine). Used by the registry's own tests. */
export function validateEventName(name: string): string[] {
  const problems: string[] = [];
  if (!EVENT_NAME_PATTERN.test(name)) problems.push("must be UPPER_SNAKE_CASE with at least two words");
  if (!domainOf(name)) problems.push("must start with a known domain");
  return problems;
}
