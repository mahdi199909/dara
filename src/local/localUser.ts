// A local install has exactly one "user" — see Phase 5 of the Android pivot plan (no
// password login on-device; the OS-level device lock is the real security boundary). Every
// table still has a userId FK because the schema is shared with the multi-user web app, so
// this just guarantees that one row exists and hands back its id.
import type { LocalDb } from "./db";
import { DEFAULT_CATEGORIES } from "@/lib/defaultCategories";

export const LOCAL_USER_ID = "local-device-user";

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

  // Mirrors src/app/api/auth/register/route.ts's seedDefaultCategoriesForUser — the web route
  // seeds these on signup, but a fresh on-device install never goes through that route at all.
  for (const c of DEFAULT_CATEGORIES) {
    db.run(
      `INSERT INTO "Category" ("id","userId","name","icon","color","kind","valueType","isActive","generatesVirtualAsset","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,1,0,?,?)`,
      [crypto.randomUUID(), LOCAL_USER_ID, c.name, c.icon, c.color, c.kind, c.valueType, now, now]
    );
  }

  return LOCAL_USER_ID;
}
