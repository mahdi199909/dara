// How close a category's real spending this calendar month is to its Budget.monthlyCap — pure
// arithmetic over already-fetched transactions, so the Budgets tab can render a progress bar
// without a dedicated endpoint. Only EXPENSE transactions count (a budget is a spending cap, not
// a transfer or income tracker); TRANSFER/INCOME rows in the same category are ignored.
export interface BudgetForProgress {
  categoryId: string;
  monthlyCap: number;
}

export interface TransactionForBudgetProgress {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  categoryId: string | null;
  amount: number;
  date: Date;
}

export interface BudgetProgress {
  categoryId: string;
  monthlyCap: number;
  spent: number;
  /** Uncapped — can exceed 100 once spending passes the cap; callers clamp for a bar's width. */
  pct: number;
  /** The soft-warning threshold — signal/signal-soft tokens, never waste/red (see the anti-shame
   * colour rule: reaching a budget is information, not a penalty). */
  isNear: boolean;
}

const NEAR_THRESHOLD_PCT = 80;

export function computeBudgetProgress(
  budgets: BudgetForProgress[],
  transactions: TransactionForBudgetProgress[],
  now: Date = new Date()
): BudgetProgress[] {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const spentByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "EXPENSE" || !t.categoryId) continue;
    if (t.date < monthStart || t.date >= nextMonthStart) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + t.amount);
  }

  return budgets.map((b) => {
    const spent = spentByCategory.get(b.categoryId) ?? 0;
    const pct = b.monthlyCap > 0 ? (spent / b.monthlyCap) * 100 : 0;
    return { categoryId: b.categoryId, monthlyCap: b.monthlyCap, spent, pct, isNear: pct >= NEAR_THRESHOLD_PCT };
  });
}
