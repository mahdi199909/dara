"use client";

import { useCallback, useMemo } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import { apiDelete, apiPatch, apiPost, fetcher } from "@/lib/apiClient";
import { dayKeyIso, parseDayKey } from "@/lib/calendarGrid";
import { MEAL_KINDS, type MealData, type MealEntry, type MealKind } from "@/lib/meals";
import type { MealDto } from "@/lib/schemas/meals";

/** How many days back the page reads: enough for the week chart and for the meals the person writes most often. */
export const MEALS_WINDOW_DAYS = 90;

export interface MealInput {
  day: string;
  kind: MealKind;
  title: string;
  kcal: number;
}

/**
 * The athlete's meals for the window of days ending with `day`, and the daily target — both from the account (the
 * target is Settings.calorieTarget) — with the ways to write them. A change goes to the API (so to the phone's own
 * database on Android, and from there to the server by sync) and the lists read again.
 */
export function useMeals(day: string): {
  data: MealData | undefined;
  add: (input: MealInput) => Promise<void>;
  update: (id: string, patch: Partial<Omit<MealInput, "day">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  saveTarget: (target: number | null) => Promise<void>;
} {
  const end = parseDayKey(day) ?? new Date();
  const from = dayKeyIso(new Date(end.getFullYear(), end.getMonth(), end.getDate() - (MEALS_WINDOW_DAYS - 1)));
  const { data: mealsAnswer } = useSWR<{ meals: MealDto[] }>(`/api/meals?from=${from}&to=${day}`, fetcher, { keepPreviousData: true });
  const { data: settingsAnswer, mutate: mutateSettings } = useSWR<{ settings: { calorieTarget: number | null } }>("/api/settings", fetcher);

  const data = useMemo<MealData | undefined>(() => {
    if (!mealsAnswer || !settingsAnswer) return undefined;
    const entries: MealEntry[] = mealsAnswer.meals
      .filter((meal) => (MEAL_KINDS as readonly string[]).includes(meal.kind))
      .map((meal) => ({ id: meal.id, day: meal.day, kind: meal.kind as MealKind, title: meal.title, kcal: meal.kcal }));
    return { v: 1, target: settingsAnswer.settings.calorieTarget ?? null, entries };
  }, [mealsAnswer, settingsAnswer]);

  const refresh = useCallback(() => mutateGlobal((key) => typeof key === "string" && key.startsWith("/api/meals")), []);

  const add = useCallback(
    async (input: MealInput) => {
      await apiPost("/api/meals", input);
      await refresh();
    },
    [refresh]
  );
  const update = useCallback(
    async (id: string, patch: Partial<Omit<MealInput, "day">>) => {
      await apiPatch(`/api/meals/${id}`, patch);
      await refresh();
    },
    [refresh]
  );
  const remove = useCallback(
    async (id: string) => {
      await apiDelete(`/api/meals/${id}`);
      await refresh();
    },
    [refresh]
  );
  const saveTarget = useCallback(
    async (target: number | null) => {
      await apiPatch("/api/settings", { calorieTarget: target });
      await mutateSettings();
    },
    [mutateSettings]
  );

  return { data, add, update, remove, saveTarget };
}
