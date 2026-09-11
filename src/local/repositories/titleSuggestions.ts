// On-device equivalent of src/app/api/quick-capture/suggestions/route.ts — see
// src/lib/titleSuggestions.ts for the shared ranking logic both sides call after fetching their
// own aggregates (raw SQL here, Prisma groupBy there).
import type { LocalDb } from "../db";
import { rankTitleSuggestions, type TitleSuggestion, type TitleUsageStat } from "@/lib/titleSuggestions";

export function getTitleSuggestions(db: LocalDb, userId: string, query: string): TitleSuggestion[] {
  const rows = db.all<TitleUsageStat>(
    `SELECT "title", COUNT(*) as "count", MAX("createdAt") as "lastUsedAt" FROM (
       SELECT "title", "createdAt" FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL
       UNION ALL
       SELECT "title", "createdAt" FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL
     ) GROUP BY "title"`,
    [userId, userId]
  );
  return rankTitleSuggestions(rows, query, new Date());
}
