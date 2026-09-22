// Which installment plan extra money should go toward first, when several are open at once.
// Avalanche ranks by real cost (effectiveAnnualRatePercent, already computed per plan — see
// computeEffectiveAnnualRate in installments.ts): pay down the most expensive money first.
// Snowball ranks by remainingAmount ascending: the classic "quick win" ordering.
//
// This app's installments are fixed nominal amounts (no amortization schedule splitting
// principal/interest per installment, no early-settlement discount), so paying a plan off ahead
// of schedule doesn't change ITS OWN total interest — that was fixed when the plan was created.
// What genuinely changes with ordering is *when* each plan finishes, which is why this only ever
// claims "زودتر تمام می‌شود" (finishes sooner), never a fabricated "سود کمتر" (less interest)
// figure a fixed-installment loan can't actually deliver.
export type PayoffStrategy = "AVALANCHE" | "SNOWBALL";

export interface DebtForPayoff {
  id: string;
  title: string;
  remainingAmount: number;
  remainingCount: number;
  installmentAmount: number;
  effectiveAnnualRatePercent: number;
}

export interface DebtPayoffRankItem extends DebtForPayoff {
  order: number; // 1-based priority for extra payments
}

export function rankDebtsForPayoff(debts: DebtForPayoff[], strategy: PayoffStrategy): DebtPayoffRankItem[] {
  const sorted = [...debts].sort((a, b) =>
    strategy === "AVALANCHE" ? b.effectiveAnnualRatePercent - a.effectiveAnnualRatePercent : a.remainingAmount - b.remainingAmount
  );
  return sorted.map((debt, i) => ({ ...debt, order: i + 1 }));
}

/**
 * With `extraPerMonth` added on top of a plan's own fixed installment each month, how many fewer
 * months it takes to clear the remaining balance — a straight pull-forward (more money in means
 * the same remaining total is retired in fewer months), not an interest calculation. Returns 0
 * when there's no extra to apply or nothing left to accelerate.
 */
export function monthsSoonerWithExtra(remainingCount: number, installmentAmount: number, extraPerMonth: number): number {
  if (extraPerMonth <= 0 || remainingCount <= 0 || installmentAmount <= 0) return 0;
  const acceleratedMonths = Math.ceil((remainingCount * installmentAmount) / (installmentAmount + extraPerMonth));
  return Math.max(0, remainingCount - acceleratedMonths);
}
