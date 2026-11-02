// How far along a vision or goal is. Pure — no database here — so the web server and the phone work
// progress out with the very same code from the rows each one reads (see visionServer.ts and
// src/local/repositories/vision.ts).
//
// What counts toward a goal:
//   • the entries the person typed in by hand, and
//   • the finished tasks linked to it (Task.visionItemId / visionValue) — read straight from the tasks, not
//     copied into rows of their own, so un-ticking or deleting a task takes its share back out at once.
import type { VisionEntryView, VisionItemDto, VisionMode, VisionStatus } from "@/lib/schemas/vision";

type DateLike = string | Date | null | undefined;

export interface VisionItemRow {
  id: string;
  parentId: string | null;
  title: string;
  description: string | null;
  icon: string | null;
  color: string;
  status: string;
  sortOrder: number;
  unit: string | null;
  startValue: number;
  targetValue: number | null;
  mode: string;
  targetDate: DateLike;
  achievedAt: DateLike;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface VisionEntryRow {
  id: string;
  itemId: string;
  value: number;
  date: string | Date;
  note: string | null;
}

/** A finished task that carries a link to a goal. */
export interface VisionTaskRow {
  id: string;
  title: string;
  visionItemId: string;
  visionValue: number | null;
  completedAt: DateLike;
  dueDate: DateLike;
  createdAt: string | Date;
}

export interface VisionProjectRow {
  id: string;
  visionItemId: string;
  taskTotal: number;
  taskDone: number;
}

const time = (d: DateLike): number => (d ? new Date(d).getTime() : 0);

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** How much of the way from `start` to `target` the `current` value is (0..1). Works for a target below the start (losing weight) too. */
export function progressRatio(start: number, target: number, current: number): number {
  if (target === start) return current >= target ? 1 : 0;
  return clamp01((current - start) / (target - start));
}

/** The day a finished task counts on: when it was finished, else its due day, else when it was made. */
function taskDate(task: VisionTaskRow): string | Date {
  return task.completedAt ?? task.dueDate ?? task.createdAt;
}

/** Everything that counts toward one item, newest first. */
export function contributionsOf(itemId: string, entries: readonly VisionEntryRow[], tasks: readonly VisionTaskRow[]): VisionEntryView[] {
  const manual: VisionEntryView[] = entries
    .filter((e) => e.itemId === itemId)
    .map((e) => ({ id: e.id, kind: "MANUAL", value: e.value, date: e.date, note: e.note, taskId: null, title: null }));
  const fromTasks: VisionEntryView[] = tasks
    .filter((t) => t.visionItemId === itemId && t.visionValue !== null && t.visionValue !== undefined)
    .map((t) => ({ id: null, kind: "TASK", value: t.visionValue as number, date: taskDate(t), note: null, taskId: t.id, title: t.title }));
  return [...manual, ...fromTasks].sort((a, b) => time(b.date) - time(a.date));
}

/** The yardstick's current value, given the contributions newest first. */
export function currentValueOf(startValue: number, mode: string, contributions: readonly VisionEntryView[]): number {
  if (mode === "SET") return contributions.length > 0 ? contributions[0].value : startValue;
  return contributions.reduce((sum, c) => sum + c.value, startValue);
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Turns the stored rows into what the screens show: every item with its current value and 0..1 progress. */
export function computeVisionItems(
  rows: readonly VisionItemRow[],
  entries: readonly VisionEntryRow[],
  tasks: readonly VisionTaskRow[],
  projects: readonly VisionProjectRow[]
): VisionItemDto[] {
  const dtos = new Map<string, VisionItemDto>();

  // Items with their own yardstick are measured directly.
  for (const row of rows) {
    const contributions = contributionsOf(row.id, entries, tasks);
    const measured = row.targetValue !== null && row.targetValue !== undefined;
    const current = measured ? currentValueOf(row.startValue, row.mode, contributions) : null;
    dtos.set(row.id, {
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      description: row.description,
      icon: row.icon,
      color: row.color,
      status: row.status as VisionStatus,
      sortOrder: row.sortOrder,
      unit: row.unit,
      startValue: row.startValue,
      targetValue: row.targetValue,
      mode: row.mode as VisionMode,
      targetDate: row.targetDate ?? null,
      achievedAt: row.achievedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      current,
      ratio: measured ? progressRatio(row.startValue, row.targetValue as number, current as number) : null,
      entryCount: contributions.length,
    });
  }

  // The rest take the average of what is under them: goals first (their projects), then the visions (their goals and projects).
  const projectRatio = (itemId: string): number[] =>
    projects.filter((p) => p.visionItemId === itemId && p.taskTotal > 0).map((p) => p.taskDone / p.taskTotal);
  const unmeasured = rows.filter((r) => dtos.get(r.id)!.ratio === null);
  const goalsFirst = [...unmeasured.filter((r) => r.parentId !== null), ...unmeasured.filter((r) => r.parentId === null)];
  for (const row of goalsFirst) {
    const dto = dtos.get(row.id)!;
    const childRatios = rows
      .filter((r) => r.parentId === row.id)
      .map((r) => dtos.get(r.id)!.ratio)
      .filter((r): r is number => r !== null);
    dto.ratio = average([...childRatios, ...projectRatio(row.id)]);
  }

  // A vision marked as achieved is complete even when it has nothing to measure.
  for (const dto of dtos.values()) if (dto.ratio === null && dto.status === "ACHIEVED") dto.ratio = 1;

  return rows.map((r) => dtos.get(r.id)!);
}

/** True when the item is the kind a task can count toward: it has a target to measure against. */
export function isMeasured(row: { targetValue: number | null }): boolean {
  return row.targetValue !== null && row.targetValue !== undefined;
}
