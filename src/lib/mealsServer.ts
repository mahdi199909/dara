// The server's meal reads and writes, used by src/app/api/meals/**/route.ts. The phone's twin is
// src/local/repositories/meals.ts — same validation, same order, same messages; the sums and the meter are worked out
// by src/lib/meals.ts on both sides (and in the browser, from the rows these return).
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/apiError";
import { MEAL_MESSAGES, type CreateMealInput, type MealDto, type MealsRange, type UpdateMealInput } from "@/lib/schemas/meals";

function toDto(row: { id: string; day: string; kind: string; title: string; kcal: number; createdAt: Date; updatedAt: Date }): MealDto {
  return { id: row.id, day: row.day, kind: row.kind, title: row.title, kcal: row.kcal, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** The meals of the days from..to (both included), by day and then in the order they were written. */
export async function listMeals(userId: string, range: MealsRange): Promise<MealDto[]> {
  const rows = await prisma.mealEntry.findMany({
    where: { userId, deletedAt: null, day: { gte: range.from, lte: range.to } },
    orderBy: [{ day: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDto);
}

export async function getOwnedMeal(userId: string, id: string) {
  const row = await prisma.mealEntry.findFirst({ where: { id, userId, deletedAt: null } });
  if (!row) throw new ApiError(MEAL_MESSAGES.notFound, 404);
  return row;
}

export async function createMeal(userId: string, input: CreateMealInput): Promise<MealDto> {
  const created = await prisma.mealEntry.create({ data: { userId, day: input.day, kind: input.kind, title: input.title, kcal: input.kcal } });
  return toDto(created);
}

export async function updateMeal(userId: string, id: string, input: UpdateMealInput): Promise<MealDto> {
  await getOwnedMeal(userId, id);
  const updated = await prisma.mealEntry.update({
    where: { id },
    data: {
      ...(input.day !== undefined ? { day: input.day } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.kcal !== undefined ? { kcal: input.kcal } : {}),
    },
  });
  return toDto(updated);
}

export async function deleteMeal(userId: string, id: string): Promise<{ ok: true }> {
  await getOwnedMeal(userId, id);
  const now = new Date();
  await prisma.mealEntry.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
  return { ok: true };
}
