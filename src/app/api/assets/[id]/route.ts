import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tomanInt } from "@/lib/schemas/money";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError, ApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  category: z.string().max(50).nullable().optional(),
  currentValue: tomanInt().min(0).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

async function getOwned(userId: string, id: string) {
  const asset = await prisma.asset.findFirst({ where: { id, userId, deletedAt: null } });
  if (!asset) throw new ApiError("دارایی پیدا نشد.", 404);
  return asset;
}

async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const asset = await getOwned(userId, params.id);
    const [transactions, assetTransactions] = await Promise.all([
      prisma.transaction.findMany({ where: { assetId: asset.id, deletedAt: null }, orderBy: { date: "desc" } }),
      prisma.assetTransaction.findMany({ where: { assetId: asset.id }, orderBy: { date: "desc" } }),
    ]);
    return NextResponse.json({ asset, transactions, assetTransactions });
  } catch (err) {
    return handleApiError(err);
  }
}

async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);
    const body = updateSchema.parse(await req.json());

    // The new value and its entry in the value history commit together.
    const asset = await withTransaction(
      async () => {
        const asset = await prisma.asset.update({ where: { id: params.id }, data: body });

        if (body.currentValue !== undefined && body.currentValue !== existing.currentValue) {
          await prisma.assetTransaction.create({
            data: {
              assetId: asset.id,
              type: "VALUE_UPDATE",
              amount: body.currentValue - existing.currentValue,
              date: new Date(),
              notes: "به‌روزرسانی ارزش دارایی",
            },
          });
        }
        return asset;
      },
      { operation: "ASSET_UPDATE", entityType: "Asset", entityId: params.id }
    );

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "UPDATE",
      entityType: "Asset",
      entityId: asset.id,
      oldValue: existing,
      newValue: asset,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ asset });
  } catch (err) {
    return handleApiError(err);
  }
}

async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const existing = await getOwned(userId, params.id);

    await prisma.asset.update({ where: { id: params.id }, data: { deletedAt: new Date() } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "DELETE",
      entityType: "Asset",
      entityId: params.id,
      oldValue: existing,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/assets/[id]", GET);
const loggedPATCH = withApiLogging("PATCH", "/api/assets/[id]", PATCH);
const loggedDELETE = withApiLogging("DELETE", "/api/assets/[id]", DELETE);
export { loggedGET as GET, loggedPATCH as PATCH, loggedDELETE as DELETE };
