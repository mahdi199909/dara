// A local install has exactly one "user" — see Phase 5 of the Android pivot plan (no
// password login on-device; the OS-level device lock is the real security boundary). Every
// table still has a userId FK because the schema is shared with the multi-user web app, so
// this just guarantees that one row exists and hands back its id.
import type { LocalDb } from "./db";

const LOCAL_USER_ID = "local-device-user";

export function getLocalUserId(db: LocalDb): string {
  const existing = db.get<{ id: string }>(`SELECT "id" FROM "User" WHERE "id" = ?`, [LOCAL_USER_ID]);
  if (existing) return existing.id;

  const now = new Date().toISOString();
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    LOCAL_USER_ID,
    "local@device",
    "",
    "من",
    now,
    now,
  ]);
  db.run(`INSERT INTO "Settings" ("id","userId","createdAt","updatedAt") VALUES (?,?,?,?)`, [crypto.randomUUID(), LOCAL_USER_ID, now, now]);
  return LOCAL_USER_ID;
}
