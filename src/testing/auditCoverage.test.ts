// Guard: every API route that changes data leaves an audit entry — or is on the list below with the
// reason it does not. A new POST/PATCH/DELETE route that forgets its audit call fails here, and so does
// an exemption whose route has since been audited or removed. (Lives in src/testing, which the Android
// export deletes together with the routes it scans.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(__dirname, "..", "app", "api");

/** Routes that change data without an audit entry, and why. Paths are relative to src/app/api. */
const EXEMPT: Record<string, string> = {
  "notifications/[id]/read/route.ts": "marking a notification read is interface state, not a change to the person's data",
  "sync/push/route.ts":
    "it applies rows a device already recorded in its own history; the server's application log keeps a per-push summary (SYNC_PUSH_SUCCESS / SYNC_PARTIAL_SUCCESS). A durable per-push audit entry waits for phase 4, when a push carries a device and a sync id",
};

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

function changesData(text: string): boolean {
  return /withApiLogging\("(?:POST|PATCH|PUT|DELETE)"/.test(text);
}

function auditsItsWrites(text: string): boolean {
  return /\bwriteAuditLog\(/.test(text) || /\baudit\.log\(/.test(text);
}

describe("audit coverage of the API", () => {
  const routes = routeFiles(API_ROOT).map((file) => ({ relative: path.relative(API_ROOT, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));

  it("finds the routes it is meant to guard", () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(routes.filter((route) => changesData(route.text)).length).toBeGreaterThan(30);
  });

  it("gives every route that changes data an audit entry, unless it is listed as exempt", () => {
    const unaudited = routes.filter((route) => changesData(route.text) && !auditsItsWrites(route.text) && !(route.relative in EXEMPT)).map((route) => route.relative);
    expect(unaudited, "add writeAuditLog/audit.log to these routes (see doc/logging/audit.md), or list them in EXEMPT with the reason").toEqual([]);
  });

  it("keeps the exemptions honest: each one still exists and still lacks an audit call", () => {
    for (const relative of Object.keys(EXEMPT)) {
      const route = routes.find((candidate) => candidate.relative === relative);
      expect(route, `${relative} no longer exists — remove it from EXEMPT`).toBeDefined();
      expect(changesData(route!.text), `${relative} no longer changes data — remove it from EXEMPT`).toBe(true);
      expect(auditsItsWrites(route!.text), `${relative} is audited now — remove it from EXEMPT`).toBe(false);
    }
  });
});
