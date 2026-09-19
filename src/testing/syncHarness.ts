// Test-only rig that runs the REAL phone-side code (local repositories via dispatchLocal, and
// src/local/sync.ts's push/pull) against the REAL server-side code (the actual Next.js route
// handlers under src/app/api, backed by a real Prisma client on a scratch SQLite file) inside one
// Node process — no HTTP server, no mocks of app logic. The only stand-ins are: next/headers'
// cookies() (see cookieJar.ts; each test file must vi.mock("next/headers") to delegate to it) and
// global fetch, which is routed into the route handlers in-process and can simulate the production
// reverse proxy's request-body cap (nginx's 1 MB default is what actually rejected real syncs).
//
// Why this exists: src/local/sync.test.ts mocks fetch and therefore never exercised what the
// server does with the exact row shapes a phone really sends (e.g. SQLite's 0/1 booleans).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { vi } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "@/local/db";
import { createNodeSqliteDriver } from "@/local/drivers/nodeSqlite";
import { dispatchLocal, setLocalDbDriver } from "@/lib/localDispatcher";
import { getLocalUserId } from "@/local/localUser";
import { cookieJar } from "./cookieJar";

type AnyModule = any;
type Loader = () => Promise<AnyModule>;

const ROUTE_DEFS: Array<{ pattern: string; load: Loader }> = [
  { pattern: "/api/auth/register", load: () => import("@/app/api/auth/register/route") },
  { pattern: "/api/auth/login", load: () => import("@/app/api/auth/login/route") },
  { pattern: "/api/license/status", load: () => import("@/app/api/license/status/route") },
  { pattern: "/api/sync/push", load: () => import("@/app/api/sync/push/route") },
  { pattern: "/api/sync/pull", load: () => import("@/app/api/sync/pull/route") },
  { pattern: "/api/accounts", load: () => import("@/app/api/accounts/route") },
  { pattern: "/api/accounts/:id", load: () => import("@/app/api/accounts/[id]/route") },
  { pattern: "/api/activities", load: () => import("@/app/api/activities/route") },
  { pattern: "/api/activities/:id", load: () => import("@/app/api/activities/[id]/route") },
  { pattern: "/api/activities/:id/time-entries", load: () => import("@/app/api/activities/[id]/time-entries/route") },
  { pattern: "/api/activities/:id/timer/start", load: () => import("@/app/api/activities/[id]/timer/start/route") },
  { pattern: "/api/activities/:id/timer/stop", load: () => import("@/app/api/activities/[id]/timer/stop/route") },
  { pattern: "/api/assets", load: () => import("@/app/api/assets/route") },
  { pattern: "/api/assets/:id", load: () => import("@/app/api/assets/[id]/route") },
  { pattern: "/api/categories", load: () => import("@/app/api/categories/route") },
  { pattern: "/api/categories/reorder", load: () => import("@/app/api/categories/reorder/route") },
  { pattern: "/api/categories/:id", load: () => import("@/app/api/categories/[id]/route") },
  { pattern: "/api/events", load: () => import("@/app/api/events/route") },
  { pattern: "/api/events/:id", load: () => import("@/app/api/events/[id]/route") },
  { pattern: "/api/events/:id/complete", load: () => import("@/app/api/events/[id]/complete/route") },
  { pattern: "/api/events/:id/reminders", load: () => import("@/app/api/events/[id]/reminders/route") },
  { pattern: "/api/reminders/:id", load: () => import("@/app/api/reminders/[id]/route") },
  { pattern: "/api/habits", load: () => import("@/app/api/habits/route") },
  { pattern: "/api/habits/:id", load: () => import("@/app/api/habits/[id]/route") },
  { pattern: "/api/habits/:id/checkin", load: () => import("@/app/api/habits/[id]/checkin/route") },
  { pattern: "/api/installment-plans", load: () => import("@/app/api/installment-plans/route") },
  { pattern: "/api/installment-plans/:id", load: () => import("@/app/api/installment-plans/[id]/route") },
  { pattern: "/api/installments/:id/pay", load: () => import("@/app/api/installments/[id]/pay/route") },
  { pattern: "/api/projects", load: () => import("@/app/api/projects/route") },
  { pattern: "/api/projects/:id", load: () => import("@/app/api/projects/[id]/route") },
  { pattern: "/api/settings", load: () => import("@/app/api/settings/route") },
  { pattern: "/api/tasks", load: () => import("@/app/api/tasks/route") },
  { pattern: "/api/tasks/:id", load: () => import("@/app/api/tasks/[id]/route") },
  { pattern: "/api/transactions", load: () => import("@/app/api/transactions/route") },
  { pattern: "/api/transactions/:id", load: () => import("@/app/api/transactions/[id]/route") },
  { pattern: "/api/virtual-assets", load: () => import("@/app/api/virtual-assets/route") },
  { pattern: "/api/virtual-assets/:id", load: () => import("@/app/api/virtual-assets/[id]/route") },
];

interface CompiledRoute {
  pattern: string;
  load: Loader;
  paramNames: string[];
  regex: RegExp;
}

// Literal routes must win over ":param" ones ("/api/categories/reorder" vs "/api/categories/:id").
const ROUTES: CompiledRoute[] = ROUTE_DEFS.map((r) => {
  const segments = r.pattern.split("/");
  const source = segments.map((s) => (s.startsWith(":") ? "([^/]+)" : s)).join("/");
  return {
    ...r,
    paramNames: segments.filter((s) => s.startsWith(":")).map((s) => s.slice(1)),
    regex: new RegExp("^" + source + "$"),
  };
}).sort((a, b) => a.paramNames.length - b.paramNames.length);

export interface HttpResult {
  status: number;
  json: any;
}

export interface WireEntry {
  method: string;
  path: string;
  status: number;
  requestBytes: number;
  /** Parsed JSON of a /api/sync/push response, for assertions on per-table results. */
  responseJson?: any;
}

export interface ServerHarness {
  /** Direct Prisma access to the scratch server database — the ground truth to assert against. */
  prisma: any;
  /** Call a real web route handler as the logged-in browser session (cookie auth). */
  web(method: string, url: string, body?: unknown): Promise<HttpResult>;
  /** Like web() but throws on any non-2xx, returning the JSON — for scenario setup. */
  mustWeb(method: string, url: string, body?: unknown): Promise<any>;
  /** Registers a fresh web user (like /register) and leaves that session logged in. */
  registerUser(email?: string): Promise<{ userId: string; token: string; email: string }>;
  /** Logs the simulated browser in as an existing token (or out, with undefined). */
  setWebSession(token: string | undefined): void;
  /** Requests bigger than this get a 413 straight from the "proxy", like production's nginx. */
  proxyBodyLimitBytes: number | null;
  /** Every request the phone made to the server, for assertions. */
  wireLog: WireEntry[];
  dispose(): Promise<void>;
}

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

async function callRoute(method: string, rawUrl: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  const url = new URL(rawUrl, "http://server.local");
  const route = ROUTES.find((r) => r.regex.test(url.pathname));
  if (!route) return new Response(JSON.stringify({ error: "no test route for " + url.pathname }), { status: 599 });
  const match = route.regex.exec(url.pathname)!;
  const params: Record<string, string> = {};
  route.paramNames.forEach((n, i) => (params[n] = match[i + 1]));

  const mod = await route.load();
  const handler = mod[method];
  if (!handler) return new Response(JSON.stringify({ error: method + " not exported by " + route.pattern }), { status: 405 });

  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";
  const req = new NextRequest(url.toString(), {
    method,
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...headers },
    body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  return handler(req, { params });
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function createServerHarness(): Promise<ServerHarness> {
  const dir = mkdtempSync(path.join(tmpdir(), "parva-sync-e2e-"));
  const dbFile = path.join(dir, "server.db").replace(/\\/g, "/");
  process.env.DATABASE_URL = "file:" + dbFile;
  process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-test-secret-e2e-test-secret";

  // Explicit DATABASE_URL above always beats .env (dotenv never overrides an already-set var), so
  // the developer's real prisma/dev.db is never touched by this.
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    cwd: repoRoot(),
    env: process.env,
    shell: true,
    encoding: "utf8",
  });
  if (push.status !== 0) throw new Error("prisma db push failed:\n" + push.stdout + "\n" + push.stderr);

  delete (globalThis as { prisma?: unknown }).prisma;
  const { prisma } = await import("@/lib/db");

  let webToken: string | undefined;
  const wireLog: WireEntry[] = [];

  const harness: ServerHarness = {
    prisma,
    proxyBodyLimitBytes: 1_000_000,
    wireLog,
    setWebSession(token) {
      webToken = token;
    },
    async web(method, url, body) {
      cookieJar.value = webToken;
      const res = await callRoute(method, url, body, {});
      // The register/login routes set the session cookie through the mocked cookies().set().
      if (url.startsWith("/api/auth/")) webToken = cookieJar.value;
      return { status: res.status, json: await readJson(res) };
    },
    async mustWeb(method, url, body) {
      const res = await harness.web(method, url, body);
      if (res.status >= 400) throw new Error("web " + method + " " + url + " -> " + res.status + " " + JSON.stringify(res.json));
      return res.json;
    },
    async registerUser(email = "user-" + Math.random().toString(36).slice(2) + "@example.test") {
      const res = await harness.web("POST", "/api/auth/register", { name: "تست", email, password: "secret123" });
      if (res.status !== 200) throw new Error("register failed: " + res.status + " " + JSON.stringify(res.json));
      return { userId: res.json.id, token: res.json.token, email };
    },
    async dispose() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };

  // What the phone's raw fetch() (REMOTE_API_BASE) reaches: the same handlers, bearer auth only,
  // behind an optional request-body cap.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const requestBytes = bodyText ? Buffer.byteLength(bodyText) : 0;
    const pathOnly = new URL(url).pathname;

    if (harness.proxyBodyLimitBytes !== null && requestBytes > harness.proxyBodyLimitBytes) {
      wireLog.push({ method, path: pathOnly, status: 413, requestBytes });
      return new Response("<html><head><title>413 Request Entity Too Large</title></head><body>nginx/1.24.0 (Ubuntu)</body></html>", { status: 413 });
    }

    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const previousCookie = cookieJar.value;
    cookieJar.value = undefined; // the phone has no browser cookies — bearer token only
    try {
      const res = await callRoute(method, url, bodyText, headers);
      const cloned = res.clone();
      wireLog.push({
        method,
        path: pathOnly,
        status: res.status,
        requestBytes,
        responseJson: pathOnly.includes("/push") ? await readJson(cloned) : undefined,
      });
      return res;
    } finally {
      cookieJar.value = previousCookie;
    }
  });

  return harness;
}

// ---------------------------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------------------------

export interface Phone {
  db: LocalDb;
  /** Runs one request through the real on-device dispatcher — exactly what the UI's apiClient does. */
  request(method: string, url: string, body?: unknown): HttpResult;
  /** Like request() but throws on any non-2xx, returning the JSON — for scenario setup. */
  must(method: string, url: string, body?: unknown): any;
  /** Makes this phone the one dispatchLocal()/getLocalDbInstance() talk to (several can coexist). */
  activate(): void;
}

let activePhone: Phone | null = null;

export async function createPhone(): Promise<Phone> {
  const driver = await createNodeSqliteDriver(":memory:");
  const phone: Phone = {
    db: driver,
    activate() {
      if (activePhone === phone) return;
      resetLocalDbForTests();
      setLocalDbDriver(driver);
      phone.db = openLocalDb(driver);
      getLocalUserId(phone.db); // seeds the local user + default categories, like first boot does
      activePhone = phone;
    },
    request(method, url, body) {
      phone.activate();
      return dispatchLocal(method, url, body) as HttpResult;
    },
    must(method, url, body) {
      const res = phone.request(method, url, body);
      if (res.status >= 400) throw new Error(method + " " + url + " -> " + res.status + " " + JSON.stringify(res.json));
      return res.json;
    },
  };
  phone.activate();
  return phone;
}
