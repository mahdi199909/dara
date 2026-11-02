"use client";

import { useMemo } from "react";
import { useDeviceJson } from "@/lib/deviceStore";
import { MEALS_STORAGE_KEY, sanitizeMeals, type MealData } from "@/lib/meals";

/** The athlete's meals and daily target, read from this device (never from the database), and a way to write them back. */
export function useMeals(): { data: MealData; save: (next: MealData) => void } {
  const [raw, set] = useDeviceJson<unknown>(MEALS_STORAGE_KEY, null);
  const data = useMemo(() => sanitizeMeals(raw), [raw]);
  return { data, save: set };
}
