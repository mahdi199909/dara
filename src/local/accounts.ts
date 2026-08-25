// On-device port of src/lib/accounts.ts's resolveDefaultAccountId. Synchronous, since LocalDb
// itself is synchronous (see src/local/db.ts) — unlike the web version this never awaits.
//
// Note on fidelity: the web version calls prisma.financeAccount.create() directly, bypassing
// the /api/accounts POST route entirely, so creating the fallback account there does NOT write
// an audit log entry. This does the same — it inserts the row itself rather than delegating to
// createAccount() in ./repositories/accounts.ts, which *would* write a CREATE audit entry and
// so would not be a faithful port.
import type { LocalDb } from "./db";

/** Returns the user's first active account, creating a default cash account if none exists yet. */
export function resolveDefaultAccountId(db: LocalDb, userId: string): string {
  const existing = db.get<{ id: string }>(
    `SELECT "id" FROM "FinanceAccount" WHERE "userId" = ? AND "deletedAt" IS NULL AND "isActive" = 1 ORDER BY "createdAt" ASC LIMIT 1`,
    [userId]
  );
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO "FinanceAccount" ("id","userId","name","type","initialBalance","isActive","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
    [id, userId, "صندوق", "CASH", 0, 1, now, now]
  );
  return id;
}
