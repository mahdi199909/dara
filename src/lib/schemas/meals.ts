// Shared between src/app/api/meals/**/route.ts (web) and src/local/repositories/meals.ts (on-device) so both validate
// identically, and by the page for what the API answers.
import { z } from "zod";
import { parseDayKey } from "@/lib/calendarGrid";
import { MAX_KCAL, MEAL_KINDS } from "@/lib/meals";

/** What the API answers when something is wrong — the same words on the web server and on the phone. */
export const MEAL_MESSAGES = {
  notFound: "این وعده پیدا نشد.",
  badRange: "بازهٔ روزها درست نیست.",
} as const;

/** The longest stretch of days one request may ask for (the page reads about three months). */
export const MAX_MEAL_RANGE_DAYS = 400;

const dayText = z.string({ message: "روز را درست انتخاب کن." }).refine((value) => parseDayKey(value) !== null, { message: "روز را درست انتخاب کن." });
const kind = z.enum(MEAL_KINDS, { message: "وعده را انتخاب کن." });
const title = z.string({ message: "اسم غذا را بنویس." }).trim().min(1, "اسم غذا را بنویس.").max(100, "اسم غذا حداکثر ۱۰۰ نویسه می‌تواند باشد.");
const kcal = z
  .number({ message: "کالری باید عدد باشد." })
  .int("کالری باید عدد صحیح باشد.")
  .min(1, "کالری باید دست‌کم ۱ باشد.")
  .max(MAX_KCAL, "کالری بیش از حد بزرگ است.");

export const createMealSchema = z.object({ day: dayText, kind, title, kcal });
export type CreateMealInput = z.infer<typeof createMealSchema>;

export const updateMealSchema = z.object({ day: dayText.optional(), kind: kind.optional(), title: title.optional(), kcal: kcal.optional() });
export type UpdateMealInput = z.infer<typeof updateMealSchema>;

/** The days a list asks for, both ends included, "YYYY-MM-DD". */
export const mealsRangeSchema = z
  .object({ from: dayText, to: dayText })
  .refine((range) => range.from <= range.to, { message: MEAL_MESSAGES.badRange })
  .refine(
    (range) => {
      const from = parseDayKey(range.from);
      const to = parseDayKey(range.to);
      return !!from && !!to && (to.getTime() - from.getTime()) / 86_400_000 <= MAX_MEAL_RANGE_DAYS;
    },
    { message: MEAL_MESSAGES.badRange }
  );
export type MealsRange = z.infer<typeof mealsRangeSchema>;

/** A meal as both sides return it. */
export interface MealDto {
  id: string;
  day: string;
  kind: string;
  title: string;
  kcal: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}
