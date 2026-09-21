import { PrismaClient } from "@prisma/client";
import { attachPrismaEvents, withPrismaObservability } from "./observability/server/prisma";
import { getTransactionStore } from "./observability/server/transactionContext";

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

type Client = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as { prisma?: Client };

/**
 * The client itself. Only withTransaction (src/lib/transaction.ts) needs this: it starts transactions
 * on the real client. Everything else imports `prisma` below.
 */
export const rawPrisma: Client = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rawPrisma;

/**
 * The client the application uses. Outside a transaction it is the real client. Inside a
 * withTransaction callback, every model it hands out (`prisma.task`, `prisma.transaction` …) is the
 * transaction's own, so all the code the callback calls — helpers included — takes part in the same
 * transaction without being passed anything. (Inside a Prisma interactive transaction only the
 * transaction client joins it; a call on the plain client would silently run outside it, on another
 * connection, and be neither rolled back nor even able to see the uncommitted rows.)
 */
export const prisma: Client = new Proxy(rawPrisma, {
  get(target, property) {
    const store = getTransactionStore();
    if (store) {
      const routed = (store.client as Record<PropertyKey, unknown>)[property];
      if (routed !== undefined) return typeof routed === "function" ? routed.bind(store.client) : routed;
    }
    const value = (target as unknown as Record<PropertyKey, unknown>)[property];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
