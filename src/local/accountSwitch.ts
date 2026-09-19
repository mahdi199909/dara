// What happens when someone logs in on a phone that already holds ANOTHER account's data.
//
// The phone's database belongs to the device, not to a login: FirstRunGate's sign-in only
// establishes who to sync with. So before this existed, signing in as a different account left the
// old account's tasks, habits and transactions in place — and the next sync pushed them into the
// new account, mixing two people's data on the server. The device now remembers which account it
// is linked to (see syncMeta.ts); a different one must be confirmed, and then the old data is
// cleared so the new account starts from its own server data.
import { SYNC_TABLES } from "@/lib/syncTables";
import type { LocalDb } from "./db";
import { LOCAL_USER_ID, ensureDefaultCategories } from "./localUser";
import { META_LINKED_EMAIL, META_LINKED_USER_ID, META_TOMBSTONES_ACKED_AT, getSyncMeta, setSyncMeta, clearAllSyncIssues } from "./syncMeta";

export interface LinkedAccount {
  remoteUserId: string;
  email: string | null;
}

export function getLinkedAccount(db: LocalDb): LinkedAccount | null {
  const remoteUserId = getSyncMeta(db, META_LINKED_USER_ID);
  return remoteUserId ? { remoteUserId, email: getSyncMeta(db, META_LINKED_EMAIL) } : null;
}

export function setLinkedAccount(db: LocalDb, account: LinkedAccount): void {
  setSyncMeta(db, META_LINKED_USER_ID, account.remoteUserId);
  setSyncMeta(db, META_LINKED_EMAIL, account.email);
}

/** True when signing in as `remoteUserId` would put someone else's data under that account. */
export function isAccountSwitch(db: LocalDb, remoteUserId: string): LinkedAccount | null {
  const linked = getLinkedAccount(db);
  return linked && linked.remoteUserId !== remoteUserId ? linked : null;
}

/** Removes every synced record and all sync bookkeeping, and returns the local user to a factory
 * state (default categories, placeholder name, untouched settings). Children go before parents so
 * this also works while SQLite foreign keys happen to be enforced. */
export function wipeLocalAccountData(db: LocalDb): void {
  db.execute("BEGIN TRANSACTION");
  try {
    for (const config of [...SYNC_TABLES].reverse()) db.run(`DELETE FROM "${config.table}"`);
    db.run(`DELETE FROM "SyncTombstone"`);
    db.run(`DELETE FROM "AuditLog"`);
    db.run(`DELETE FROM "Notification"`);
    db.run(`DELETE FROM "ShownInsight"`);
    clearAllSyncIssues(db);
    setSyncMeta(db, META_TOMBSTONES_ACKED_AT, null);
    setSyncMeta(db, "profilePushedAt", null);

    db.run(`DELETE FROM "Settings" WHERE "userId" = ?`, [LOCAL_USER_ID]);
    const now = new Date().toISOString();
    db.run(`UPDATE "User" SET "name" = 'من', "createdAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now, now, LOCAL_USER_ID]);
    db.run(
      `INSERT INTO "Settings" ("id","userId","createdAt","updatedAt") VALUES (?,?,?,?)`,
      [crypto.randomUUID(), LOCAL_USER_ID, now, now]
    );
    ensureDefaultCategories(db, LOCAL_USER_ID);
    db.execute("COMMIT");
  } catch (err) {
    db.execute("ROLLBACK");
    throw err;
  }
}
