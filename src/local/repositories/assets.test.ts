import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createAsset, deleteAsset, getAsset, listAssets, updateAsset } from "./assets";

const USER_ID = "user_asset_1";
const now = () => new Date().toISOString();

function freshDb(): LocalDb {
  resetLocalDbForTests();
  const db = openLocalDb(createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "a@example.com", "hash", "Asset", now(), now()]);
  return db;
}

describe("local assets", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates an asset defaulting currentValue to purchasePrice when omitted", () => {
    const db = freshDb();
    const asset = createAsset(db, USER_ID, { name: "لپ‌تاپ", purchasePrice: 50000000 });
    expect(asset.currentValue).toBe(50000000);

    expect(listAssets(db, USER_ID)).toHaveLength(1);
  });

  it("updating currentValue creates an AssetTransaction recording the delta", () => {
    const db = freshDb();
    const asset = createAsset(db, USER_ID, { name: "لپ‌تاپ", purchasePrice: 50000000, currentValue: 50000000 });
    updateAsset(db, USER_ID, asset.id, { currentValue: 40000000 });

    const assetTxs = db.all<any>(`SELECT * FROM "AssetTransaction" WHERE "assetId" = ?`, [asset.id]);
    expect(assetTxs).toHaveLength(1);
    expect(assetTxs[0].type).toBe("VALUE_UPDATE");
    expect(assetTxs[0].amount).toBe(-10000000);
  });

  it("does not create an AssetTransaction when currentValue is unchanged", () => {
    const db = freshDb();
    const asset = createAsset(db, USER_ID, { name: "لپ‌تاپ", purchasePrice: 50000000, currentValue: 50000000 });
    updateAsset(db, USER_ID, asset.id, { name: "لپ‌تاپ جدید" });
    expect(db.all(`SELECT * FROM "AssetTransaction" WHERE "assetId" = ?`, [asset.id])).toHaveLength(0);
  });

  it("getAsset includes linked Transaction and AssetTransaction rows", () => {
    const db = freshDb();
    const asset = createAsset(db, USER_ID, { name: "ماشین", purchasePrice: 300000000 });
    db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_1", USER_ID, "نقد", now(), now()]);
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","assetId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["tx_1", USER_ID, "EXPENSE", 5000000, now(), "acc_1", asset.id, now(), now()]
    );

    const detail = getAsset(db, USER_ID, asset.id);
    expect(detail.transactions).toHaveLength(1);
    expect(detail.transactions[0].id).toBe("tx_1");
  });

  it("soft-deletes an asset", () => {
    const db = freshDb();
    const asset = createAsset(db, USER_ID, { name: "دارایی", purchasePrice: 1000 });
    deleteAsset(db, USER_ID, asset.id);
    expect(listAssets(db, USER_ID)).toHaveLength(0);
  });
});
