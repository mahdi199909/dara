// On-device port of src/app/api/search/route.ts — cross-entity text search.
import type { LocalDb } from "../db";

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  href: string;
}

export function search(db: LocalDb, userId: string, q: string | undefined): SearchResult[] {
  const query = q?.trim();
  if (!query) return [];

  const like = `%${query}%`;

  const tasks = db.all<{ id: string; title: string }>(
    `SELECT "id","title" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "title" LIKE ? LIMIT 10`,
    [userId, like]
  );
  const activities = db.all<{ id: string; title: string }>(
    `SELECT "id","title" FROM "Activity" WHERE "userId" = ? AND "deletedAt" IS NULL AND "title" LIKE ? LIMIT 10`,
    [userId, like]
  );
  const events = db.all<{ id: string; title: string }>(
    `SELECT "id","title" FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL AND "title" LIKE ? LIMIT 10`,
    [userId, like]
  );
  const transactions = db.all<{ id: string; description: string | null }>(
    `SELECT "id","description" FROM "Transaction" WHERE "userId" = ? AND "deletedAt" IS NULL AND "description" LIKE ? LIMIT 10`,
    [userId, like]
  );
  const assets = db.all<{ id: string; name: string }>(
    `SELECT "id","name" FROM "Asset" WHERE "userId" = ? AND "deletedAt" IS NULL AND "name" LIKE ? LIMIT 10`,
    [userId, like]
  );
  const projects = db.all<{ id: string; name: string }>(
    `SELECT "id","name" FROM "Project" WHERE "userId" = ? AND "deletedAt" IS NULL AND "name" LIKE ? LIMIT 10`,
    [userId, like]
  );
  const categories = db.all<{ id: string; name: string }>(
    `SELECT "id","name" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL AND "name" LIKE ? LIMIT 10`,
    [userId, like]
  );

  return [
    ...tasks.map((t) => ({ type: "Task", id: t.id, title: t.title, href: `/tasks?highlight=${t.id}` })),
    ...activities.map((a) => ({ type: "Activity", id: a.id, title: a.title, href: `/?highlight=${a.id}` })),
    ...events.map((e) => ({ type: "Event", id: e.id, title: e.title, href: `/calendar?highlight=${e.id}` })),
    ...transactions.map((t) => ({ type: "Transaction", id: t.id, title: t.description || "تراکنش", href: `/finance?highlight=${t.id}` })),
    ...assets.map((a) => ({ type: "Asset", id: a.id, title: a.name, href: `/assets?highlight=${a.id}` })),
    ...projects.map((p) => ({ type: "Project", id: p.id, title: p.name, href: `/projects/detail?id=${p.id}` })),
    ...categories.map((c) => ({ type: "Category", id: c.id, title: c.name, href: `/settings?tab=categories` })),
  ];
}
