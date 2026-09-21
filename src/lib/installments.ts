import jalaali from "jalaali-js";
import { addJalaliMonths, parseDayKey } from "./calendarGrid";
import { fromJalali, toJalali } from "./jalali";

export interface GeneratedInstallment {
  index: number;
  dueDate: Date;
  amount: number;
}

// Due dates live on the Jalali calendar — that is the calendar the person picks days on and reads
// them back on — so "the 2nd" means the 2nd of every Jalali month, and a plan started on Mehr 2
// falls due again on Aban 2 and Azar 2, not on the 2nd of the next Gregorian months (which read
// back as unrelated Jalali days). A day the month doesn't have (the 31st in Mehr–Bahman, the 30th
// in Esfand) clamps to THAT month's last day, so 31 reliably means "the last day of the month".
function clampDay(dueDay: number): number {
  return Math.min(Math.max(Math.trunc(dueDay), 1), 31);
}

/**
 * The Jalali day a stored due date was made for. Due dates are the local midnight of their day, so the
 * instant depends on the time zone of whoever created it — a phone in Tehran stores 20:30 UTC on the
 * evening BEFORE, a server in UTC stores 00:00 UTC — and reading them back with local getters on the
 * other machine lands one day early. Shifting by 12 hours and reading the UTC fields gives the intended
 * day for any zone from UTC−12 to UTC+12, so a plan made on the phone re-dates the same way on the server.
 */
export function dueDateDay(date: Date): { jy: number; jm: number; jd: number } {
  const shifted = new Date(date.getTime() + 12 * 3_600_000);
  const { jy, jm, jd } = jalaali.toJalaali(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  return { jy, jm, jd };
}

function jalaliDueDate(jy: number, jm: number, dueDay: number): Date {
  return fromJalali(jy, jm, Math.min(dueDay, jalaali.jalaaliMonthLength(jy, jm)));
}

export interface InstallmentTiming {
  firstMonth: { jy: number; jm: number }; // the Jalali month installment #1 falls in
  dueDay: number; // the Jalali day-of-month every installment falls on (before per-month clamping)
}

/**
 * Where a schedule starts. With `firstDueDate` (the date the person picked for the first
 * installment) installment #1 is due in that date's Jalali month and every installment on its
 * Jalali day; without it the plan starts the month after `startDate` on `dueDay`, the original
 * behaviour, so callers that only know a day of the month still work.
 */
export function resolveInstallmentTiming(params: { startDate: Date; dueDay?: number; firstDueDate?: Date | null }): InstallmentTiming {
  if (params.firstDueDate) {
    const { jy, jm, jd } = dueDateDay(params.firstDueDate);
    return { firstMonth: { jy, jm }, dueDay: jd };
  }
  const { jy, jm } = toJalali(params.startDate);
  return { firstMonth: addJalaliMonths(jy, jm, 1), dueDay: clampDay(params.dueDay ?? toJalali(params.startDate).jd) };
}

/** Generates N monthly installment rows on the Jalali calendar (see resolveInstallmentTiming). */
export function generateInstallmentSchedule(params: {
  startDate: Date;
  dueDay?: number;
  numberOfInstallments: number;
  installmentAmount: number;
  firstDueDate?: Date | null;
}): GeneratedInstallment[] {
  const { firstMonth, dueDay } = resolveInstallmentTiming(params);
  const schedule: GeneratedInstallment[] = [];

  for (let i = 0; i < params.numberOfInstallments; i++) {
    const month = addJalaliMonths(firstMonth.jy, firstMonth.jm, i);
    schedule.push({ index: i + 1, dueDate: jalaliDueDate(month.jy, month.jm, dueDay), amount: params.installmentAmount });
  }

  return schedule;
}

/**
 * Recomputes a single not-yet-paid installment's due date after its plan's day (or first date) is
 * edited. `firstDueDate` is installment #1's CURRENT due date — its Jalali month anchors the whole
 * schedule, which keeps plans that were created on the old Gregorian rule working: they simply
 * continue from the month their first installment is shown in. Already-PAID installments are never
 * passed here, so their historical dates stay as they were.
 */
export function recomputeInstallmentDueDate(firstDueDate: Date, dueDay: number, index: number): Date {
  const { jy, jm } = dueDateDay(firstDueDate);
  const month = addJalaliMonths(jy, jm, index - 1);
  return jalaliDueDate(month.jy, month.jm, clampDay(dueDay));
}

export interface PlannedInstallments {
  startDate: Date;
  dueDay: number; // what the plan stores — the Jalali day-of-month
  schedule: GeneratedInstallment[];
}

/** Everything a create request (web route or phone repository) needs, computed one way for both. */
export function planInstallments(input: {
  startDate?: string;
  dueDay?: number;
  firstDueDate?: string;
  numberOfInstallments: number;
  installmentAmount: number;
}): PlannedInstallments {
  const firstDueDate = input.firstDueDate ? parseDayKey(input.firstDueDate) : null;
  // A plan "starts" on its first installment when the person picked that date; otherwise on the
  // moment it was created (its first installment then falls in the next Jalali month).
  const startDate = firstDueDate ?? (input.startDate ? new Date(input.startDate) : new Date());
  const timing = resolveInstallmentTiming({ startDate, dueDay: input.dueDay, firstDueDate });
  return {
    startDate,
    dueDay: timing.dueDay,
    schedule: generateInstallmentSchedule({
      startDate,
      dueDay: input.dueDay,
      firstDueDate,
      numberOfInstallments: input.numberOfInstallments,
      installmentAmount: input.installmentAmount,
    }),
  };
}

export interface InstallmentRedating {
  dueDay: number; // the plan's day-of-month after the edit
  changes: { id: string; index: number; dueDate: Date }[]; // only the installments whose date actually moves
}

/**
 * The effect of editing a plan's schedule: a new day-of-month re-dates the installments that are
 * not paid yet (PAID ones keep the date they really fell due on, so past reports stay accurate),
 * anchored on installment #1's current Jalali month. A new first date moves the whole schedule and
 * is only allowed while nothing has been paid — `hasPaid` callers must reject that case first.
 * Returns null when the edit touches neither.
 */
export function redateInstallments(params: {
  installments: { id: string; index: number; status: string; dueDate: Date }[];
  dueDay?: number;
  firstDueDate?: string;
}): InstallmentRedating | null {
  const ordered = params.installments.slice().sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return null;

  const firstDueDate = params.firstDueDate ? parseDayKey(params.firstDueDate) : null;
  if (!firstDueDate && params.dueDay === undefined) return null;

  const anchor = firstDueDate ?? ordered[0].dueDate;
  const dueDay = firstDueDate ? dueDateDay(firstDueDate).jd : clampDay(params.dueDay as number);
  const changes: InstallmentRedating["changes"] = [];
  for (const installment of ordered) {
    if (installment.status === "PAID") continue;
    const dueDate = recomputeInstallmentDueDate(anchor, dueDay, installment.index);
    // Compared by the day they stand for, not the instant: the same day made in another time zone is not a change.
    const before = dueDateDay(installment.dueDate);
    const after = dueDateDay(dueDate);
    if (before.jy !== after.jy || before.jm !== after.jm || before.jd !== after.jd) changes.push({ id: installment.id, index: installment.index, dueDate });
  }
  return { dueDay, changes };
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

export interface CompoundAnnualRate {
  annualRate: number; // as a fraction
  annualRatePercent: number; // same, as a percentage (e.g. 20)
}

/**
 * "سود مرکب سالانه": the whole-term interest (the percentage computeLoanInterest returns) restated
 * per year with compounding — (1 + termRate)^(12 / months) − 1, one installment per month. Over a
 * term of exactly 12 months it IS the term rate (a year is a year; simple and compound interest
 * agree after one period), a shorter plan scales it up and a longer one scales it down. It treats
 * the principal as owed for the whole term; because installments pay the principal back gradually
 * the real cost of the money is higher, and that is what computeEffectiveAnnualRate measures.
 */
export function computeCompoundAnnualRate(params: {
  totalAmount: number;
  installmentAmount: number;
  numberOfInstallments: number;
}): CompoundAnnualRate {
  const { totalAmount, installmentAmount, numberOfInstallments } = params;
  if (totalAmount <= 0 || installmentAmount <= 0 || numberOfInstallments <= 0) return { annualRate: 0, annualRatePercent: 0 };
  const termRate = (installmentAmount * numberOfInstallments) / totalAmount - 1;
  if (termRate <= 0) return { annualRate: 0, annualRatePercent: 0 }; // no interest to annualize
  const annualRate = Math.pow(1 + termRate, 12 / numberOfInstallments) - 1;
  return { annualRate, annualRatePercent: annualRate * 100 };
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
