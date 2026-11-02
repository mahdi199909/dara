// The server's asset-basket reads and writes, used by src/app/api/basket/**/route.ts. The phone's twin is
// src/local/repositories/basket.ts — same validation, same order, same messages; the sums are worked out by
// src/lib/basket.ts on both sides.
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/apiError";
import { jalaliDateKey } from "@/lib/jalali";
import { computeBasket, snapshotPoints, type BasketRange, type PriceMap } from "@/lib/basket";
import { BASKET_MESSAGES, type BasketHoldingDto, type BasketPointDto, type CreateBasketHoldingInput, type UpdateBasketHoldingInput } from "@/lib/schemas/basket";

export async function listBasketHoldings(userId: string): Promise<BasketHoldingDto[]> {
  const rows = await prisma.basketHolding.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
}

function toDto(row: { id: string; assetKey: string; quantity: number; note: string | null; createdAt: Date; updatedAt: Date }): BasketHoldingDto {
  return { id: row.id, assetKey: row.assetKey, quantity: row.quantity, note: row.note, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function getOwnedBasketHolding(userId: string, id: string) {
  const row = await prisma.basketHolding.findFirst({ where: { id, userId, deletedAt: null } });
  if (!row) throw new ApiError(BASKET_MESSAGES.notFound, 404);
  return row;
}

export async function createBasketHolding(userId: string, input: CreateBasketHoldingInput): Promise<BasketHoldingDto> {
  const existing = await prisma.basketHolding.findFirst({ where: { userId, assetKey: input.assetKey, deletedAt: null } });
  if (existing) throw new ApiError(BASKET_MESSAGES.alreadyInBasket, 409);
  const created = await prisma.basketHolding.create({ data: { userId, assetKey: input.assetKey, quantity: input.quantity, note: input.note ?? null } });
  return toDto(created);
}

export async function updateBasketHolding(userId: string, id: string, input: UpdateBasketHoldingInput): Promise<BasketHoldingDto> {
  await getOwnedBasketHolding(userId, id);
  const updated = await prisma.basketHolding.update({
    where: { id },
    data: {
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
  return toDto(updated);
}

export async function deleteBasketHolding(userId: string, id: string): Promise<{ ok: true }> {
  await getOwnedBasketHolding(userId, id);
  const now = new Date();
  await prisma.basketHolding.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
  return { ok: true };
}

export interface RecordedSnapshot {
  /** False when there was nothing true to record: an empty basket, or a holding with no price yet. */
  recorded: boolean;
  /** The day's total in Toman when it could be worked out. */
  total: number | null;
  date: string;
}

/**
 * Stores today's value of the basket for the chart. The prices come from the caller (the page has just read them);
 * the holdings are read here, so the number always matches what is really in the basket. A day is written only when
 * every holding has a price — a total that leaves one out would draw a false dip — and only when it differs from
 * what the day already holds, so reopening the page all day does not keep making the row look edited.
 */
export async function recordBasketSnapshot(userId: string, prices: PriceMap, now: Date = new Date()): Promise<RecordedSnapshot> {
  const date = jalaliDateKey(now);
  const holdings = await prisma.basketHolding.findMany({ where: { userId, deletedAt: null }, select: { id: true, assetKey: true, quantity: true, createdAt: true } });
  const summary = computeBasket(holdings, prices);
  if (!summary.complete) return { recorded: false, total: summary.lines.length === 0 ? null : summary.total, date };

  const today = await prisma.basketSnapshot.findFirst({ where: { userId, date }, orderBy: { updatedAt: "desc" } });
  if (!today) {
    await prisma.basketSnapshot.create({ data: { userId, date, totalValue: summary.total } });
  } else if (today.totalValue !== summary.total) {
    await prisma.basketSnapshot.update({ where: { id: today.id }, data: { totalValue: summary.total } });
  }
  return { recorded: true, total: summary.total, date };
}

export async function listBasketPoints(userId: string, range: BasketRange, now: Date = new Date()): Promise<BasketPointDto[]> {
  const rows = await prisma.basketSnapshot.findMany({ where: { userId }, select: { id: true, date: true, totalValue: true, updatedAt: true } });
  return snapshotPoints(rows, range, now);
}
