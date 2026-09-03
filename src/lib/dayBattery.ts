// Pure day-timeline math for the Home page's DayBattery — no DB access, no Date.now(), fully
// deterministic and testable in isolation. See src/lib/reportEngine.ts / src/local/reportEngine.ts
// for the DB-fetching wrappers (computeDayBattery) that resolve `intervals` from
// Activity/TimeEntry, Task, and completed Event occurrences and call computeDaySegments below.
//
// HabitCheckIn is deliberately never a source here: it carries a real durationMin but no real
// clock-time slot within the day (just a date normalized to midnight) — this is a chronological
// timeline, so there's no honest position to place it at. It still counts toward "سرمایه من"
// (see computeFounderCapital), which is a plain aggregate with no positional claim.
export type CategoryKindForBattery = "PRODUCTIVE" | "NEUTRAL" | "WASTE";
export type DaySegmentKind = CategoryKindForBattery | "UNLOGGED" | "REMAINING";

export interface TimedInterval {
  start: Date;
  end: Date;
  kind: CategoryKindForBattery;
}

export interface DaySegment {
  kind: DaySegmentKind;
  start: Date;
  end: Date;
  minutes: number;
}

export interface DayBatteryResult {
  segments: DaySegment[];
  capacityMinutes: number;
  loggedMinutes: number;
  unloggedMinutes: number;
  remainingMinutes: number;
  dayOver: boolean;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/**
 * Walks the user's waking-hours window (wakeTime -> sleepTime) chronologically, turning
 * possibly-overlapping logged intervals into a flat, ordered sequence of segments: each logged
 * interval keeps its own category kind, every gap between them becomes an UNLOGGED segment (past,
 * un-tracked), and whatever's left after `now` — or after sleepTime, once the day is over —
 * becomes a single REMAINING segment (future, hasn't happened yet, never "unlogged"). Overlapping
 * intervals are resolved by processing order (earliest start first): whichever interval starts
 * first keeps its full duration, and a later-starting one that overlaps its tail is truncated to
 * just its non-overlapping remainder.
 *
 * sleepHour <= wakeHour (misconfigured, or an unsupported overnight schedule) degrades to a
 * capacity-0 result rather than negative-duration segments.
 */
export function computeDaySegments(wakeTime: Date, sleepTime: Date, now: Date, intervals: TimedInterval[]): DayBatteryResult {
  const capacityMinutes = minutesBetween(wakeTime, sleepTime);
  if (capacityMinutes <= 0) {
    return { segments: [], capacityMinutes: 0, loggedMinutes: 0, unloggedMinutes: 0, remainingMinutes: 0, dayOver: true };
  }

  const dayOver = now.getTime() >= sleepTime.getTime();
  // Clamped to wakeTime too: opening the app before today's configured wake hour must still
  // read as "0 elapsed, all REMAINING" rather than a REMAINING segment starting before the
  // capacity window's own start.
  const elapsedEnd = dayOver ? sleepTime : now < wakeTime ? wakeTime : now;

  const clipped = intervals
    .map((iv) => ({
      kind: iv.kind,
      start: iv.start < wakeTime ? wakeTime : iv.start,
      end: iv.end > elapsedEnd ? elapsedEnd : iv.end,
    }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const segments: DaySegment[] = [];
  let cursor = wakeTime;

  for (const iv of clipped) {
    const start = iv.start < cursor ? cursor : iv.start;
    if (start >= iv.end) continue; // fully covered by a previous, later-ending interval

    if (start > cursor) {
      segments.push({ kind: "UNLOGGED", start: cursor, end: start, minutes: minutesBetween(cursor, start) });
    }
    segments.push({ kind: iv.kind, start, end: iv.end, minutes: minutesBetween(start, iv.end) });
    cursor = iv.end;
  }

  if (cursor < elapsedEnd) {
    segments.push({ kind: "UNLOGGED", start: cursor, end: elapsedEnd, minutes: minutesBetween(cursor, elapsedEnd) });
  }
  if (elapsedEnd < sleepTime) {
    segments.push({ kind: "REMAINING", start: elapsedEnd, end: sleepTime, minutes: minutesBetween(elapsedEnd, sleepTime) });
  }

  const sumKind = (kinds: DaySegmentKind[]) => segments.filter((s) => kinds.includes(s.kind)).reduce((sum, s) => sum + s.minutes, 0);

  return {
    segments,
    capacityMinutes,
    loggedMinutes: sumKind(["PRODUCTIVE", "NEUTRAL", "WASTE"]),
    unloggedMinutes: sumKind(["UNLOGGED"]),
    remainingMinutes: sumKind(["REMAINING"]),
    dayOver,
  };
}
