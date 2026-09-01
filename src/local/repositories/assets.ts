// On-device equivalent of src/app/api/assets/route.ts + src/app/api/assets/[id]/route.ts —
// same validation (shared schemas from @/lib/schemas/assets), same field defaults, same audit
// actions, same 404 message, and the same "changing currentValue on PATCH also creates an
// AssetTransaction" side effect, so the local dispatcher (Phase 3) can return byte-identical
// shapes regardless of whether it's backed by this repository or the real HTTP routes.
//
// getAsset also reads Transaction rows linked to this asset (assetId), same as the web route's
// `prisma.transaction.findMany({ where: { assetId } })` — this only *reads* that table via raw
// SQL; it does not import or depend on another agent's in-progress Transaction repository.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateAssetInput, UpdateAssetInput } from "@/lib/schemas/assets";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import type { TransactionRow } from "./installments";

export interface AssetRow {
  id: string;
  userId: string;
  name: string;
  category: string | null;
  purchasePrice: number;
  purchaseDate: string;
  currentValue: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AssetTransactionRow {
  id: string;
  assetId: string;
  type: string;
  amount: number;
  date: string;
  notes: string | null;
  createdAt: string;
}

function now() {
  return new Date().toISOString();
}

function getOwnedAssetRow(db: LocalDb, userId: string, id: string): AssetRow {
  const row = db.get<AssetRow>(`SELECT * FROM "Asset" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("دارایی پیدا نشد.", 404);
  return row;
}

export function listAssets(db: LocalDb, userId: string): AssetRow[] {
  return db.all<AssetRow>(`SELECT * FROM "Asset" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`, [userId]);
}

export function getAsset(
  db: LocalDb,
  userId: string,
  id: string
): { asset: AssetRow; transactions: TransactionRow[]; assetTransactions: AssetTransactionRow[] } {
  const asset = getOwnedAssetRow(db, userId, id);
  const transactions = db.all<TransactionRow>(
    `SELECT * FROM "Transaction" WHERE "assetId" = ? AND "deletedAt" IS NULL ORDER BY "date" DESC`,
    [asset.id]
  );
  const assetTransactions = db.all<AssetTransactionRow>(`SELECT * FROM "AssetTransaction" WHERE "assetId" = ? ORDER BY "date" DESC`, [asset.id]);
  return { asset, transactions, assetTransactions };
}

export function createAsset(db: LocalDb, userId: string, input: CreateAssetInput): AssetRow {
  const id = crypto.randomUUID();
  const ts = now();
  const purchaseDate = input.purchaseDate ? new Date(input.purchaseDate).toISOString() : ts;
  const currentValue = input.currentValue ?? input.purchasePrice;

  db.run(
    `INSERT INTO "Asset" ("id","userId","name","category","purchasePrice","purchaseDate","currentValue","notes","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, input.name, input.category ?? null, input.purchasePrice, purchaseDate, currentValue, input.notes ?? null, ts, ts]
  );

  const fresh = db.get<AssetRow>(`SELECT * FROM "Asset" WHERE "id" = ?`, [id])!;
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Asset", entityId: id, newValue: fresh });
  return fresh;
}

export function updateAsset(db: LocalDb, userId: string, id: string, input: UpdateAssetInput): AssetRow {
  const existing = getOwnedAssetRow(db, userId, id);
  const ts = now();

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.name !== undefined) set("name", input.name);
  if (input.category !== undefined) set("category", input.category);
  if (input.currentValue !== undefined) set("currentValue", input.currentValue);
  if (input.notes !== undefined) set("notes", input.notes);
  set("updatedAt", ts);

  db.run(`UPDATE "Asset" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  if (input.currentValue !== undefined && input.currentValue !== existing.currentValue) {
    db.run(
      `INSERT INTO "AssetTransaction" ("id","assetId","type","amount","date","notes","createdAt")
       VALUES (?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), id, "VALUE_UPDATE", input.currentValue - existing.currentValue, ts, "به‌روزرسانی ارزش دارایی", ts]
    );
  }

  const fresh = db.get<AssetRow>(`SELECT * FROM "Asset" WHERE "id" = ?`, [id])!;
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Asset", entityId: id, oldValue: existing, newValue: fresh });
  return fresh;
}

export function deleteAsset(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedAssetRow(db, userId, id);
  db.run(`UPDATE "Asset" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [now(), now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Asset", entityId: id, oldValue: existing });
  return { ok: true };
}
