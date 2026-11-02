"use client";

import { useMemo } from "react";
import { removeDeviceKey, useDeviceJson } from "@/lib/deviceStore";
import { CYCLE_STORAGE_KEY, sanitizeCycle, type CycleData } from "@/lib/cycle";

/** The periods the person wrote down, read from this device (never from the database), and a way to write them back. */
export function useCycle(): { data: CycleData; save: (next: CycleData) => void } {
  const [raw, set] = useDeviceJson<unknown>(CYCLE_STORAGE_KEY, null);
  const data = useMemo(() => sanitizeCycle(raw), [raw]);
  return { data, save: set };
}

/** Forgets every period on this device. */
export function clearCycleData(): void {
  removeDeviceKey(CYCLE_STORAGE_KEY);
}
