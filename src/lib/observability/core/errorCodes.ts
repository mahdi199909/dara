// Stable, machine-readable error codes: DOMAIN-NNN. A code never changes when the Persian (or any
// other) message shown to a person changes, so support tickets, dashboards and alerts can rely on
// it. Add new codes at the end of a domain's range; never renumber or reuse one.

export interface ErrorCodeMeta {
  /** SCREAMING_SNAKE name, for humans reading a log. */
  name: string;
  description: string;
  /** The HTTP status a server response for this error uses, when it has one. */
  httpStatus?: number;
  /** Trying the same thing again later can succeed without anything else changing. */
  retryable: boolean;
}

export const ERROR_CODES = {
  // --- Authentication / authorisation
  "AUTH-001": { name: "INVALID_CREDENTIALS", description: "Email or password did not match an account.", httpStatus: 401, retryable: false },
  "AUTH-002": { name: "RATE_LIMITED", description: "Too many login attempts from one address for one account.", httpStatus: 429, retryable: true },
  "AUTH-003": { name: "SESSION_INVALID", description: "The session token is missing, malformed, expired or signed with another secret.", httpStatus: 401, retryable: false },
  "AUTH-004": { name: "FORBIDDEN", description: "Signed in, but not allowed to do this (e.g. an admin-only route).", httpStatus: 403, retryable: false },
  "AUTH-005": { name: "EMAIL_ALREADY_REGISTERED", description: "An account with this email already exists.", httpStatus: 409, retryable: false },

  // --- Input validation
  "VAL-001": { name: "INVALID_INPUT", description: "The request body or parameters failed schema validation.", httpStatus: 400, retryable: false },

  // --- Database (server PostgreSQL and the on-device SQLite)
  "DB-001": { name: "CONNECTION_ERROR", description: "The database could not be reached.", httpStatus: 503, retryable: true },
  "DB-002": { name: "QUERY_ERROR", description: "A database query failed.", httpStatus: 500, retryable: false },
  "DB-003": { name: "TRANSACTION_FAILED", description: "A database transaction could not be completed.", httpStatus: 500, retryable: false },
  "DB-004": { name: "POOL_EXHAUSTED", description: "No database connection became available in time.", httpStatus: 503, retryable: true },
  "DB-005": { name: "UNIQUE_VIOLATION", description: "A unique constraint rejected the write.", httpStatus: 409, retryable: false },
  "DB-006": { name: "FOREIGN_KEY_VIOLATION", description: "A write referenced a row that does not exist.", httpStatus: 409, retryable: false },
  "DB-007": { name: "RECORD_NOT_FOUND", description: "The row an operation needed was not found.", httpStatus: 404, retryable: false },
  "DB-008": { name: "LOCAL_DATABASE_CORRUPT", description: "The on-device database file could not be read and a backup copy was used instead.", retryable: false },

  // --- Synchronisation between a device and the server
  "SYNC-001": { name: "NETWORK_UNREACHABLE", description: "The device could not reach the server.", retryable: true },
  "SYNC-002": { name: "SERVER_ERROR", description: "The server answered a sync request with a 5xx status.", retryable: true },
  "SYNC-003": { name: "AUTH_REJECTED", description: "The server refused the device's session (401/403).", retryable: false },
  "SYNC-004": { name: "PAYLOAD_TOO_LARGE", description: "A sync request exceeded the proxy's body-size limit (413).", retryable: true },
  "SYNC-005": { name: "ROW_REJECTED", description: "The server refused an individual row (bad reference, invalid value, other account).", retryable: false },
  "SYNC-006": { name: "CONFLICT", description: "The same row changed on two sides; the newer edit won.", retryable: false },
  "SYNC-007": { name: "PROTOCOL_MISMATCH", description: "Device and server speak different sync protocol versions.", retryable: false },
  "SYNC-008": { name: "LOCAL_APPLY_FAILED", description: "A row the server sent could not be stored on the device.", retryable: true },
  "SYNC-009": { name: "UNKNOWN", description: "A sync failure that fits no other code.", retryable: true },

  // --- Domain rules
  "TASK-001": { name: "TASK_NOT_FOUND", description: "The task does not exist for this account.", httpStatus: 404, retryable: false },
  "TASK-002": { name: "TIME_OVERLAP", description: "A task's or event's time range overlaps another entry; the request is repeated with allowOverlap to accept it.", httpStatus: 409, retryable: false },
  "FIN-001": { name: "ACCOUNT_NOT_FOUND", description: "The financial account does not exist for this account.", httpStatus: 404, retryable: false },
  "FIN-002": { name: "TRANSACTION_NOT_FOUND", description: "The transaction does not exist for this account.", httpStatus: 404, retryable: false },
  "FIN-003": { name: "INSTALLMENT_ALREADY_PAID", description: "The installment was already paid.", httpStatus: 409, retryable: false },
  "FIN-004": { name: "AMOUNT_OUT_OF_RANGE", description: "A money amount is outside the supported range.", httpStatus: 400, retryable: false },

  // --- Notifications, widgets, backup, reports, release, audit
  "NOTIF-001": { name: "SCHEDULE_FAILED", description: "A reminder could not be (re)scheduled or cancelled with the operating system.", retryable: true },
  "NOTIF-002": { name: "PERMISSION_DENIED", description: "Notification permission was not granted.", retryable: false },
  "WIDGET-001": { name: "QUEUE_ITEM_FAILED", description: "A queued widget action could not be applied; it stays queued for the next drain.", retryable: true },
  "WIDGET-002": { name: "REFRESH_FAILED", description: "A home-screen widget could not be repainted.", retryable: true },
  "BACKUP-001": { name: "EXPORT_FAILED", description: "A backup file could not be produced.", retryable: true },
  "BACKUP-002": { name: "IMPORT_FAILED", description: "A backup file could not be restored.", retryable: false },
  "BACKUP-003": { name: "IMPORT_PARTIAL", description: "A backup was restored, but some rows were refused.", retryable: false },
  "REPORT-001": { name: "GENERATION_FAILED", description: "A report could not be generated.", retryable: true },
  "REPORT-002": { name: "RANGE_INVALID", description: "The requested report range is invalid.", httpStatus: 400, retryable: false },
  "RELEASE-001": { name: "UPDATE_CHECK_FAILED", description: "The app could not ask the server whether a newer version exists.", retryable: true },
  "AUDIT-001": { name: "WRITE_FAILED", description: "An audit entry could not be written (the operation itself is not affected).", retryable: false },

  // --- System and logging itself
  "SYS-001": { name: "UNHANDLED_ERROR", description: "An exception nobody handled.", httpStatus: 500, retryable: false },
  "SYS-002": { name: "DEPENDENCY_UNAVAILABLE", description: "A required dependency (database, platform API) was unavailable.", httpStatus: 503, retryable: true },
  "LOG-001": { name: "SINK_FAILED", description: "A log sink failed to write; logging continues without it.", retryable: true },
  "LOG-002": { name: "QUEUE_OVERFLOW", description: "The log queue was full and records were dropped.", retryable: false },
} as const satisfies Record<string, ErrorCodeMeta>;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_PATTERN = /^[A-Z]+-\d{3}$/;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

export function errorCodeMeta(code: ErrorCode): ErrorCodeMeta {
  return ERROR_CODES[code];
}

/** The kinds src/local/syncRunner.ts's classifySyncError distinguishes. */
export type SyncErrorKind = "network" | "auth" | "too-large" | "server" | "unknown";

export function syncErrorCode(kind: SyncErrorKind): ErrorCode {
  switch (kind) {
    case "network":
      return "SYNC-001";
    case "server":
      return "SYNC-002";
    case "auth":
      return "SYNC-003";
    case "too-large":
      return "SYNC-004";
    default:
      return "SYNC-009";
  }
}

/**
 * Best-effort code for a thrown value, by duck-typing (this module must not import zod, Prisma or
 * the auth module — it runs on the phone too). Null when nothing fits; callers then pick a code.
 */
export function classifyError(err: unknown): ErrorCode | null {
  if (typeof err !== "object" || err === null) return null;
  const { name, code } = err as { name?: unknown; code?: unknown };
  if (name === "ZodError") return "VAL-001";
  if (name === "AuthError") return "AUTH-003";
  // Thrown before any query ran: the connection itself could not be made (host, port, credentials).
  if (name === "PrismaClientInitializationError") return "DB-001";
  if (typeof code === "string") {
    switch (code) {
      case "P2002":
        return "DB-005";
      case "P2003":
        return "DB-006";
      case "P2025":
        return "DB-007";
      case "P2024":
        return "DB-004";
      case "P2028": // Transaction API error: timed out or already closed
      case "P2034": // a write conflict or deadlock made the transaction fail
        return "DB-003";
      case "P1001":
      case "P1002":
      case "P1008":
      case "P1017":
        return "DB-001";
      default:
        if (/^P\d{4}$/.test(code)) return "DB-002";
    }
  }
  return null;
}

/**
 * The generic code for an HTTP status — what an error response carries when the code that threw did
 * not name a more specific one. Statuses with no honest generic code (409, 402 …) return undefined.
 */
export function codeForHttpStatus(status: number): ErrorCode | undefined {
  if (status === 400 || status === 422) return "VAL-001";
  if (status === 401) return "AUTH-003";
  if (status === 403) return "AUTH-004";
  if (status === 404) return "DB-007";
  if (status === 429) return "AUTH-002";
  if (status >= 500) return "SYS-001";
  return undefined;
}
