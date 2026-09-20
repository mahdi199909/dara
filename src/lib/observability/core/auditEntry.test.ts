import { describe, expect, it } from "vitest";
import { MAX_CHANGES_CHARS, buildAuditChanges, maskMoneyInSnapshot, parseAuditMoneyMode, serializeChanges } from "./auditEntry";
import { REDACTED_MONEY } from "./redact";

const before = { id: "t1", userId: "u1", title: "Buy a laptop", status: "TODO", amount: 25_000_000, directCost: 0, notes: null, updatedAt: "2026-09-01T10:00:00.000Z", createdAt: "2026-08-01T10:00:00.000Z" };
const after = { ...before, title: "Buy a better laptop", status: "DONE", amount: 27_500_000, notes: "with a warranty", updatedAt: "2026-09-20T10:00:00.000Z" };

describe("parseAuditMoneyMode", () => {
  it("defaults to keeping values, and accepts the two masking modes in any case", () => {
    expect(parseAuditMoneyMode(undefined)).toBe("values");
    expect(parseAuditMoneyMode("")).toBe("values");
    expect(parseAuditMoneyMode("nonsense")).toBe("values");
    expect(parseAuditMoneyMode("Redacted")).toBe("redacted");
    expect(parseAuditMoneyMode(" FLAG ")).toBe("flag");
    expect(parseAuditMoneyMode("values")).toBe("values");
  });
});

describe("buildAuditChanges", () => {
  it("records only the fields that changed, with real values by default, and skips bookkeeping fields", () => {
    const result = buildAuditChanges(before, after)!;
    expect(result.changedFields.sort()).toEqual(["amount", "notes", "status", "title"]);
    expect(result.changes.title).toEqual({ from: "Buy a laptop", to: "Buy a better laptop" });
    expect(result.changes.amount).toEqual({ from: 25_000_000, to: 27_500_000 });
    expect(result.changes.notes).toEqual({ from: null, to: "with a warranty" });
    expect(result.changes).not.toHaveProperty("updatedAt");
    expect(result.changes).not.toHaveProperty("id");
    expect(result.changes).not.toHaveProperty("directCost"); // unchanged
  });

  it("masks money as [REDACTED_MONEY] in redacted mode, and reduces it to 'changed' in flag mode", () => {
    expect(buildAuditChanges(before, after, "redacted")!.changes.amount).toEqual({ from: REDACTED_MONEY, to: REDACTED_MONEY });
    expect(buildAuditChanges(before, after, "flag")!.changes.amount).toEqual({ changed: true });
    // …and leaves everything that is not money readable in both.
    expect(buildAuditChanges(before, after, "flag")!.changes.title).toEqual({ from: "Buy a laptop", to: "Buy a better laptop" });
  });

  it("only ever flags a secret, whatever the mode", () => {
    const result = buildAuditChanges({ name: "a", passwordHash: "$2a$12$old" }, { name: "a", passwordHash: "$2a$12$new" })!;
    expect(result.changes.passwordHash).toEqual({ changed: true });
    expect(JSON.stringify(result)).not.toContain("$2a$");
  });

  it("has no diff for a creation or a deletion — the snapshot beside it says everything", () => {
    expect(buildAuditChanges(null, after)).toBeNull();
    expect(buildAuditChanges(before, undefined)).toBeNull();
    expect(buildAuditChanges("a", "b")).toBeNull();
    expect(buildAuditChanges([1], [2])).toBeNull();
  });

  it("says so when nothing changed", () => {
    expect(buildAuditChanges(before, { ...before, updatedAt: "later" })).toEqual({ changedFields: [], changes: {} });
  });

  it("compares dates by instant, so a Date and its ISO string of another format are not a change", () => {
    const a = { dueDate: new Date("2026-09-20T10:00:00.000Z") };
    const b = { dueDate: new Date("2026-09-20T10:00:00.000Z") };
    expect(buildAuditChanges(a, b)!.changedFields).toEqual([]);
    expect(buildAuditChanges(a, { dueDate: new Date("2026-09-21T10:00:00.000Z") })!.changedFields).toEqual(["dueDate"]);
  });

  it("scrubs a secret that turns up inside a text value", () => {
    const result = buildAuditChanges({ notes: "x" }, { notes: "token eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1In0.sig12345 and card" })!;
    expect(JSON.stringify(result)).not.toContain("eyJhbGci");
  });
});

describe("serializeChanges", () => {
  it("is null without a diff and JSON with one", () => {
    expect(serializeChanges(null)).toBeNull();
    expect(JSON.parse(serializeChanges({ changedFields: ["a"], changes: { a: { from: 1, to: 2 } } })!)).toEqual({ changedFields: ["a"], changes: { a: { from: 1, to: 2 } } });
  });

  it("reduces an enormous diff to the list of changed fields", () => {
    const huge = { changedFields: ["notes"], changes: { notes: { from: "x".repeat(MAX_CHANGES_CHARS), to: "y" } } };
    expect(JSON.parse(serializeChanges(huge)!)).toEqual({ changedFields: ["notes"], changes: {}, truncated: true });
  });

  it("never throws on something that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeChanges({ changedFields: ["x"], changes: { x: { from: circular, to: 1 } } })).not.toThrow();
  });
});

describe("maskMoneyInSnapshot", () => {
  const snapshot = { title: "Laptop", amount: 25_000_000, nested: { balance: 5, note: "n" }, list: [{ price: 9 }], empty: { amount: null } };

  it("returns the snapshot untouched by default", () => {
    expect(maskMoneyInSnapshot(snapshot, "values")).toBe(snapshot);
  });

  it("masks money fields at any depth in the other modes, and nothing else", () => {
    for (const mode of ["redacted", "flag"] as const) {
      expect(maskMoneyInSnapshot(snapshot, mode)).toEqual({ title: "Laptop", amount: REDACTED_MONEY, nested: { balance: REDACTED_MONEY, note: "n" }, list: [{ price: REDACTED_MONEY }], empty: { amount: null } });
    }
  });

  it("passes non-records through", () => {
    expect(maskMoneyInSnapshot("text", "redacted")).toBe("text");
    expect(maskMoneyInSnapshot(null, "redacted")).toBeNull();
    const date = new Date();
    expect(maskMoneyInSnapshot({ when: date }, "redacted")).toEqual({ when: date });
  });
});
