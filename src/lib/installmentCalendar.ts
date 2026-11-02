// Installments as the calendar sees them: every installment of every plan, put on the Jalali day it falls due, plus the
// month's totals. Pure — the callers fetch /api/installment-plans (as the installments tab and Home already do) and this
// only places and adds up, so the calendar, a day's list and the installments dashboard can never disagree about a month.
import { dueDateDay } from "@/lib/installments";
import { dayKeyIso } from "@/lib/calendarGrid";
import { fromJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";

export interface InstallmentLike {
  id: string;
  index: number;
  dueDate: string | Date;
  amount: number;
  status: string;
}

export interface InstallmentPlanLike {
  id: string;
  title: string;
  numberOfInstallments: number;
  installments: readonly InstallmentLike[];
}

export interface InstallmentOccurrence {
  id: string;
  planId: string;
  planTitle: string;
  /** 1-based number of this installment in its plan, and how many the plan has. */
  index: number;
  count: number;
  /** The day it falls due: that day's local midnight on this device (see dueDateDay for why a plain getter is not enough). */
  day: Date;
  /** The same day as "YYYY-MM-DD", the key the calendar matches its cells on. */
  dayKey: string;
  jy: number;
  jm: number;
  jd: number;
  amount: number;
  status: string;
  paid: boolean;
}

/** Every installment of every plan, oldest due day first (ties: plan title, then number). */
export function installmentOccurrences(plans: readonly InstallmentPlanLike[]): InstallmentOccurrence[] {
  const all: InstallmentOccurrence[] = [];
  for (const plan of plans) {
    for (const installment of plan.installments) {
      const { jy, jm, jd } = dueDateDay(new Date(installment.dueDate));
      const day = fromJalali(jy, jm, jd);
      all.push({
        id: installment.id,
        planId: plan.id,
        planTitle: plan.title,
        index: installment.index,
        count: plan.numberOfInstallments,
        day,
        dayKey: dayKeyIso(day),
        jy,
        jm,
        jd,
        amount: installment.amount,
        status: installment.status,
        paid: installment.status === "PAID",
      });
    }
  }
  return all.sort((a, b) => compareText(a.dayKey, b.dayKey) || compareText(a.planTitle, b.planTitle) || a.index - b.index);
}

/** Plain code-unit order: the same on every machine (localeCompare follows the device's language settings). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The installments due on one calendar day. */
export function installmentsOnDay(all: readonly InstallmentOccurrence[], day: Date): InstallmentOccurrence[] {
  const key = dayKeyIso(day);
  return all.filter((occurrence) => occurrence.dayKey === key);
}

/** The installments due from one day to another, both included (the times of day of the two Dates do not matter). */
export function installmentsInRange(all: readonly InstallmentOccurrence[], from: Date, to: Date): InstallmentOccurrence[] {
  const first = dayKeyIso(from);
  const last = dayKeyIso(to);
  return all.filter((occurrence) => occurrence.dayKey >= first && occurrence.dayKey <= last);
}

/** "نام طرح — قسط ۳ از ۱۲". */
export function installmentTitle(occurrence: Pick<InstallmentOccurrence, "planTitle" | "index" | "count">): string {
  return `${occurrence.planTitle} — قسط ${toPersianDigits(occurrence.index)} از ${toPersianDigits(occurrence.count)}`;
}

/** An unpaid installment whose day has passed. `today` is any moment of the current day. */
export function isOverdue(occurrence: Pick<InstallmentOccurrence, "paid" | "dayKey">, today: Date = new Date()): boolean {
  return !occurrence.paid && occurrence.dayKey < dayKeyIso(today);
}

export interface MonthInstallments {
  jy: number;
  jm: number;
  /** This Jalali month's installments across every plan, in due order. */
  items: InstallmentOccurrence[];
  count: number;
  paidCount: number;
  /** In Toman: everything due this month, what is already paid, and what is left. */
  total: number;
  paid: number;
  remaining: number;
}

export function monthInstallments(all: readonly InstallmentOccurrence[], jy: number, jm: number): MonthInstallments {
  const items = all.filter((occurrence) => occurrence.jy === jy && occurrence.jm === jm);
  const paidItems = items.filter((occurrence) => occurrence.paid);
  const total = items.reduce((sum, occurrence) => sum + occurrence.amount, 0);
  const paid = paidItems.reduce((sum, occurrence) => sum + occurrence.amount, 0);
  return { jy, jm, items, count: items.length, paidCount: paidItems.length, total, paid, remaining: total - paid };
}
