import { NextRequest, NextResponse } from "next/server";
import { createAccountSchema } from "@/lib/schemas/accounts";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

async function withBalance(account: { id: string; initialBalance: number }) {
  const [incomeSum, expenseSum, transferOutSum, transferInSum] = await Promise.all([
    prisma.transaction.aggregate({
      where: { accountId: account.id, type: "INCOME", deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId: account.id, type: "EXPENSE", deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { accountId: account.id, type: "TRANSFER", deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { transferToAccountId: account.id, type: "TRANSFER", deletedAt: null },
      _sum: { amount: true },
    }),
  ]);

  const balance =
    account.initialBalance +
    (incomeSum._sum.amount ?? 0) -
    (expenseSum._sum.amount ?? 0) -
    (transferOutSum._sum.amount ?? 0) +
    (transferInSum._sum.amount ?? 0);

  return { ...account, balance };
}

async function GET() {
  try {
    const userId = await requireUserId();
    const accounts = await prisma.financeAccount.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    const withBalances = await Promise.all(accounts.map(withBalance));
    return NextResponse.json({ accounts: withBalances });
  } catch (err) {
    return handleApiError(err);
  }
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = createAccountSchema.parse(await req.json());
    const account = await prisma.financeAccount.create({ data: { ...body, userId } });

    const { ipAddress, userAgent } = requestMeta(req);
    await writeAuditLog({
      userId,
      action: "CREATE",
      entityType: "FinanceAccount",
      entityId: account.id,
      newValue: account,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ account: await withBalance(account) }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedGET = withApiLogging("GET", "/api/accounts", GET);
const loggedPOST = withApiLogging("POST", "/api/accounts", POST);
export { loggedGET as GET, loggedPOST as POST };
