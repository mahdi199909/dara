// The Android build's stand-in for a network round-trip: apiClient.ts calls dispatchLocal()
// instead of fetch() when running inside the Capacitor shell, and this routes (method, path)
// to the same-shaped local repository call the equivalent /api/* route handler would make —
// see the "local dispatcher" step of the Android local-data-layer plan. Every route
// registered here should return the exact same JSON shape its web counterpart does.
import { ZodError } from "zod";
import { ApiError } from "@/lib/apiErrorBase";
import { openLocalDb, type LocalDb } from "@/local/db";
import { getLocalUserId } from "@/local/localUser";
import * as tasksRepo from "@/local/repositories/tasks";
import { createTaskSchema, updateTaskSchema } from "@/lib/schemas/tasks";

interface HandlerCtx {
  db: LocalDb;
  userId: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}
type Handler = (ctx: HandlerCtx) => unknown;

interface Route {
  method: string;
  regex: RegExp;
  paramNames: string[];
  status: number;
  handler: Handler;
}

const routes: Route[] = [];

/** Registers a local route. `path` uses `:param` segments, e.g. "/api/tasks/:id". */
function register(method: string, path: string, handler: Handler, status = 200) {
  const paramNames: string[] = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  routes.push({ method, regex: new RegExp(`^${pattern}$`), paramNames, status, handler });
}

// --- Tasks -------------------------------------------------------------------------------
register("GET", "/api/tasks", ({ db, userId, query }) => ({
  tasks: tasksRepo.listTasks(db, userId, {
    status: query.get("status") ?? undefined,
    projectId: query.get("projectId") ?? undefined,
  }),
}));
register("POST", "/api/tasks", ({ db, userId, body }) => ({ task: tasksRepo.createTask(db, userId, createTaskSchema.parse(body)) }), 201);
register("PATCH", "/api/tasks/:id", ({ db, userId, params, body }) => ({
  task: tasksRepo.updateTask(db, userId, params.id, updateTaskSchema.parse(body)),
}));
register("DELETE", "/api/tasks/:id", ({ db, userId, params }) => tasksRepo.deleteTask(db, userId, params.id));

// -----------------------------------------------------------------------------------------

let driverOverride: LocalDb | null = null;
/** Test-only: point the dispatcher at a specific driver (e.g. an in-memory node-sqlite one) instead of the real on-device driver. */
export function setLocalDbDriverForTests(driver: LocalDb) {
  driverOverride = driver;
}

function resolveDriver(): LocalDb {
  if (driverOverride) return driverOverride;
  // The real Capacitor-SQLite-backed driver gets wired in here in Phase 6.
  throw new Error("Local database driver not configured — this should only run inside the Capacitor Android shell.");
}

export interface LocalResponse {
  status: number;
  json: unknown;
}

function errorResponse(err: unknown): LocalResponse {
  if (err instanceof ZodError) {
    return { status: 400, json: { error: "اطلاعات ارسالی نامعتبر است.", details: err.flatten() } };
  }
  if (err instanceof ApiError) {
    return { status: err.status, json: { error: err.message } };
  }
  console.error(err);
  return { status: 500, json: { error: "خطایی رخ داد. دوباره تلاش کنید." } };
}

/** Routes one local "request" the same way a matching /api/* route handler would. */
export function dispatchLocal(method: string, url: string, body?: unknown): LocalResponse {
  const { pathname, searchParams } = new URL(url, "http://local");
  const route = routes.find((r) => r.method === method && r.regex.test(pathname));
  if (!route) {
    return { status: 404, json: { error: `مسیر محلی برای ${method} ${pathname} هنوز پیاده‌سازی نشده.` } };
  }

  const match = route.regex.exec(pathname)!;
  const params: Record<string, string> = {};
  route.paramNames.forEach((name, i) => (params[name] = match[i + 1]));

  try {
    const db = openLocalDb(resolveDriver());
    const userId = getLocalUserId(db);
    const json = route.handler({ db, userId, params, query: searchParams, body });
    return { status: route.status, json };
  } catch (err) {
    return errorResponse(err);
  }
}
