export interface GeneratedInstallment {
  index: number;
  dueDate: Date;
  amount: number;
}

/**
 * Generates N installment rows starting the month after startDate, due on dueDay each month.
 * dueDay is clamped to 28 at the call site to sidestep short-month edge cases (Feb).
 */
export function generateInstallmentSchedule(params: {
  startDate: Date;
  dueDay: number;
  numberOfInstallments: number;
  installmentAmount: number;
}): GeneratedInstallment[] {
  const { startDate, dueDay, numberOfInstallments, installmentAmount } = params;
  const clampedDay = Math.min(Math.max(dueDay, 1), 28);
  const schedule: GeneratedInstallment[] = [];

  for (let i = 0; i < numberOfInstallments; i++) {
    const dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, clampedDay);
    schedule.push({ index: i + 1, dueDate, amount: installmentAmount });
  }

  return schedule;
}

export interface LoanInterestBreakdown {
  totalPayable: number; // installmentAmount × numberOfInstallments — what you actually pay back in total
  interest: number; // totalPayable - totalAmount (principal) — the real cost of the loan
  interestPercent: number; // simple interest as a % of principal over the whole term (not an annualized APR)
}

/**
 * "سود واقعی" (real interest): the gap between what a loan pays out (totalAmount) and what
 * you pay back across all installments (installmentAmount × numberOfInstallments). This is
 * simple interest over the loan's full term, not an annualized rate — computing a true APR
 * needs an amortization schedule (varying principal/interest split per installment), which
 * the plan's flat installmentAmount doesn't give us enough information to derive.
 */
export function computeLoanInterest(params: {
  totalAmount: number;
  installmentAmount: number;
  numberOfInstallments: number;
}): LoanInterestBreakdown {
  const totalPayable = params.installmentAmount * params.numberOfInstallments;
  const interest = totalPayable - params.totalAmount;
  const interestPercent = params.totalAmount > 0 ? (interest / params.totalAmount) * 100 : 0;
  return { totalPayable, interest, interestPercent };
}

export interface InstallmentSummary {
  totalCount: number;
  paidCount: number;
  remainingCount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  nextDueDate: Date | null;
}

export function summarizeInstallments(
  installments: { amount: number; status: string; dueDate: Date }[]
): InstallmentSummary {
  const paid = installments.filter((i) => i.status === "PAID");
  const remaining = installments.filter((i) => i.status !== "PAID");
  const nextDue = remaining
    .slice()
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  return {
    totalCount: installments.length,
    paidCount: paid.length,
    remainingCount: remaining.length,
    totalAmount: installments.reduce((s, i) => s + i.amount, 0),
    paidAmount: paid.reduce((s, i) => s + i.amount, 0),
    remainingAmount: remaining.reduce((s, i) => s + i.amount, 0),
    nextDueDate: nextDue ? nextDue.dueDate : null,
  };
}
