// On-device equivalent of src/lib/basketServer.ts (+ the /api/basket routes) — same validation (shared schemas from
// @/lib/schemas/basket), same order, same 404/409 messages and response shapes. The sums are worked out by
// src/lib/basket.ts, the same code the server runs.
import { ApiError } from "@/lib/apiErrorBase";
import { jalaliDateKey } from "@/lib/jalali";
import { computeBasket, snapshotPoints, type BasketRange, type PriceMap } from "@/lib/basket";
import {
  BASKET_MESSAGES,
  type BasketHoldingDto,
  type BasketPointDto,
  type CreateBasketHoldingInput,
  type UpdateBasketHoldingInput,
} from "@/lib/schemas/basket";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface HoldingDbRow {
  id: string;
  userId: string;
  assetKey: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function now() {
  return new Date().toISOString();
}

function toDto(row: HoldingDbRow): BasketHoldingDto {
  return { id: row.id, assetKey: row.assetKey, quantity: row.quantity, note: row.note, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function listBasketHoldings(db: LocalDb, userId: string): BasketHoldingDto[] {
  return db.all<HoldingDbRow>(`SELECT * FROM "BasketHolding" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`, [userId]).map(toDto);
}

function getOwnedRow(db: LocalDb, userId: string, id: string): HoldingDbRow {
  const row = db.get<HoldingDbRow>(`SELECT * FROM "BasketHolding" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError(BASKET_MESSAGES.notFound, 404);
  return row;
}

export function createBasketHolding(db: LocalDb, userId: string, input: CreateBasketHoldingInput): BasketHoldingDto {
  const existing = db.get<{ id: string }>(`SELECT "id" FROM "BasketHolding" WHERE "userId" = ? AND "assetKey" = ? AND "deletedAt" IS NULL`, [userId, input.assetKey]);
  if (existing) throw new ApiError(BASKET_MESSAGES.alreadyInBasket, 409);
  const id = crypto.randomUUID();
  const ts = now();
  db.run(`INSERT INTO "BasketHolding" ("id","userId","assetKey","quantity","note","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?)`, [
    id,
    userId,
    input.assetKey,
    input.quantity,
    input.note ?? null,
    ts,
    ts,
  ]);
  const dto = toDto(getOwnedRow(db, userId, id));
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "BasketHolding", entityId: id, newValue: dto });
  return dto;
}

export function updateBasketHolding(db: LocalDb, userId: string, id: string, input: UpdateBasketHoldingInput): BasketHoldingDto {
  const existing = getOwnedRow(db, userId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.quantity !== undefined) {
    sets.push(`"quantity" = ?`);
    params.push(input.quantity);
  }
  if (input.note !== undefined) {
    sets.push(`"note" = ?`);
    params.push(input.note);
  }
  sets.push(`"updatedAt" = ?`);
  params.push(now());
  db.run(`UPDATE "BasketHolding" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);
  const dto = toDto(getOwnedRow(db, userId, id));
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "BasketHolding", entityId: id, oldValue: toDto(existing), newValue: dto });
  return dto;
}

export function deleteBasketHolding(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "BasketHolding" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "BasketHolding", entityId: id, oldValue: toDto(existing) });
  return { ok: true };
}

export interface RecordedSnapshot {
  recorded: boolean;
  total: number | null;
  date: string;
}

/** See recordBasketSnapshot in src/lib/basketServer.ts — the same rules. */
export function recordBasketSnapshot(db: LocalDb, userId: string, prices: PriceMap, at: Date = new Date()): RecordedSnapshot {
  const date = jalaliDateKey(at);
  const holdings = db.all<{ id: string; assetKey: string; quantity: number; createdAt: string }>(
    `SELECT "id","assetKey","quantity","createdAt" FROM "BasketHolding" WHERE "userId" = ? AND "deletedAt" IS NULL`,
    [userId]
  );
  const summary = computeBasket(holdings, prices);
  if (!summary.complete) return { recorded: false, total: summary.lines.length === 0 ? null : summary.total, date };

  const today = db.get<{ id: string; totalValue: number }>(
    `SELECT "id","totalValue" FROM "BasketSnapshot" WHERE "userId" = ? AND "date" = ? ORDER BY "updatedAt" DESC LIMIT 1`,
    [userId, date]
  );
  const ts = now();
  if (!today) {
    db.run(`INSERT INTO "BasketSnapshot" ("id","userId","date","totalValue","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [crypto.randomUUID(), userId, date, summary.total, ts, ts]);
  } else if (today.totalValue !== summary.total) {
    db.run(`UPDATE "BasketSnapshot" SET "totalValue" = ?, "updatedAt" = ? WHERE "id" = ?`, [summary.total, ts, today.id]);
  }
  return { recorded: true, total: summary.total, date };
}

export function listBasketPoints(db: LocalDb, userId: string, range: BasketRange, at: Date = new Date()): BasketPointDto[] {
  const rows = db.all<{ id: string; date: string; totalValue: number; updatedAt: string }>(
    `SELECT "id","date","totalValue","updatedAt" FROM "BasketSnapshot" WHERE "userId" = ?`,
    [userId]
  );
  return snapshotPoints(rows, range, at);
}
