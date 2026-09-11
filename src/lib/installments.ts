export interface GeneratedInstallment {
  index: number;
  dueDate: Date;
  amount: number;
}

// installment #index is due `index` months after startDate, on dueDay — clamped per-installment
// to THAT specific month's actual last day (not a single global cap), so day 31 reliably means
// "the last day of the month" in Feb or any 30-day month instead of silently landing early.
function computeDueDateForIndex(startDate: Date, dueDay: number, index: number): Date {
  const targetMonth = startDate.getMonth() + index;
  const daysInTargetMonth = new Date(startDate.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(startDate.getFullYear(), targetMonth, Math.min(dueDay, daysInTargetMonth));
}

/** Generates N installment rows starting the month after startDate, due on dueDay each month. */
export function generateInstallmentSchedule(params: {
  startDate: Date;
  dueDay: number;
  numberOfInstallments: number;
  installmentAmount: number;
}): GeneratedInstallment[] {
  const { startDate, dueDay, numberOfInstallments, installmentAmount } = params;
  const requestedDay = Math.min(Math.max(dueDay, 1), 31);
  const schedule: GeneratedInstallment[] = [];

  for (let i = 0; i < numberOfInstallments; i++) {
    schedule.push({ index: i + 1, dueDate: computeDueDateForIndex(startDate, requestedDay, i + 1), amount: installmentAmount });
  }

  return schedule;
}

/**
 * Recomputes a single not-yet-paid installment's due date after its plan's dueDay is edited —
 * same per-month clamping as generateInstallmentSchedule, applied to one existing index instead
 * of a fresh N-row schedule, so already-PAID installments' historical dates are never touched.
 */
export function recomputeInstallmentDueDate(startDate: Date, dueDay: number, index: number): Date {
  const requestedDay = Math.min(Math.max(dueDay, 1), 31);
  return computeDueDateForIndex(startDate, requestedDay, index);
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

export interface AnnualRateBreakdown {
  monthlyRate: number; // periodic (monthly) interest rate implied by the schedule, as a fraction
  effectiveAnnualRate: number; // (1+monthlyRate)^12 - 1 — the true compounded annual cost, as a fraction
  effectiveAnnualRatePercent: number; // same, as a percentage (e.g. 19.6)
}

/**
 * Solves for the periodic (monthly) interest rate implied by a fixed-installment loan, then
 * compounds it into a true effective annual rate — the "سود واقعی سالانه" a bank would quote as
 * APR, not the flat (total interest ÷ principal) figure computeLoanInterest returns. There's no
 * closed-form solution for the rate in an ordinary-annuity equation (totalAmount = installmentAmount
 * · (1-(1+i)^-n)/i), so this solves it numerically via bisection: the right-hand side is strictly
 * decreasing in i (a higher rate makes each future fixed payment worth less today), so bisection
 * converges reliably without needing a good initial guess the way Newton's method would.
 */
export function computeEffectiveAnnualRate(params: {
  totalAmount: number;
  installmentAmount: number;
  numberOfInstallments: number;
}): AnnualRateBreakdown {
  const { totalAmount: principal, installmentAmount, numberOfInstallments } = params;
  const zero = { monthlyRate: 0, effectiveAnnualRate: 0, effectiveAnnualRatePercent: 0 };
  if (principal <= 0 || installmentAmount <= 0 || numberOfInstallments <= 0) return zero;
  if (installmentAmount * numberOfInstallments <= principal) return zero; // no real interest to annualize

  const presentValue = (rate: number) => (installmentAmount * (1 - Math.pow(1 + rate, -numberOfInstallments))) / rate;

  let low = 0;
  let high = 1; // 100%/month — far beyond any realistic installment plan, widened below if still not enough
  for (let i = 0; i < 100 && presentValue(high) > principal; i++) high *= 2;

  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > principal) low = mid;
    else high = mid;
  }

  const monthlyRate = (low + high) / 2;
  const effectiveAnnualRate = Math.pow(1 + monthlyRate, 12) - 1;
  return { monthlyRate, effectiveAnnualRate, effectiveAnnualRatePercent: effectiveAnnualRate * 100 };
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
