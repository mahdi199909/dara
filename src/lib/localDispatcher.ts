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
import * as categoriesRepo from "@/local/repositories/categories";
import * as projectsRepo from "@/local/repositories/projects";
import * as accountsRepo from "@/local/repositories/accounts";
import * as transactionsRepo from "@/local/repositories/transactions";
import * as installmentsRepo from "@/local/repositories/installments";
import * as assetsRepo from "@/local/repositories/assets";
import * as activitiesRepo from "@/local/repositories/activities";
import * as eventsRepo from "@/local/repositories/events";
import * as habitsRepo from "@/local/repositories/habits";
import * as virtualAssetsRepo from "@/local/repositories/virtualAssets";
import * as settingsRepo from "@/local/repositories/settings";
import * as notificationsRepo from "@/local/repositories/notifications";
import * as auditLogsRepo from "@/local/repositories/auditLogs";
import * as searchRepo from "@/local/repositories/search";
import * as exportRepo from "@/local/repositories/export";
import * as quickCaptureRepo from "@/local/repositories/quickCapture";
import * as dashboardRepo from "@/local/repositories/dashboard";
import { createTaskSchema, updateTaskSchema } from "@/lib/schemas/tasks";
import { createCategorySchema, updateCategorySchema } from "@/lib/schemas/categories";
import { createProjectSchema, updateProjectSchema } from "@/lib/schemas/projects";
import { createAccountSchema, updateAccountSchema } from "@/lib/schemas/accounts";
import { createTransactionSchema, updateTransactionSchema } from "@/lib/schemas/transactions";
import { createInstallmentPlanSchema, payInstallmentSchema } from "@/lib/schemas/installments";
import { createAssetSchema, updateAssetSchema } from "@/lib/schemas/assets";
import { createActivitySchema, updateActivitySchema, addTimeEntrySchema } from "@/lib/schemas/activities";
import { createEventSchema, updateEventSchema, toggleEventCompletionSchema, createReminderSchema } from "@/lib/schemas/events";
import { createHabitSchema, updateHabitSchema, habitCheckInToggleSchema, habitCheckInDurationSchema } from "@/lib/schemas/habits";
import { updateSettingsSchema } from "@/lib/schemas/settings";

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

// --- Categories --------------------------------------------------------------------------
register("GET", "/api/categories", ({ db, userId }) => ({ categories: categoriesRepo.listCategories(db, userId) }));
register("POST", "/api/categories", ({ db, userId, body }) => ({ category: categoriesRepo.createCategory(db, userId, createCategorySchema.parse(body)) }), 201);
register("PATCH", "/api/categories/:id", ({ db, userId, params, body }) => ({
  category: categoriesRepo.updateCategory(db, userId, params.id, updateCategorySchema.parse(body)),
}));
register("DELETE", "/api/categories/:id", ({ db, userId, params }) => categoriesRepo.deleteCategory(db, userId, params.id));

// --- Projects ------------------------------------------------------------------------------
register("GET", "/api/projects", ({ db, userId }) => ({ projects: projectsRepo.listProjects(db, userId) }));
register("POST", "/api/projects", ({ db, userId, body }) => ({ project: projectsRepo.createProject(db, userId, createProjectSchema.parse(body)) }), 201);
register("GET", "/api/projects/:id", ({ db, userId, params }) => projectsRepo.getProject(db, userId, params.id));
register("PATCH", "/api/projects/:id", ({ db, userId, params, body }) => ({
  project: projectsRepo.updateProject(db, userId, params.id, updateProjectSchema.parse(body)),
}));
register("DELETE", "/api/projects/:id", ({ db, userId, params }) => projectsRepo.deleteProject(db, userId, params.id));

// --- Accounts ------------------------------------------------------------------------------
register("GET", "/api/accounts", ({ db, userId }) => ({ accounts: accountsRepo.listAccounts(db, userId) }));
register("POST", "/api/accounts", ({ db, userId, body }) => ({ account: accountsRepo.createAccount(db, userId, createAccountSchema.parse(body)) }), 201);
register("PATCH", "/api/accounts/:id", ({ db, userId, params, body }) => ({
  account: accountsRepo.updateAccount(db, userId, params.id, updateAccountSchema.parse(body)),
}));
register("DELETE", "/api/accounts/:id", ({ db, userId, params }) => accountsRepo.deleteAccount(db, userId, params.id));

// --- Transactions --------------------------------------------------------------------------
register("GET", "/api/transactions", ({ db, userId, query }) => ({
  transactions: transactionsRepo.listTransactions(db, userId, {
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
    type: query.get("type") ?? undefined,
    accountId: query.get("accountId") ?? undefined,
    limit: query.get("limit") ? Number(query.get("limit")) : undefined,
  }),
}));
register(
  "POST",
  "/api/transactions",
  ({ db, userId, body }) => ({ transaction: transactionsRepo.createTransaction(db, userId, createTransactionSchema.parse(body)) }),
  201
);
register("PATCH", "/api/transactions/:id", ({ db, userId, params, body }) => ({
  transaction: transactionsRepo.updateTransaction(db, userId, params.id, updateTransactionSchema.parse(body)),
}));
register("DELETE", "/api/transactions/:id", ({ db, userId, params }) => transactionsRepo.deleteTransaction(db, userId, params.id));

// --- Installments --------------------------------------------------------------------------
register("GET", "/api/installment-plans", ({ db, userId }) => ({ plans: installmentsRepo.listInstallmentPlans(db, userId) }));
register(
  "POST",
  "/api/installment-plans",
  ({ db, userId, body }) => ({ plan: installmentsRepo.createInstallmentPlan(db, userId, createInstallmentPlanSchema.parse(body)) }),
  201
);
register("GET", "/api/installment-plans/:id", ({ db, userId, params }) => ({ plan: installmentsRepo.getInstallmentPlan(db, userId, params.id) }));
register("DELETE", "/api/installment-plans/:id", ({ db, userId, params }) => installmentsRepo.deleteInstallmentPlan(db, userId, params.id));
register("POST", "/api/installments/:id/pay", ({ db, userId, params, body }) =>
  installmentsRepo.payInstallment(db, userId, params.id, payInstallmentSchema.parse(body))
);

// --- Assets --------------------------------------------------------------------------------
register("GET", "/api/assets", ({ db, userId }) => ({ assets: assetsRepo.listAssets(db, userId) }));
register("POST", "/api/assets", ({ db, userId, body }) => ({ asset: assetsRepo.createAsset(db, userId, createAssetSchema.parse(body)) }), 201);
register("GET", "/api/assets/:id", ({ db, userId, params }) => assetsRepo.getAsset(db, userId, params.id));
register("PATCH", "/api/assets/:id", ({ db, userId, params, body }) => ({
  asset: assetsRepo.updateAsset(db, userId, params.id, updateAssetSchema.parse(body)),
}));
register("DELETE", "/api/assets/:id", ({ db, userId, params }) => assetsRepo.deleteAsset(db, userId, params.id));

// --- Activities & TimeEntry ------------------------------------------------------------------
register("GET", "/api/activities", ({ db, userId, query }) => ({
  activities: activitiesRepo.listActivities(db, userId, {
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
    projectId: query.get("projectId") ?? undefined,
    categoryId: query.get("categoryId") ?? undefined,
    limit: query.get("limit") ? Number(query.get("limit")) : undefined,
  }),
}));
register(
  "POST",
  "/api/activities",
  ({ db, userId, body }) => ({ activity: activitiesRepo.createActivity(db, userId, createActivitySchema.parse(body)) }),
  201
);
register("GET", "/api/activities/:id", ({ db, userId, params }) => ({ activity: activitiesRepo.getActivity(db, userId, params.id) }));
register("PATCH", "/api/activities/:id", ({ db, userId, params, body }) => ({
  activity: activitiesRepo.updateActivity(db, userId, params.id, updateActivitySchema.parse(body)),
}));
register("DELETE", "/api/activities/:id", ({ db, userId, params }) => activitiesRepo.deleteActivity(db, userId, params.id));
register(
  "POST",
  "/api/activities/:id/time-entries",
  ({ db, userId, params, body }) => ({ timeEntry: activitiesRepo.addTimeEntry(db, userId, params.id, addTimeEntrySchema.parse(body)) }),
  201
);
register("POST", "/api/activities/:id/timer/start", ({ db, userId, params }) => ({
  timeEntry: activitiesRepo.startActivityTimer(db, userId, params.id),
}));
register("POST", "/api/activities/:id/timer/stop", ({ db, userId, params }) => activitiesRepo.stopActivityTimer(db, userId, params.id));

// --- Events & Reminders ----------------------------------------------------------------------
register("GET", "/api/events", ({ db, userId, query }) =>
  eventsRepo.listEvents(db, userId, { from: query.get("from"), to: query.get("to") })
);
register("POST", "/api/events", ({ db, userId, body }) => ({ event: eventsRepo.createEvent(db, userId, createEventSchema.parse(body)) }), 201);
register("PATCH", "/api/events/:id", ({ db, userId, params, body }) => ({
  event: eventsRepo.updateEvent(db, userId, params.id, updateEventSchema.parse(body)),
}));
register("DELETE", "/api/events/:id", ({ db, userId, params }) => eventsRepo.deleteEvent(db, userId, params.id));
register("POST", "/api/events/:id/complete", ({ db, userId, params, body }) =>
  eventsRepo.toggleEventCompletion(db, userId, params.id, toggleEventCompletionSchema.parse(body))
);
register(
  "POST",
  "/api/events/:id/reminders",
  ({ db, userId, params, body }) => ({ reminder: eventsRepo.createReminder(db, userId, params.id, createReminderSchema.parse(body)) }),
  201
);
register("DELETE", "/api/reminders/:id", ({ db, userId, params }) => eventsRepo.deleteReminder(db, userId, params.id));

// --- Habits, VirtualAssets, Settings, Notifications, AuditLogs -------------------------------
register("GET", "/api/habits", ({ db, userId }) => habitsRepo.listHabits(db, userId));
register("POST", "/api/habits", ({ db, userId, body }) => ({ habit: habitsRepo.createHabit(db, userId, createHabitSchema.parse(body)) }), 201);
register("PATCH", "/api/habits/:id", ({ db, userId, params, body }) => ({
  habit: habitsRepo.updateHabit(db, userId, params.id, updateHabitSchema.parse(body)),
}));
register("DELETE", "/api/habits/:id", ({ db, userId, params }) => habitsRepo.deleteHabit(db, userId, params.id));
register("POST", "/api/habits/:id/checkin", ({ db, userId, params, body }) =>
  habitsRepo.toggleHabitCheckIn(db, userId, params.id, habitCheckInToggleSchema.parse(body ?? {}))
);
register("PATCH", "/api/habits/:id/checkin", ({ db, userId, params, body }) =>
  habitsRepo.logHabitCheckInDuration(db, userId, params.id, habitCheckInDurationSchema.parse(body))
);

register("GET", "/api/virtual-assets", ({ db, userId }) => virtualAssetsRepo.listVirtualAssets(db, userId));

register("GET", "/api/settings", ({ db, userId }) => settingsRepo.getSettings(db, userId));
register("PATCH", "/api/settings", ({ db, userId, body }) => settingsRepo.updateSettings(db, userId, updateSettingsSchema.parse(body)));

register("GET", "/api/notifications", ({ db, userId }) => notificationsRepo.listNotifications(db, userId));
register("POST", "/api/notifications/:id/read", ({ db, userId, params }) => notificationsRepo.markNotificationRead(db, userId, params.id));

register("GET", "/api/audit-logs", ({ db, userId, query }) =>
  auditLogsRepo.listAuditLogs(db, userId, {
    entityType: query.get("entityType") ?? undefined,
    limit: query.get("limit") ? Number(query.get("limit")) : undefined,
  })
);

// --- Cross-cutting: search, export, quick-capture, dashboard ---------------------------------
register("GET", "/api/search", ({ db, userId, query }) => ({ results: searchRepo.search(db, userId, query.get("q") ?? undefined) }));

register("GET", "/api/export/:entity", ({ db, userId, params }) => exportRepo.exportCsv(db, userId, params.entity));

register("POST", "/api/quick-capture", ({ db, userId, body }) => quickCaptureRepo.quickCapture(db, userId, body as any), 201);

register("GET", "/api/dashboard", ({ db, userId }) => dashboardRepo.getDashboard(db, userId));

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
