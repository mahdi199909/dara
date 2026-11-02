// On-device equivalent of src/lib/mealsServer.ts (+ the /api/meals routes) — same validation (shared schemas from
// @/lib/schemas/meals), same order, same 404 message and response shapes.
import { ApiError } from "@/lib/apiErrorBase";
import { MEAL_MESSAGES, type CreateMealInput, type MealDto, type MealsRange, type UpdateMealInput } from "@/lib/schemas/meals";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface MealDbRow {
  id: string;
  userId: string;
  day: string;
  kind: string;
  title: string;
  kcal: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function now() {
  return new Date().toISOString();
}

function toDto(row: MealDbRow): MealDto {
  return { id: row.id, day: row.day, kind: row.kind, title: row.title, kcal: row.kcal, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function listMeals(db: LocalDb, userId: string, range: MealsRange): MealDto[] {
  return db
    .all<MealDbRow>(`SELECT * FROM "MealEntry" WHERE "userId" = ? AND "deletedAt" IS NULL AND "day" >= ? AND "day" <= ? ORDER BY "day" ASC, "createdAt" ASC`, [userId, range.from, range.to])
    .map(toDto);
}

function getOwnedRow(db: LocalDb, userId: string, id: string): MealDbRow {
  const row = db.get<MealDbRow>(`SELECT * FROM "MealEntry" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError(MEAL_MESSAGES.notFound, 404);
  return row;
}

export function createMeal(db: LocalDb, userId: string, input: CreateMealInput): MealDto {
  const id = crypto.randomUUID();
  const ts = now();
  db.run(`INSERT INTO "MealEntry" ("id","userId","day","kind","title","kcal","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`, [id, userId, input.day, input.kind, input.title, input.kcal, ts, ts]);
  const dto = toDto(getOwnedRow(db, userId, id));
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "MealEntry", entityId: id, newValue: dto });
  return dto;
}

export function updateMeal(db: LocalDb, userId: string, id: string, input: UpdateMealInput): MealDto {
  const existing = getOwnedRow(db, userId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`"${column}" = ?`);
    params.push(value);
  };
  if (input.day !== undefined) set("day", input.day);
  if (input.kind !== undefined) set("kind", input.kind);
  if (input.title !== undefined) set("title", input.title);
  if (input.kcal !== undefined) set("kcal", input.kcal);
  set("updatedAt", now());
  db.run(`UPDATE "MealEntry" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);
  const dto = toDto(getOwnedRow(db, userId, id));
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "MealEntry", entityId: id, oldValue: toDto(existing), newValue: dto });
  return dto;
}

export function deleteMeal(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "MealEntry" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "MealEntry", entityId: id, oldValue: toDto(existing) });
  return { ok: true };
}
