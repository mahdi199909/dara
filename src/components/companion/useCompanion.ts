"use client";

// Wires the Companion to data that already exists on the client — deliberately zero new
// endpoints (see the product brief): /api/day-battery for today's logged/unlogged minutes,
// /api/settings for wake/sleep hours + the daily target + the enable toggle, and useHabits for
// today's habit minutes (DayBattery's own segments never include habits — see dayBattery.ts's
// header comment on why). This means Android and web share this hook unchanged: both already
// have local mirrors of /api/day-battery and /api/settings wired into localDispatcher.ts.
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { useHabits } from "@/lib/hooks";
import { computeCompanionState, companionMessageSeed, type CompanionState } from "@/lib/companion";

interface DayBatterySegmentDto {
  kind: "PRODUCTIVE" | "NEUTRAL" | "WASTE" | "UNLOGGED" | "REMAINING";
  start: string;
  end: string;
  minutes: number;
}
interface DayBatteryDto {
  segments: DayBatterySegmentDto[];
  capacityMinutes: number;
  unloggedMinutes: number;
}
interface SettingsDto {
  wakeHour: number;
  sleepHour: number;
  dailyProductiveTargetMin: number;
  companionEnabled: boolean;
}

export interface UseCompanionResult {
  state: CompanionState | null;
  enabled: boolean;
}

function sumByKind(segments: DayBatterySegmentDto[], kind: DaySegmentKindFilter): number {
  return segments.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.minutes, 0);
}
type DaySegmentKindFilter = "PRODUCTIVE" | "WASTE" | "NEUTRAL";

export function useCompanion(): UseCompanionResult {
  const { data: batteryData } = useSWR<{ battery: DayBatteryDto }>("/api/day-battery", fetcher);
  const { data: settingsData } = useSWR<{ settings: SettingsDto; user: { id: string } | null }>("/api/settings", fetcher);
  const { habits } = useHabits();

  const enabled = settingsData ? settingsData.settings.companionEnabled !== false : false;
  if (!batteryData || !settingsData || !enabled) return { state: null, enabled };

  const { battery } = batteryData;
  const { settings, user } = settingsData;
  const now = new Date();
  const wakeTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), settings.wakeHour, 0, 0, 0);
  const sleepTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), settings.sleepHour, 0, 0, 0);

  const habitMinutes = habits.reduce((sum: number, h: { checkedInToday?: boolean; todayDurationMin?: number }) => {
    return sum + (h.checkedInToday ? h.todayDurationMin ?? 0 : 0);
  }, 0);
  const loggedEntriesToday = battery.segments.filter((s) => s.kind !== "UNLOGGED" && s.kind !== "REMAINING").length;

  const seed = companionMessageSeed(user?.id ?? "local", now);
  const state = computeCompanionState(
    {
      now,
      wakeTime,
      sleepTime,
      productiveMinutes: sumByKind(battery.segments, "PRODUCTIVE"),
      habitMinutes,
      wasteMinutes: sumByKind(battery.segments, "WASTE"),
      neutralMinutes: sumByKind(battery.segments, "NEUTRAL"),
      unloggedMinutes: battery.unloggedMinutes,
      targetMinutes: settings.dailyProductiveTargetMin,
      loggedEntriesToday,
    },
    seed
  );

  return { state, enabled };
}
