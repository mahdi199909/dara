// Which account a new expense or income is booked to when the person names none. One rule, used by the
// capture form's picker, the «ثبت ...» line (src/lib/captureResolve.ts) and — in SQL and Prisma form — by
// resolveDefaultAccountId on the server (src/lib/accounts.ts) and on the phone (src/local/accounts.ts):
// the active account marked as the default, otherwise the oldest active account.

export interface AccountChoice {
  id: string;
  isActive: boolean;
  isDefault?: boolean;
  createdAt: string | Date;
}

export function pickDefaultAccount<T extends AccountChoice>(accounts: readonly T[]): T | null {
  const active = accounts.filter((a) => a.isActive);
  active.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return active.find((a) => a.isDefault) ?? active[0] ?? null;
}
