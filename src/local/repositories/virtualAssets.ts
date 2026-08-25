// On-device port of src/app/api/virtual-assets/route.ts's GET — aggregates VirtualAssetEntry
// rows by category, plus separate project/habit buckets, using fetchByIds for every joined
// relation instead of Prisma's `include`.
import type { LocalDb } from "../db";
import { fetchByIds } from "../relations";

interface VirtualAssetEntryRow {
  id: string;
  userId: string;
  activityId: string | null;
  taskId: string | null;
  projectId: string | null;
  habitCheckInId: string | null;
  categoryId: string | null;
  durationMin: number;
  valuePerHour: number;
  totalValue: number;
  date: string;
  createdAt: string;
}

interface RelatedRow {
  id: string;
  [key: string]: unknown;
}
interface HabitCheckInRow {
  id: string;
  habitId: string;
  [key: string]: unknown;
}
interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  [key: string]: unknown;
}

export function listVirtualAssets(db: LocalDb, userId: string) {
  const rows = db.all<VirtualAssetEntryRow>(`SELECT * FROM "VirtualAssetEntry" WHERE "userId" = ? ORDER BY "date" DESC`, [userId]);

  const activityById = fetchByIds<RelatedRow>(db, "Activity", rows.map((e) => e.activityId));
  const taskById = fetchByIds<RelatedRow>(db, "Task", rows.map((e) => e.taskId));
  const projectById = fetchByIds<RelatedRow>(db, "Project", rows.map((e) => e.projectId));
  const habitCheckInById = fetchByIds<HabitCheckInRow>(db, "HabitCheckIn", rows.map((e) => e.habitCheckInId));
  const habitById = fetchByIds<RelatedRow>(db, "Habit", Array.from(habitCheckInById.values()).map((hc) => hc.habitId));

  const entries = rows.map((e) => ({
    ...e,
    activity: e.activityId ? activityById.get(e.activityId) ?? null : null,
    task: e.taskId ? taskById.get(e.taskId) ?? null : null,
    project: e.projectId ? projectById.get(e.projectId) ?? null : null,
    habitCheckIn: e.habitCheckInId ? attachHabit(habitCheckInById.get(e.habitCheckInId), habitById) : null,
  }));

  const total = entries.reduce((s, e) => s + e.totalValue, 0);

  const categoryIds = Array.from(new Set(entries.filter((e) => e.categoryId).map((e) => e.categoryId as string)));
  const categoryById = fetchByIds<CategoryRow>(db, "Category", categoryIds);

  const byCategory = new Map<string, { categoryId: string; name: string; icon: string | null; total: number; entries: typeof entries }>();
  const projectEntries: typeof entries = [];
  const habitEntries: typeof entries = [];

  for (const e of entries) {
    if (e.projectId) {
      projectEntries.push(e);
      continue;
    }
    if (e.habitCheckInId) {
      habitEntries.push(e);
      continue;
    }
    if (!e.categoryId) continue;
    const cat = categoryById.get(e.categoryId);
    const key = e.categoryId;
    const bucket = byCategory.get(key) ?? {
      categoryId: key,
      name: cat?.name ?? "بدون دسته‌بندی",
      icon: cat?.icon ?? null,
      total: 0,
      entries: [],
    };
    bucket.total += e.totalValue;
    bucket.entries.push(e);
    byCategory.set(key, bucket);
  }

  return {
    entries,
    total,
    byCategory: Array.from(byCategory.values()).sort((a, b) => b.total - a.total),
    projectEntries,
    habitEntries,
  };
}

function attachHabit(habitCheckIn: HabitCheckInRow | undefined, habitById: Map<string, RelatedRow>) {
  if (!habitCheckIn) return null;
  return { ...habitCheckIn, habit: habitById.get(habitCheckIn.habitId) ?? null };
}
