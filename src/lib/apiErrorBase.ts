// Split out of apiError.ts on purpose: this file must stay free of any Next.js-server-only
// or Prisma imports, because src/local/** (reachable from client-bundled apiClient.ts on the
// Android build) throws this same ApiError class to mirror web route error responses. If
// this ever grows a "next/server" or "@/lib/auth" import again, that import chain leaks into
// the browser bundle for every page that touches apiClient.ts.
//
// (The type-only import below is erased at build time, so it adds nothing to that chain either.)
import type { ErrorCode } from "./observability/core/errorCodes";

export class ApiError extends Error {
  status: number;
  /** A stable DOMAIN-NNN code for the response; when absent, handleApiError derives one from the status. */
  code?: ErrorCode;
  constructor(message: string, status = 400, code?: ErrorCode) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}
