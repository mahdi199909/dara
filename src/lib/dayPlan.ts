// «برنامه‌ریزی روز»: the day as blocks on a timeline (time blocking) and the day's tasks with the time box each is given
// (time boxing). Pure: the screen fetches what /api/events answers for a day and this turns it into positions, lanes,
// free gaps and totals, so what is drawn can be tested.
//
// A block is anything with a start and an end that day — a task with a time, an event that is not all-day. A task
// without a time of day is not on the timeline; it waits in the tray until the person gives it a place.

type EventsAnswer = { occurrences?: any[]; taskOccurrences?: any[] };

export interface PlanBlock {
  key: string;
  kind: "TASK" | "EVENT";
  id: string;
  title: string;
  /** Minutes from the day's local midnight; an item that began the day before starts at 0. */
  startMin: number;
  /** Minutes from the day's midnight; one that runs past it ends at 1440. */
  endMin: number;
  done: boolean;
  /** The category colour, when it has one. */
  color: string | null;
}

export interface TrayTask {
  id: string;
  title: string;
  /** The time box the person gave it, in minutes. */
  boxMinutes: number | null;
  color: string | null;
  categoryId: string | null;
  /** Whether it already has a time of day (a block on the timeline). */
  timed: boolean;
}

/** A block someone can do something about on a row of the timeline. */
export interface LaidOutBlock extends PlanBlock {
  /** Which column of an overlapping group it sits in, 0-based. */
  lane: number;
  /** How many columns that group has. */
  lanes: number;
}

/** What a task with a start but no end is given as a length on the timeline. */
export const DEFAULT_BLOCK_MIN = 30;
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;
export const BOX_CHOICES = [15, 25, 45, 60, 90, 120] as const;

function minutesOfDay(iso: string, dayStart: number): number {
  return Math.round((new Date(iso).getTime() - dayStart) / 60_000);
}

function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

function trayTask(task: any, timed: boolean): TrayTask {
  return {
    id: task.id,
    title: task.title,
    boxMinutes: typeof task.boxMinutes === "number" ? task.boxMinutes : null,
    color: task.category?.color ?? null,
    categoryId: task.categoryId ?? null,
    timed,
  };
}

/**
 * Every open task of the day — with a time or without — for the boxes: a box (how long it may take) is independent of
 * where, or whether, the task sits on the timeline. Those with a time come first, in order of it.
 */
export function openTasksOfDay(data: EventsAnswer | undefined): TrayTask[] {
  const open = (data?.taskOccurrences ?? []).filter((task) => task.status === "TODO");
  const timed = open.filter((task) => task.startAt).sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  const untimed = open.filter((task) => !task.startAt);
  return [...timed.map((task) => trayTask(task, true)), ...untimed.map((task) => trayTask(task, false))];
}

/** The timeline of a day: the blocks that have a time, the all-day events, and the open tasks that have no time yet. */
export function planOfDay(data: EventsAnswer | undefined, day: Date): { blocks: PlanBlock[]; allDay: Array<{ id: string; title: string; done: boolean }>; tray: TrayTask[] } {
  const start = startOfDay(day);
  const dayStart = start.getTime();
  const blocks: PlanBlock[] = [];
  const allDay: Array<{ id: string; title: string; done: boolean }> = [];
  const tray: TrayTask[] = [];

  for (const occ of data?.occurrences ?? []) {
    if (occ.event.allDay) {
      allDay.push({ id: occ.event.id, title: occ.event.title, done: Boolean(occ.isDone) });
      continue;
    }
    const from = Math.max(0, minutesOfDay(occ.startAt, dayStart));
    const to = Math.min(1440, minutesOfDay(occ.endAt, dayStart));
    if (to <= from) continue;
    blocks.push({ key: `event-${occ.event.id}-${occ.startAt}`, kind: "EVENT", id: occ.event.id, title: occ.event.title, startMin: from, endMin: to, done: Boolean(occ.isDone), color: occ.event.category?.color ?? null });
  }

  for (const task of data?.taskOccurrences ?? []) {
    if (task.status === "CANCELLED") continue;
    if (task.startAt) {
      const from = minutesOfDay(task.startAt, dayStart);
      // A task shows on the day its start is on; one only due this day (with a start on another) is not drawn twice.
      if (from < 0 || from >= 1440) continue;
      const to = task.endAt ? Math.min(1440, minutesOfDay(task.endAt, dayStart)) : Math.min(1440, from + DEFAULT_BLOCK_MIN);
      if (to <= from) continue;
      blocks.push({ key: `task-${task.id}`, kind: "TASK", id: task.id, title: task.title, startMin: from, endMin: to, done: task.status === "DONE", color: task.category?.color ?? null });
    } else if (task.status === "TODO") {
      tray.push(trayTask(task, false));
    }
  }

  blocks.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  return { blocks, allDay, tray };
}

/** Puts overlapping blocks side by side: each gets a column, and every block of a group knows how many columns the group needs. */
export function layOutBlocks(blocks: readonly PlanBlock[]): LaidOutBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: LaidOutBlock[] = [];
  let group: LaidOutBlock[] = [];
  let groupEnd = -1;
  let laneEnds: number[] = [];

  const closeGroup = () => {
    for (const block of group) block.lanes = laneEnds.length;
    placed.push(...group);
    group = [];
    laneEnds = [];
  };

  for (const block of sorted) {
    if (group.length > 0 && block.startMin >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= block.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMin);
    } else {
      laneEnds[lane] = block.endMin;
    }
    group.push({ ...block, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, block.endMin);
  }
  closeGroup();
  return placed;
}

/** The part of the day the timeline draws: the waking hours, widened to hold anything outside them; whole hours. */
export function timelineRange(blocks: readonly PlanBlock[], wakeHour: number, sleepHour: number): { fromMin: number; toMin: number } {
  let from = Math.max(0, Math.min(23, wakeHour)) * 60;
  let to = Math.max(0, Math.min(24, sleepHour)) * 60;
  if (to <= from) {
    // A sleep hour at or before the wake hour (an overnight day) has no window to draw: show the whole day.
    from = 0;
    to = 1440;
  }
  for (const block of blocks) {
    from = Math.min(from, Math.floor(block.startMin / 60) * 60);
    to = Math.max(to, Math.ceil(block.endMin / 60) * 60);
  }
  return { fromMin: Math.max(0, from), toMin: Math.min(1440, to) };
}

export interface Gap {
  startMin: number;
  endMin: number;
}

/** The free stretches between fromMin and toMin that are at least `minLength` long, in order. */
export function freeGaps(blocks: readonly PlanBlock[], fromMin: number, toMin: number, minLength: number): Gap[] {
  const busy = [...blocks].filter((b) => b.endMin > fromMin && b.startMin < toMin).sort((a, b) => a.startMin - b.startMin);
  const gaps: Gap[] = [];
  let cursor = fromMin;
  for (const block of busy) {
    if (block.startMin - cursor >= minLength) gaps.push({ startMin: cursor, endMin: block.startMin });
    cursor = Math.max(cursor, block.endMin);
  }
  if (toMin - cursor >= minLength) gaps.push({ startMin: cursor, endMin: toMin });
  return gaps;
}

/** The earliest minute at which `durationMin` fits without touching a block, not before `notBefore`; null if none does. */
export function firstFreeStart(blocks: readonly PlanBlock[], durationMin: number, fromMin: number, toMin: number, notBefore = 0): number | null {
  const from = Math.max(fromMin, notBefore);
  const gap = freeGaps(blocks, from, toMin, durationMin)[0];
  return gap ? gap.startMin : null;
}

/** Rounds a minute-of-day up to the next multiple of `step` (5 by default) — the first start worth suggesting from "now". */
export function roundUp(minute: number, step = 5): number {
  return Math.ceil(minute / step) * step;
}

/** 540 → "09:00". */
export function clockText(minute: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:30" → 570, or null for text that is not a time. */
export function minutesOfClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

export interface BoxTotals {
  /** The minutes of every box given today. */
  boxed: number;
  /** The tasks that have one, and the open tasks in all. */
  boxedCount: number;
  taskCount: number;
  /** The waking hours of the day, in minutes. */
  awake: number;
  /** What is left of the waking hours after the boxes (negative when the boxes need more than there is). */
  spare: number;
}

export function boxTotals(tasks: ReadonlyArray<{ boxMinutes: number | null }>, wakeHour: number, sleepHour: number): BoxTotals {
  const boxed = tasks.reduce((sum, t) => sum + (t.boxMinutes ?? 0), 0);
  const awake = Math.max(0, (sleepHour > wakeHour ? sleepHour - wakeHour : 24 - wakeHour + sleepHour) * 60);
  return { boxed, boxedCount: tasks.filter((t) => t.boxMinutes !== null).length, taskCount: tasks.length, awake, spare: awake - boxed };
}

/** The sentence over the boxes: plain, and never a verdict on the person. */
export function boxSummary(totals: BoxTotals, formatMinutes: (minutes: number) => string): string {
  if (totals.taskCount === 0) return "کار بازی برای امروز نیست.";
  if (totals.boxedCount === 0) return "هنوز برای هیچ کاری جعبه نگذاشتی.";
  const base = `جعبه‌ها ${formatMinutes(totals.boxed)} از ${formatMinutes(totals.awake)} وقت بیداری‌اند`;
  return totals.spare >= 0 ? `${base}؛ ${formatMinutes(totals.spare)} آزاد می‌ماند.` : `${base}؛ ${formatMinutes(-totals.spare)} بیشتر از وقتی که داری.`;
}
