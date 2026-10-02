// The timer screen's own history: what «زمان‌سنج» saved (tasks with source TIMER), per day for the
// last week. Only real rows are counted — no streaks or scores, compared only with the person's own days.
import { dayKeyIso } from "@/lib/calendarGrid";

export interface TimerSessionRow {
  id: string;
  title: string;
  startAt: string | Date | null;
  endAt: string | Date | null;
  category?: { name: string; icon?: string | null } | null;
}

export interface TimerStats {
  todayMin: number;
  todaySessions: number;
  weekMin: number;
  /** Oldest first, seven days ending today. */
  days: { day: string; minutes: number; isToday: boolean }[];
  recent: { id: string; title: string; minutes: number; endAt: Date; category: string | null }[];
}

function minutesOf(row: TimerSessionRow): number {
  if (!row.startAt || !row.endAt) return 0;
  return Math.max(0, Math.round((new Date(row.endAt).getTime() - new Date(row.startAt).getTime()) / 60_000));
}

export function summarizeTimerSessions(rows: TimerSessionRow[], now: Date, recentCount = 8): TimerStats {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
    return { day: dayKeyIso(d), minutes: 0, isToday: i === 6 };
  });
  const index = new Map(days.map((d, i) => [d.day, i]));
  const today = days[6].day;
  let todaySessions = 0;

  const timed = rows.filter((r) => r.startAt && r.endAt);
  for (const row of timed) {
    const key = dayKeyIso(new Date(row.endAt!));
    const i = index.get(key);
    if (i === undefined) continue;
    days[i].minutes += minutesOf(row);
    if (key === today) todaySessions++;
  }

  const recent = [...timed]
    .sort((a, b) => new Date(b.endAt!).getTime() - new Date(a.endAt!).getTime())
    .slice(0, recentCount)
    .map((r) => ({ id: r.id, title: r.title, minutes: minutesOf(r), endAt: new Date(r.endAt!), category: r.category ? `${r.category.icon ?? ""} ${r.category.name}`.trim() : null }));

  return { todayMin: days[6].minutes, todaySessions, weekMin: days.reduce((s, d) => s + d.minutes, 0), days, recent };
}
