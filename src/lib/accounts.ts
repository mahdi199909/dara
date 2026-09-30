import { prisma } from "./db";

/**
 * The account a new expense or income is booked to when none is named: the active account the person marked
 * as their default, otherwise their oldest active account — and a cash account «صندوق», created on the spot,
 * when they have none at all. (Same rule as pickDefaultAccount in ./defaultAccount.ts and the phone's
 * src/local/accounts.ts.)
 */
export async function resolveDefaultAccountId(userId: string): Promise<string> {
  const existing = await prisma.financeAccount.findFirst({
    where: { userId, deletedAt: null, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (existing) return existing.id;

  const created = await prisma.financeAccount.create({
    data: { userId, name: "صندوق", type: "CASH", initialBalance: 0 },
  });
  return created.id;
}

/** The account the person picked for this entry when it is really theirs; the default one otherwise. */
export async function resolveAccountId(userId: string, preferredAccountId?: string | null): Promise<string> {
  if (preferredAccountId) {
    const owned = await prisma.financeAccount.findFirst({ where: { id: preferredAccountId, userId, deletedAt: null }, select: { id: true } });
    if (owned) return owned.id;
  }
  return resolveDefaultAccountId(userId);
}
