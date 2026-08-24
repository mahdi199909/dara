import { prisma } from "./db";

/** Returns the user's first active account, creating a default cash account if none exists yet. */
export async function resolveDefaultAccountId(userId: string): Promise<string> {
  const existing = await prisma.financeAccount.findFirst({
    where: { userId, deletedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.id;

  const created = await prisma.financeAccount.create({
    data: { userId, name: "صندوق", type: "CASH", initialBalance: 0 },
  });
  return created.id;
}
