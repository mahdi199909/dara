// Server-only observability. Import from here in routes and server libraries; never from code that
// also ships to the phone (the isomorphic core lives one level up, in "@/lib/observability").
export { withApiLogging, completionLevel } from "./withApiLogging";
export {
  beginRequest,
  ensureRequestContextProvider,
  getRequestContext,
  recordDbQuery,
  runWithRequestContext,
  setRequestErrorCode,
  setRequestUser,
} from "./requestContext";
export type { RequestContext } from "./requestContext";
export { serverSettings } from "./settings";
export type { ServerSettings } from "./settings";
export { attachPrismaEvents, classifyDbFailure, reportDbOperation, sanitizeEngineMessage, withPrismaObservability } from "./prisma";
export {
  emailPseudonym,
  logForbidden,
  logLoginFailed,
  logLoginSuccess,
  logLogout,
  logRateLimited,
  logRegisterFailed,
  logRegisterSuccess,
  logSessionInvalid,
} from "./authEvents";
export { startServerObservability } from "./startup";
export { getServerLogSinks, startServerLogSinks } from "./serverSinks";
export { resolveServerLogConfig } from "./logConfig";
export { recordJob } from "./jobMetrics";
