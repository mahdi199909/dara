import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_VOCABULARY, auditEntryFor, auditEntryForEvent, auditEventFor, resolveAuditIdentity } from "./auditVocabulary";
import { isEventName } from "./events";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("the audit vocabulary", () => {
  it("has one row per (entityType, action) pair and one per canonical event", () => {
    const pairs = AUDIT_VOCABULARY.map((row) => `${row.entityType}|${row.action}`);
    const events = AUDIT_VOCABULARY.map((row) => row.event);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(new Set(events).size).toBe(events.length);
  });

  it("names facts in the past tense, DOMAIN_WORD style, and points only at events the log catalogue has", () => {
    for (const row of AUDIT_VOCABULARY) {
      expect(row.event, row.event).toMatch(/^[A-Z]+(?:_[A-Z]+)+$/);
      expect(row.event, row.event).toMatch(/(?:ED|DONE|PAID|_IN|_OUT)$/);
      if (row.logEvent) expect(isEventName(row.logEvent), row.logEvent).toBe(true);
    }
  });

  it("gives every operation-style log event to at most one fact", () => {
    const logEvents = AUDIT_VOCABULARY.filter((row) => row.logEvent).map((row) => row.logEvent);
    expect(new Set(logEvents).size).toBe(logEvents.length);
  });

  it("covers every audited write in the code, server and phone alike", () => {
    const known = new Set(AUDIT_VOCABULARY.map((row) => `${row.entityType}|${row.action}`));
    const missing: string[] = [];
    let calls = 0;
    for (const file of [...sourceFiles(path.join(ROOT, "src", "app", "api")), ...sourceFiles(path.join(ROOT, "src", "local")), ...sourceFiles(path.join(ROOT, "src", "lib"))]) {
      const text = readFileSync(file, "utf8");
      for (const call of text.matchAll(/(?:writeAuditLog|writeLocalAuditLog)\(([\s\S]*?)\n?\s*\}\s*\)/g)) {
        const body = call[1];
        const entity = /entityType:\s*"([^"]+)"/.exec(body)?.[1];
        const actionExpression = /action:\s*([\s\S]*?)(?=,\s*(?:entityType|entityId|oldValue|newValue|metadata|userId|ipAddress|userAgent|source|changes|event)\s*:)/.exec(body)?.[1];
        if (!entity || !actionExpression) continue; // the writers' own bodies, which use params.*
        calls++;
        // An action is either one literal or a chain of conditions whose branches are literals; the operands of the conditions ("INCOME" in body.type === "INCOME") are not actions.
        const literals = [...actionExpression.matchAll(/(?:^\s*|[?:]\s*)"([A-Z_]+)"/g)].map((match) => match[1]);
        expect(literals.length, `no action literal in ${path.relative(ROOT, file)}: ${actionExpression}`).toBeGreaterThan(0);
        for (const literal of literals) {
          if (!known.has(`${entity}|${literal}`)) missing.push(`${path.relative(ROOT, file)}: ${entity} / ${literal}`);
        }
      }
    }
    expect(calls).toBeGreaterThan(80);
    expect(missing, "add these pairs to AUDIT_VOCABULARY (src/lib/observability/core/auditVocabulary.ts)").toEqual([]);
  });

  it("covers every event the audit.log() facade is called with", () => {
    const unknown: string[] = [];
    let calls = 0;
    for (const file of sourceFiles(path.join(ROOT, "src", "app", "api"))) {
      for (const call of readFileSync(file, "utf8").matchAll(/audit\.log\(\{([\s\S]*?)\}\s*\)/g)) {
        calls++;
        for (const event of call[1].matchAll(/event:\s*"([A-Z_]+)"/g)) {
          if (!auditEntryForEvent(event[1])) unknown.push(`${path.relative(ROOT, file)}: ${event[1]}`);
        }
      }
    }
    expect(calls).toBeGreaterThan(3);
    expect(unknown).toEqual([]);
  });

  it("is documented: doc/logging/audit.md names every fact and every log event", () => {
    const doc = readFileSync(path.join(ROOT, "doc", "logging", "audit.md"), "utf8");
    const names = AUDIT_VOCABULARY.flatMap((row) => [row.event, row.logEvent]).filter((name): name is string => Boolean(name));
    const undocumented = names.filter((name) => !doc.includes(`\`${name}\``));
    expect(undocumented, "add these to the vocabulary table in doc/logging/audit.md").toEqual([]);
  });

  it("has no row nobody writes (a stale entry hides a removed feature)", () => {
    const used = new Set<string>();
    for (const file of [...sourceFiles(path.join(ROOT, "src", "app", "api")), ...sourceFiles(path.join(ROOT, "src", "local")), ...sourceFiles(path.join(ROOT, "src", "lib")), ...sourceFiles(path.join(ROOT, "src", "components"))]) {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(path.join("core", "auditVocabulary.ts"))) continue;
      for (const match of text.matchAll(/"([A-Z][A-Z_]+)"/g)) used.add(match[1]);
    }
    const stale = AUDIT_VOCABULARY.filter((row) => !used.has(row.action) && !used.has(row.event)).map((row) => `${row.entityType} / ${row.action}`);
    expect(stale).toEqual([]);
  });
});

describe("lookups", () => {
  it("finds a row by its legacy pair and by its canonical event", () => {
    expect(auditEntryFor("Task", "COMPLETE_TASK")?.event).toBe("TASK_COMPLETED");
    expect(auditEntryForEvent("TASK_COMPLETED")).toMatchObject({ action: "COMPLETE_TASK", entityType: "Task", logEvent: "TASK_COMPLETE_SUCCESS" });
    expect(auditEntryFor("Nothing", "CREATE")).toBeUndefined();
    expect(auditEntryForEvent("NOTHING_HAPPENED")).toBeUndefined();
  });

  it("derives a stable name for a pair that is not in the table yet", () => {
    expect(auditEventFor("Task", "UPDATE")).toBe("TASK_UPDATED");
    expect(auditEventFor("SavedFilter", "CREATE")).toBe("SAVED_FILTER_CREATE");
    expect(auditEventFor("Task", "do-something")).toBe("TASK_DO_SOMETHING");
  });
});

describe("resolveAuditIdentity", () => {
  it("keeps a legacy action as it is and adds the canonical event and log event", () => {
    expect(resolveAuditIdentity({ action: "UPDATE", entityType: "Task" })).toEqual({ action: "UPDATE", entityType: "Task", event: "TASK_UPDATED", logEvent: "TASK_UPDATE_SUCCESS" });
  });

  it("maps a canonical event back to the legacy action History labels", () => {
    expect(resolveAuditIdentity({ event: "CATEGORIES_REORDERED" })).toEqual({ action: "REORDER", entityType: "Category", event: "CATEGORIES_REORDERED", logEvent: "CATEGORY_REORDER_SUCCESS" });
    expect(resolveAuditIdentity({ event: "EXPENSE_CREATED", entityType: "Transaction" }).action).toBe("CREATE_EXPENSE");
  });

  it("copes with a pair it has never seen and with nothing at all", () => {
    expect(resolveAuditIdentity({ action: "ARCHIVE", entityType: "Note" })).toEqual({ action: "ARCHIVE", entityType: "Note", event: "NOTE_ARCHIVE", logEvent: undefined });
    expect(resolveAuditIdentity({})).toMatchObject({ action: "UNKNOWN", entityType: "Unknown" });
    expect(resolveAuditIdentity({ event: "SOMETHING_ODD", entityType: "Thing" })).toMatchObject({ action: "SOMETHING_ODD", event: "SOMETHING_ODD" });
  });
});
