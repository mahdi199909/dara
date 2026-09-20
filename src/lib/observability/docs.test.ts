// The reference documents are generated from the registries; this fails when they are stale.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSourceFiles } from "../../../scripts/logs/sourceFiles";
import { findUsages, renderErrorCodesDoc, renderEventsDoc } from "./docsGenerator";
import { ERROR_CODES } from "./core/errorCodes";
import { EVENT_NAMES } from "./core/events";

const REGENERATE = "Run:  npx tsx scripts/logs/generate-docs.ts";
const read = (name: string) => readFileSync(join(process.cwd(), "doc", "logging", name), "utf8").replace(/\r\n/g, "\n");
const usage = findUsages(readSourceFiles());

describe("logging reference documents", () => {
  it("events.md matches the event catalogue and what the code emits", () => {
    expect(read("events.md"), REGENERATE).toBe(renderEventsDoc(usage.events));
  });

  it("error-codes.md matches the error code registry and what the code emits", () => {
    expect(read("error-codes.md"), REGENERATE).toBe(renderErrorCodesDoc(usage.codes));
  });

  it("lists every event and every code", () => {
    const events = read("events.md");
    for (const name of EVENT_NAMES) expect(events, name).toContain(`\`${name}\``);
    const codes = read("error-codes.md");
    for (const code of Object.keys(ERROR_CODES)) expect(codes, code).toContain(`\`${code}\``);
  });

  it("finds the events the replaced console calls now write", () => {
    for (const event of ["API_UNHANDLED_ERROR", "AUDIT_WRITE_FAILED", "SYNC_FAILED", "SYNC_PULL_ROW_FAILED", "WIDGET_QUEUE_FAILED", "WIDGET_REFRESH_FAILED", "LOCAL_NOTIFICATION_FAILED", "DB_LOCAL_RECOVERED", "IMPORT_ROW_FAILED", "LOG_LEVEL_CHANGED"]) {
      expect(usage.events.has(event), event).toBe(true);
    }
    for (const code of ["SYS-001", "AUDIT-001", "SYNC-001", "SYNC-008", "WIDGET-001", "WIDGET-002", "NOTIF-001", "DB-008"]) expect(usage.codes.has(code), code).toBe(true);
  });
});
