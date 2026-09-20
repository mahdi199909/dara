import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_CODE_PATTERN, classifyError, errorCodeMeta, isErrorCode, syncErrorCode } from "./errorCodes";
import {
  DOMAINS,
  EVENTS,
  EVENT_NAMES,
  EVENT_NAME_PATTERN,
  MODULE_OF_DOMAIN,
  OPERATIONS,
  OPERATION_RESULTS,
  domainOf,
  eventMeta,
  humanizeEvent,
  isEventName,
  moduleOfDomain,
  validateEventName,
} from "./events";
import { LEVELS } from "./levels";

describe("event catalogue", () => {
  it("names every event DOMAIN_ACTION_RESULT in upper snake case, starting with a known domain", () => {
    for (const name of EVENT_NAMES) {
      expect(EVENT_NAME_PATTERN.test(name), name).toBe(true);
      expect(validateEventName(name), name).toEqual([]);
      expect(domainOf(name), name).toBeDefined();
      expect(EVENTS[name].domain).toBe(domainOf(name));
    }
  });

  it("has no duplicate or empty entries and a valid level and description everywhere", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    for (const name of EVENT_NAMES) {
      const meta = EVENTS[name];
      expect(meta.name).toBe(name);
      expect(LEVELS).toContain(meta.level);
      expect(meta.description.length, name).toBeGreaterThan(5);
    }
  });

  it("generates STARTED / SUCCESS / FAILED for every operation, with the standard levels", () => {
    for (const [domain, actions] of Object.entries(OPERATIONS)) {
      for (const action of actions) {
        for (const result of OPERATION_RESULTS) {
          const name = `${domain}_${action}_${result}`;
          expect(isEventName(name), name).toBe(true);
        }
        expect(EVENTS[`${domain}_${action}_STARTED` as keyof typeof EVENTS].level).toBe("DEBUG");
        expect(EVENTS[`${domain}_${action}_SUCCESS` as keyof typeof EVENTS].level).toBe("INFO");
        const failed = EVENTS[`${domain}_${action}_FAILED` as keyof typeof EVENTS];
        expect(failed.level).toBe("ERROR");
        expect(failed.protected).toBe(true);
      }
    }
  });

  it("covers every event named in the requirements", () => {
    const required = [
      "AUTH_LOGIN_SUCCESS", "AUTH_LOGIN_FAILED", "AUTH_LOGIN_ATTEMPT", "AUTH_SESSION_CREATED", "AUTH_SESSION_EXPIRED", "AUTH_LOGOUT_SUCCESS",
      "TASK_CREATE_SUCCESS", "TASK_UPDATE_SUCCESS", "TASK_DELETE_SUCCESS", "TASK_COMPLETE_SUCCESS",
      "EXPENSE_CREATE_STARTED", "EXPENSE_CREATE_SUCCESS", "EXPENSE_CREATE_FAILED", "EXPENSE_UPDATE_SUCCESS", "EXPENSE_DELETE_SUCCESS",
      "INCOME_CREATE_SUCCESS", "INCOME_UPDATE_SUCCESS", "INCOME_DELETE_SUCCESS",
      "PAYMENT_CREATE_SUCCESS", "PAYMENT_UPDATE_SUCCESS", "INSTALLMENT_PAY_SUCCESS", "DEBT_CREATE_SUCCESS", "DEBT_UPDATE_SUCCESS",
      "ACCOUNT_TRANSFER_SUCCESS", "ASSET_CREATE_SUCCESS", "ASSET_UPDATE_SUCCESS", "ASSET_DELETE_SUCCESS", "PROJECT_COMPLETE_SUCCESS",
      "HABIT_CHECKIN_SUCCESS", "HABIT_UNDO_SUCCESS", "TIME_TIMER_START_SUCCESS", "TIME_TIMER_STOP_SUCCESS",
      "EVENT_CREATE_SUCCESS", "EVENT_UPDATE_SUCCESS", "EVENT_DELETE_SUCCESS",
      "SYNC_STARTED", "SYNC_PULL_STARTED", "SYNC_PULL_SUCCESS", "SYNC_PUSH_STARTED", "SYNC_PUSH_SUCCESS", "SYNC_COMPLETED", "SYNC_SUCCESS",
      "SYNC_FAILED", "SYNC_RETRY", "SYNC_CONFLICT", "SYNC_PARTIAL_SUCCESS", "SYNC_PAYLOAD_REJECTED", "SYNC_SIZE_LIMIT_EXCEEDED", "SYNC_PENDING",
      "NOTIFICATION_CREATED", "NOTIFICATION_ACTIVATED", "NOTIFICATION_READ", "NOTIFICATION_SCHEDULED", "NOTIFICATION_FAILED",
      "LOCAL_NOTIFICATION_SCHEDULED", "LOCAL_NOTIFICATION_RESCHEDULED", "LOCAL_NOTIFICATION_CANCELLED", "LOCAL_NOTIFICATION_FAILED",
      "WIDGET_ACTION_RECEIVED", "WIDGET_QUEUE_ADDED", "WIDGET_QUEUE_PROCESSED", "WIDGET_QUEUE_FAILED",
      "BACKUP_STARTED", "BACKUP_COMPLETED", "BACKUP_FAILED", "RESTORE_STARTED", "RESTORE_COMPLETED", "RESTORE_PARTIAL", "RESTORE_FAILED",
      "REPORT_GENERATION_STARTED", "REPORT_GENERATION_COMPLETED", "REPORT_GENERATION_FAILED", "REPORT_SLOW",
      "DB_CONNECTION_ERROR", "DB_QUERY_ERROR", "DB_TRANSACTION_FAILED", "DB_TRANSACTION_ROLLBACK", "DB_SLOW_QUERY", "DB_CONNECTION_POOL_EXHAUSTED",
      "HTTP_REQUEST_COMPLETED", "EXPORT_STARTED", "IMPORT_STARTED",
    ];
    for (const name of required) expect(isEventName(name), name).toBe(true);
  });

  it("matches LOCAL_NOTIFICATION_* to its own domain, not a shorter one", () => {
    expect(domainOf("LOCAL_NOTIFICATION_FAILED")).toBe("LOCAL_NOTIFICATION");
    expect(domainOf("NOTIFICATION_FAILED")).toBe("NOTIFICATION");
    expect(domainOf("DB_SLOW_QUERY")).toBe("DB");
    expect(domainOf("DBX_SLOW_QUERY")).toBeUndefined();
    expect(domainOf("SYNC")).toBeUndefined();
  });

  it("marks security events and failures as protected from sampling, and only request-rate events as thinnable", () => {
    for (const name of EVENT_NAMES.filter((n) => n.startsWith("AUTH_"))) expect(EVENTS[name].protected, name).toBe(true);
    for (const name of ["SYNC_FAILED", "SYNC_PAYLOAD_REJECTED", "AUDIT_WRITE_FAILED", "DB_QUERY_ERROR", "API_UNHANDLED_ERROR"] as const) expect(EVENTS[name].protected, name).toBe(true);
    expect(EVENT_NAMES.filter((n) => EVENTS[n].highVolume).sort()).toEqual([
      "HTTP_REQUEST_COMPLETED",
      "HTTP_REQUEST_STARTED",
      "LOCAL_NOTIFICATION_CANCELLED",
      "LOCAL_NOTIFICATION_RESCHEDULED",
      "LOCAL_NOTIFICATION_SCHEDULED",
    ]);
  });

  it("maps every domain to a module, so FINANCE=INFO reaches all money events", () => {
    for (const domain of DOMAINS) expect(MODULE_OF_DOMAIN[domain], domain).toBeTruthy();
    for (const domain of ["ACCOUNT", "TRANSACTION", "EXPENSE", "INCOME", "INSTALLMENT", "DEBT", "PAYMENT"] as const) expect(moduleOfDomain(domain)).toBe("finance");
    expect(moduleOfDomain("SYNC")).toBe("sync");
    expect(moduleOfDomain(undefined)).toBeUndefined();
  });

  it("looks up metadata and humanises names for the fallback message", () => {
    expect(eventMeta("SYNC_FAILED")?.level).toBe("ERROR");
    expect(eventMeta("NOT_AN_EVENT")).toBeUndefined();
    expect(humanizeEvent("TASK_CREATE_SUCCESS")).toBe("Task create success.");
  });

  it("rejects malformed names", () => {
    expect(validateEventName("task_create_success")).not.toEqual([]);
    expect(validateEventName("TASK")).not.toEqual([]);
    expect(validateEventName("MYSTERY_THING_HAPPENED")).toContain("must start with a known domain");
  });
});

describe("error codes", () => {
  it("are DOMAIN-NNN, unique, with a unique name per domain and a description", () => {
    const codes = Object.keys(ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    const seenNames = new Set<string>();
    for (const code of codes) {
      expect(ERROR_CODE_PATTERN.test(code), code).toBe(true);
      const meta = errorCodeMeta(code as keyof typeof ERROR_CODES);
      expect(meta.name).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(meta.description.length).toBeGreaterThan(10);
      const key = `${code.split("-")[0]}:${meta.name}`;
      expect(seenNames.has(key), key).toBe(false);
      seenNames.add(key);
      if (meta.httpStatus !== undefined) expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
    }
  });

  it("keeps the numbers the requirements name", () => {
    expect(ERROR_CODES["AUTH-001"].name).toBe("INVALID_CREDENTIALS");
    expect(ERROR_CODES["AUTH-002"].name).toBe("RATE_LIMITED");
    expect(ERROR_CODES["AUTH-003"].name).toBe("SESSION_INVALID");
    for (const code of ["DB-001", "SYNC-001", "SYNC-002", "TASK-001", "FIN-001", "NOTIF-001"]) expect(isErrorCode(code), code).toBe(true);
  });

  it("recognises its own codes only", () => {
    expect(isErrorCode("SYNC-002")).toBe(true);
    expect(isErrorCode("SYNC-999")).toBe(false);
    expect(isErrorCode("nope")).toBe(false);
    expect(isErrorCode(2)).toBe(false);
  });

  it("maps the sync error kinds", () => {
    expect(syncErrorCode("network")).toBe("SYNC-001");
    expect(syncErrorCode("server")).toBe("SYNC-002");
    expect(syncErrorCode("auth")).toBe("SYNC-003");
    expect(syncErrorCode("too-large")).toBe("SYNC-004");
    expect(syncErrorCode("unknown")).toBe("SYNC-009");
  });

  it("classifies well-known exceptions by shape, with no imports of zod, Prisma or the auth module", () => {
    expect(classifyError({ name: "ZodError" })).toBe("VAL-001");
    expect(classifyError({ name: "AuthError" })).toBe("AUTH-003");
    expect(classifyError({ code: "P2002" })).toBe("DB-005");
    expect(classifyError({ code: "P2003" })).toBe("DB-006");
    expect(classifyError({ code: "P2025" })).toBe("DB-007");
    expect(classifyError({ code: "P2024" })).toBe("DB-004");
    for (const code of ["P1001", "P1002", "P1008", "P1017"]) expect(classifyError({ code })).toBe("DB-001");
    expect(classifyError({ code: "P2010" })).toBe("DB-002");
    expect(classifyError({ code: "ECONNRESET" })).toBeNull();
    expect(classifyError(new Error("x"))).toBeNull();
    expect(classifyError(null)).toBeNull();
    expect(classifyError("string")).toBeNull();
  });
});
