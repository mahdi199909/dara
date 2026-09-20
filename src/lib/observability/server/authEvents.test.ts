import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMemoryLogger } from "../testing";
import { beginRequest, runWithRequestContext } from "./requestContext";
import { emailPseudonym, logForbidden, logLoginFailed, logLoginSuccess, logLogout, logRateLimited, logRegisterFailed, logRegisterSuccess, logSessionInvalid } from "./authEvents";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  memory.restore();
  delete process.env.LOG_HASH_SECRET;
});

describe("emailPseudonym", () => {
  it("is stable, case- and space-insensitive, and never contains the address", () => {
    const a = emailPseudonym("Ali@Example.com");
    expect(a).toMatch(/^em_[0-9a-f]{12}$/);
    expect(emailPseudonym("  ali@example.com ")).toBe(a);
    expect(a).not.toContain("ali");
    expect(emailPseudonym("sara@example.com")).not.toBe(a);
  });

  it("depends on the server's secret, so the logs alone cannot be used to test guessed addresses", () => {
    const withDefault = emailPseudonym("ali@example.com");
    process.env.LOG_HASH_SECRET = "another-secret";
    expect(emailPseudonym("ali@example.com")).not.toBe(withDefault);
  });
});

describe("auth events", () => {
  const email = "ali@example.com";

  it("logs a failed login as a security WARN with the reason, a hash, and the IP — never the address", () => {
    logLoginFailed({ email, reason: "wrong_password", ip: "203.0.113.7" });
    const [record] = memory.sink.find("AUTH_LOGIN_FAILED");
    expect(record).toMatchObject({ level: "WARN", module: "auth", error_code: "AUTH-001", metadata: { reason: "wrong_password", ip: "203.0.113.7", emailHash: emailPseudonym(email) } });
    expect(JSON.stringify(record)).not.toContain("ali@");
  });

  it("logs throttling with AUTH-002", () => {
    logRateLimited({ email, ip: "203.0.113.7" });
    expect(memory.sink.find("AUTH_RATE_LIMITED")[0]).toMatchObject({ level: "WARN", error_code: "AUTH-002", metadata: { ip: "203.0.113.7" } });
  });

  it("logs a duplicate registration with AUTH-005", () => {
    logRegisterFailed({ email, reason: "email_taken", ip: null });
    expect(memory.sink.find("AUTH_REGISTER_FAILED")[0]).toMatchObject({ level: "WARN", error_code: "AUTH-005", metadata: { reason: "email_taken", emailHash: emailPseudonym(email) } });
  });

  it("logs a missing or invalid session with AUTH-003", () => {
    logSessionInvalid("missing");
    logSessionInvalid("invalid");
    expect(memory.sink.find("AUTH_SESSION_INVALID").map((r) => [r.level, r.error_code, r.metadata.reason])).toEqual([
      ["WARN", "AUTH-003", "missing"],
      ["WARN", "AUTH-003", "invalid"],
    ]);
  });

  it("puts the user on the record once known, and the code on the request for its completion line", () => {
    const context = beginRequest(new Request("http://localhost/api/auth/login", { method: "POST" }), "POST", "/api/auth/login");
    runWithRequestContext(context, () => {
      logLoginFailed({ email, reason: "no_such_user", ip: null });
      logLoginSuccess({ userId: "usr_7", ip: "198.51.100.2" });
    });
    expect(context.errorCode).toBe("AUTH-001");
    expect(context.userId).toBe("usr_7");
    expect(memory.sink.find("AUTH_LOGIN_SUCCESS")[0]).toMatchObject({ level: "INFO", user_id: "usr_7", request_id: context.requestId });
  });

  it("records the owner-only refusal against the signed-in user", () => {
    const context = beginRequest(new Request("http://localhost/api/admin/license"), "GET", "/api/admin/license");
    runWithRequestContext(context, () => logForbidden({ userId: "usr_9", what: "admin" }));
    expect(memory.sink.find("AUTH_FORBIDDEN")[0]).toMatchObject({ level: "WARN", error_code: "AUTH-004", user_id: "usr_9", metadata: { what: "admin" } });
  });

  it("logs registration, and sign-out with or without a known user", () => {
    logRegisterSuccess({ userId: "usr_1", ip: null });
    logLogout({ userId: "usr_1" });
    logLogout({});
    expect(memory.sink.events()).toEqual(["AUTH_REGISTER_SUCCESS", "AUTH_LOGOUT_SUCCESS", "AUTH_LOGOUT_SUCCESS"]);
  });

  it("marks these as security events, so sampling can never drop them", async () => {
    const { eventMeta } = await import("../core/events");
    for (const event of ["AUTH_LOGIN_FAILED", "AUTH_RATE_LIMITED", "AUTH_SESSION_INVALID", "AUTH_FORBIDDEN", "AUTH_REGISTER_FAILED", "AUTH_LOGIN_SUCCESS"]) {
      expect(eventMeta(event)?.security, event).toBe(true);
    }
  });
});
