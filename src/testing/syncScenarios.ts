// Shared building blocks for the end-to-end sync suites (see syncHarness.ts): linking a simulated
// phone to a server account exactly the way first-run does, running the real syncWithServer(), and
// comparing what the web app and the phone would each show.
import { expect } from "vitest";
import { syncWithServer, type SyncOutcome } from "@/lib/nativeOnboarding";
import { setLinkedAccount } from "@/local/accountSwitch";
import type { HttpResult, Phone, ServerHarness } from "@/testing/syncHarness";

export interface Account {
  userId: string;
  token: string;
  email: string;
}

/** Puts the phone in the state FirstRunGate leaves it in after a successful login: license cache
 * with the account's token, and the device remembered as linked to that account. Doesn't sync. */
export function linkPhone(phone: Phone, account: Account): void {
  phone.must("POST", "/api/local/license-cache", {
    status: "TRIAL",
    trialDaysRemaining: 30,
    trialEndsAt: null,
    currentPeriodEnd: null,
    remoteUserId: account.userId,
    remoteEmail: account.email,
    token: account.token,
  });
  setLinkedAccount(phone.db, { remoteUserId: account.userId, email: account.email });
}

/** The real production entry point, run against this phone. */
export async function syncPhone(phone: Phone, options: { deep?: boolean } = { deep: true }): Promise<SyncOutcome> {
  phone.activate();
  return syncWithServer(options);
}

export async function syncUntilQuiet(phone: Phone, maxRounds = 4): Promise<SyncOutcome[]> {
  const rounds: SyncOutcome[] = [];
  for (let i = 0; i < maxRounds; i++) {
    const outcome = await syncPhone(phone);
    rounds.push(outcome);
    if (outcome.ok && outcome.pushedCount === 0 && outcome.pulledCount === 0 && outcome.deletionsPulled === 0 && outcome.deletionsPushed === 0) break;
  }
  return rounds;
}

// ---------------------------------------------------------------------------------------------
// Parity: does the phone show what the web shows?
// ---------------------------------------------------------------------------------------------

const VOLATILE_KEYS = new Set(["userId"]);
// The phone's repositories hand nested rows back exactly as SQLite stores them (0/1), the web's
// Prisma returns real booleans — a representation difference, not a data difference.
const BOOLEAN_KEYS = new Set(["isActive", "generatesVirtualAsset", "isRunning", "isTrial", "allDay", "isCancelled", "notified", "dismissed", "dailyMomentEnabled", "companionEnabled"]);

/** Order- and noise-free form of a JSON value: what would cross the wire (Dates become strings),
 * arrays of objects with ids sort by id, userId (a real id on the server, a placeholder on the
 * phone) is dropped, and 0/1 in boolean-named fields compares equal to real booleans. */
export function normalize(value: unknown, ignore: ReadonlySet<string> = new Set()): unknown {
  const wire = value === undefined ? null : JSON.parse(JSON.stringify(value));
  return walk(wire, ignore);
}

function walk(value: unknown, ignore: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => walk(v, ignore));
    if (items.every((i) => i && typeof i === "object" && "id" in (i as object))) {
      return [...items].sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)));
    }
    return items;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      if (VOLATILE_KEYS.has(k) || ignore.has(k)) continue;
      out[k] = BOOLEAN_KEYS.has(k) && (v === 0 || v === 1) ? v === 1 : walk(v, ignore);
    }
    return out;
  }
  return value;
}

export interface ParityOptions {
  /** Field names to leave out of the comparison (e.g. server-only bookkeeping). */
  ignore?: string[];
}

/** Fetches the same list endpoint from the web (real route handler + Postgres-shaped DB) and from
 * the phone (real on-device repository) and returns both, normalized, plus whether they match. */
export async function compareEndpoint(server: ServerHarness, phone: Phone, url: string, options: ParityOptions = {}) {
  const ignore = new Set(options.ignore ?? []);
  const web: HttpResult = await server.web("GET", url);
  const local: HttpResult = phone.request("GET", url);
  return {
    url,
    web: normalize(web.json, ignore),
    phone: normalize(local.json, ignore),
    webStatus: web.status,
    phoneStatus: local.status,
  };
}

export async function expectEndpointParity(server: ServerHarness, phone: Phone, url: string, options: ParityOptions = {}) {
  const c = await compareEndpoint(server, phone, url, options);
  expect(c.webStatus, `web GET ${url}`).toBeLessThan(400);
  expect(c.phoneStatus, `phone GET ${url}`).toBeLessThan(400);
  expect(c.phone, `phone vs web for ${url}`).toEqual(c.web);
}

export function iso(offsetDays: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
