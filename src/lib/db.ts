import { PrismaClient } from "@prisma/client";
import { attachPrismaEvents, withPrismaObservability } from "./observability/server/prisma";

// Prisma's own console output is switched off (`emit: "event"`, never "stdout"): its error text
// reproduces the failing query with every argument in it — an e-mail, a task title, an amount — and
// would land in the server log verbatim. The engine's events go through the logger instead, scrubbed,
// and every operation is timed and classified by the extension (see observability/server/prisma.ts).
function createClient() {
  const base = new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });
  attachPrismaEvents(base);
  return withPrismaObservability(base);
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
