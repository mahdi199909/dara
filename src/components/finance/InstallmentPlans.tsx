"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { Card, StatItem } from "@/components/ui/Card";
import { formatJalali, toJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { dayKeyIso } from "@/lib/calendarGrid";
import { EditIcon, TrashIcon } from "@/components/icons";
import { REMINDER_OFFSET_PRESETS } from "@/lib/types";
import {
  computeLoanInterest,
  computeCompoundAnnualRate,
  computeEffectiveAnnualRate,
  generateInstallmentSchedule,
  redateInstallments,
} from "@/lib/installments";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import MoneyInput from "@/components/ui/MoneyInput";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { notifySaved } from "@/lib/savedToast";

const INSTALLMENT_STATUS_LABELS: Record<string, string> = { PENDING: "در انتظار", PAID: "پرداخت‌شده", OVERDUE: "دیرکرد" };

function formatPercent(value: number): string {
  return `${toPersianDigits(value.toFixed(1)).replace(".", "٫")}٪`;
}

/**
 * What a loan's interest comes to, stated three ways that answer three different questions:
 *  - سود کل دوره — how much extra you pay back over the whole plan;
 *  - سود مرکب سالانه — that same whole-plan interest restated per year with compounding, so over
 *    exactly 12 months it equals the whole-plan figure;
 *  - نرخ مؤثر — what the borrowed money really costs per year, which is higher because every
 *    installment pays part of the principal back and less and less is owed as the months pass.
 */
function InterestSummary({ totalAmount, installmentAmount, numberOfInstallments }: { totalAmount: number; installmentAmount: number; numberOfInstallments: number }) {
  const { format } = useCurrencyUnit();
  const args = { totalAmount, installmentAmount, numberOfInstallments };
  const interest = computeLoanInterest(args);
  const compound = computeCompoundAnnualRate(args);
  const effective = computeEffectiveAnnualRate(args);
  const hasInterest = interest.interest > 0;

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">مجموع بازپرداخت</span>
        <span className="text-ink font-medium shrink-0">{format(interest.totalPayable, { withSuffix: true })}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">سود کل دوره</span>
        <span className={`font-bold shrink-0 ${hasInterest ? "text-waste" : "text-accent"}`}>
          {hasInterest ? `${format(interest.interest, { withSuffix: true })} (${formatPercent(interest.interestPercent)})` : "بدون سود"}
        </span>
      </div>
      {hasInterest && compound.annualRate > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-line pt-1">
          <span className="text-muted">سود مرکب سالانه</span>
          <span className="text-waste font-bold shrink-0">{formatPercent(compound.annualRatePercent)}</span>
        </div>
      )}
      {hasInterest && effective.effectiveAnnualRate > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-muted">نرخ مؤثر (با کم‌شدن تدریجی بدهی با هر قسط)</span>
          <span className="text-muted shrink-0">{formatPercent(effective.effectiveAnnualRatePercent)}</span>
        </div>
      )}
    </div>
  );
}

/** "هر ماه شمسی روز X" plus the first and last due dates the schedule would produce — so the dates
 * a plan will get are visible, in Jalali, before anything is saved. */
function SchedulePreview({ firstDueDate, count }: { firstDueDate: Date; count: number }) {
  const schedule = useMemo(
    () =>
      count >= 1
        ? generateInstallmentSchedule({ startDate: firstDueDate, firstDueDate, numberOfInstallments: Math.min(count, 360), installmentAmount: 0 })
        : [],
    [firstDueDate, count]
  );
  const { jd } = toJalali(firstDueDate);
  return (
    <p className="text-xs text-muted">
      هر ماه شمسی، روز {toPersianDigits(jd)} سررسید می‌شود
      {schedule.length > 0 && (
        <>
          {" "}
          · اولین قسط {formatJalali(schedule[0].dueDate, { long: true })}
          {schedule.length > 1 && <> · آخرین قسط {formatJalali(schedule[schedule.length - 1].dueDate, { long: true })}</>}
        </>
      )}
    </p>
  );
}

export function InstallmentPlanCard({ plan, accounts, onChanged, highlighted }: { plan: any; accounts: any[]; onChanged: () => void; highlighted?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [payAccountId, setPayAccountId] = useState(accounts[0]?.id ?? "");
  const [payingId, setPayingId] = useState<string | null>(null);
  const { format } = useCurrencyUnit();
  const cardRef = useRef<HTMLDivElement>(null);

  // Arriving from a search result: bring this plan into view.
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);

  const hasInterest = computeLoanInterest({
    totalAmount: plan.totalAmount,
    installmentAmount: plan.installmentAmount,
    numberOfInstallments: plan.numberOfInstallments,
  }).interest > 0;

  async function pay(installmentId: string) {
    if (!payAccountId) return;
    setPayingId(installmentId);
    try {
      await apiPost(`/api/installments/${installmentId}/pay`, { accountId: payAccountId });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "پرداخت ناموفق بود.");
    } finally {
      setPayingId(null);
    }
  }

  async function remove() {
    if (!confirm("این طرح قسط حذف شود؟")) return;

    // A plan with real payment history gets one more, explicit choice: cascade-delete the
    // EXPENSE transactions those payments created too, or leave them exactly as they are (the
    // plan itself is removed from اقساط either way — this used to hard-block deletion entirely
    // whenever any installment was paid, which was more restrictive than what's actually needed).
    let deleteTransactions = false;
    if (plan.summary.paidCount > 0) {
      deleteTransactions = confirm(
        "این طرح پرداخت‌های ثبت‌شده دارد. تراکنش‌های مرتبط با آن‌ها هم حذف شوند؟\n(در غیر این صورت فقط طرح از این بخش حذف می‌شود و تراکنش‌ها در گزارش‌ها باقی می‌مانند.)"
      );
    }

    try {
      await apiDelete(`/api/installment-plans/${plan.id}?deleteTransactions=${deleteTransactions}`);
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "حذف طرح ناموفق بود.");
    }
  }

  if (editing) {
    return <EditInstallmentPlanForm plan={plan} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div ref={cardRef} className={highlighted ? "rounded-2xl ring-2 ring-accent" : undefined}>
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <h3 className="font-bold text-ink truncate">{plan.title}</h3>
          <p className="text-[11px] text-muted mt-0.5">سررسید هر ماه: روز {toPersianDigits(plan.dueDay)} (شمسی)</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => setEditing(true)} aria-label="ویرایش" className="p-1.5 rounded-lg text-muted hover:bg-canvas">
            <EditIcon className="w-4 h-4" />
          </button>
          <button onClick={remove} aria-label="حذف" className="p-1.5 rounded-lg text-waste hover:bg-canvas">
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatItem label="کل بدهی" value={format(plan.summary.totalAmount, { withSuffix: true })} />
        <StatItem label="پرداخت‌شده" value={format(plan.summary.paidAmount, { withSuffix: true })} tone="positive" />
        <StatItem label="باقی‌مانده" value={format(plan.summary.remainingAmount, { withSuffix: true })} tone="negative" />
        <StatItem
          label="سررسید بعدی"
          value={plan.summary.nextDueDate ? formatJalali(new Date(plan.summary.nextDueDate)) : "—"}
        />
      </div>
      {hasInterest && (
        <div className="mt-3 rounded-xl bg-waste-50 px-3 py-2">
          <p className="text-[11px] text-muted mb-1">مبلغ اصل: {format(plan.totalAmount, { withSuffix: true })}</p>
          <InterestSummary
            totalAmount={plan.totalAmount}
            installmentAmount={plan.installmentAmount}
            numberOfInstallments={plan.numberOfInstallments}
          />
        </div>
      )}
      <p className="text-xs text-muted mt-3 mb-1.5">
        {toPersianDigits(plan.summary.paidCount)} از {toPersianDigits(plan.summary.totalCount)} قسط پرداخت‌شده
      </p>

      {plan.summary.remainingCount > 0 && (
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-muted">پرداخت از حساب</p>
          <select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)} className="text-xs bg-surface rounded-lg border border-line px-2 py-1">
            {accounts.length === 0 && <option value="">حسابی ثبت نشده</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      <ul className="rounded-xl border border-line divide-y divide-line overflow-y-auto scrollbar-thin max-h-[7.5rem]">
        {plan.installments.map((inst: any) => (
          <li key={inst.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="text-muted shrink-0">قسط {toPersianDigits(inst.index)}</span>
            <span className="text-ink flex-1 truncate">{formatJalali(new Date(inst.dueDate))}</span>
            <span className="font-medium shrink-0">{format(inst.amount, { withSuffix: true })}</span>
            {inst.status === "PAID" ? (
              <span className="text-accent shrink-0">{INSTALLMENT_STATUS_LABELS.PAID}</span>
            ) : (
              <button
                onClick={() => pay(inst.id)}
                disabled={!payAccountId || payingId === inst.id}
                className={`shrink-0 px-2.5 py-1 rounded-lg font-medium disabled:opacity-40 ${
                  inst.status === "OVERDUE" ? "bg-waste-soft text-waste" : "bg-accent-soft text-accent"
                }`}
              >
                {payingId === inst.id ? "..." : "پرداخت"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
    </div>
  );
}

function EditInstallmentPlanForm({ plan, onDone, onCancel }: { plan: any; onDone: () => void; onCancel: () => void }) {
  const installments: any[] = plan.installments ?? [];
  // Moving the first date shifts every installment, which would rewrite the dates real payments
  // were made against — so once anything is paid only the day of the month can change.
  const nothingPaid = !installments.some((i) => i.status === "PAID");
  const firstInstallment = installments.slice().sort((a, b) => a.index - b.index)[0];

  const [title, setTitle] = useState<string>(plan.title);
  const [dueDay, setDueDay] = useState(String(plan.dueDay));
  const [firstDate, setFirstDate] = useState<Date>(() => (firstInstallment ? new Date(firstInstallment.dueDate) : new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The same function the server and the phone run, so what is previewed is what will be saved.
  const redating = useMemo(
    () =>
      redateInstallments({
        installments: installments.map((i) => ({ id: i.id, index: i.index, status: i.status, dueDate: new Date(i.dueDate) })),
        ...(nothingPaid ? { firstDueDate: dayKeyIso(firstDate) } : { dueDay: Number(dueDay) || undefined }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.installments, nothingPaid, firstDate, dueDay]
  );
  const movedDates = new Map((redating?.changes ?? []).map((c) => [c.id, c.dueDate]));
  const upcoming = installments
    .filter((i) => i.status !== "PAID")
    .map((i) => movedDates.get(i.id) ?? new Date(i.dueDate));
  const changedCount = redating?.changes.length ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiPatch(
        `/api/installment-plans/${plan.id}`,
        nothingPaid ? { title, firstDueDate: dayKeyIso(firstDate) } : { title, dueDay: Number(dueDay) }
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره تغییرات ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان"
          className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
        />
        {nothingPaid ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted">تاریخ اولین قسط (شمسی)</p>
            <JalaliDateInput value={firstDate} onChange={setFirstDate} />
            <p className="text-xs text-muted">قسط‌های بعدی هر ماه شمسی در همین روز سررسید می‌شوند.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-muted">روز سررسید هر ماه (شمسی)</p>
            <input
              type="number"
              dir="ltr"
              required
              min={1}
              max={31}
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              placeholder="روز سررسید (۱ تا ۳۱)"
              className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm text-right"
            />
            <p className="text-xs text-muted">
              فقط اقساط پرداخت‌نشده با روز جدید تنظیم می‌شوند؛ اقساط پرداخت‌شده تغییر نمی‌کنند.
            </p>
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="rounded-xl bg-canvas px-3 py-2 text-xs text-muted">
            {changedCount > 0 ? (
              <>
                {toPersianDigits(changedCount)} قسط جابه‌جا می‌شود · بعد از ذخیره: اولین قسط باقی‌مانده{" "}
                <span className="text-ink font-medium">{formatJalali(upcoming[0], { long: true })}</span>
                {upcoming.length > 1 && (
                  <>
                    ، آخرین قسط <span className="text-ink font-medium">{formatJalali(upcoming[upcoming.length - 1], { long: true })}</span>
                  </>
                )}
              </>
            ) : (
              <>تاریخ اقساط تغییری نمی‌کند.</>
            )}
          </div>
        )}
        {error && <p className="text-xs text-waste">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40">
            ذخیره تغییرات
          </button>
          <button type="button" onClick={onCancel} className="px-4 rounded-xl bg-canvas text-muted text-sm">
            انصراف
          </button>
        </div>
      </form>
    </Card>
  );
}

// The default first installment: the same Jalali day, one month from today.
function defaultFirstDueDate(): Date {
  return generateInstallmentSchedule({ startDate: new Date(), numberOfInstallments: 1, installmentAmount: 0 })[0].dueDate;
}

export function NewInstallmentPlanForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"PLAN" | "SIMPLE">("PLAN");
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [numberOfInstallments, setNumberOfInstallments] = useState("");
  const [simpleAmount, setSimpleAmount] = useState("");
  const [simpleCount, setSimpleCount] = useState("1");
  const [firstDate, setFirstDate] = useState<Date>(defaultFirstDueDate);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([60 * 24]);
  const [loading, setLoading] = useState(false);
  const { format } = useCurrencyUnit();

  const hasLoanFigures = mode === "PLAN" && totalAmount && installmentAmount && numberOfInstallments;
  // بدهی ساده has no interest — splitting it across months just divides the same total, so the
  // per-payment amount is rounded UP (never down) to make sure the sum collected across all
  // payments never falls short of the actual debt by even a Toman.
  const simplePerPaymentAmount =
    mode === "SIMPLE" && simpleAmount && Number(simpleCount) > 1 ? Math.ceil(Number(simpleAmount) / Number(simpleCount)) : null;
  const installmentCount = mode === "SIMPLE" ? Number(simpleCount) : Number(numberOfInstallments);

  function toggleOffset(minutes: number) {
    setReminderOffsets((prev) => (prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // "بدهی ساده" is just an N-installment plan with no interest — same backend, same
      // pay/edit/delete UI as a real loan plan, just without asking for a totalAmount separate
      // from the debt itself. count defaults to 1 (a single lump payment, the original behavior);
      // choosing a bigger count splits the same debt into that many equal monthly payments.
      const simpleTotal = Number(simpleAmount);
      const amount = mode === "SIMPLE" ? simplePerPaymentAmount ?? simpleTotal : Number(installmentAmount);
      await apiPost("/api/installment-plans", {
        title,
        totalAmount: mode === "SIMPLE" ? simpleTotal : Number(totalAmount),
        installmentAmount: amount,
        numberOfInstallments: installmentCount,
        // The Jalali day the person picked; every following installment lands on the same Jalali day.
        firstDueDate: dayKeyIso(firstDate),
        reminderOffsets,
      });
      notifySaved();
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          {(
            [
              { key: "PLAN", label: "طرح قسط‌دار" },
              { key: "SIMPLE", label: "بدهی ساده" },
            ] as const
          ).map((m) => (
            <button
              type="button"
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex-1 text-sm py-1.5 rounded-lg ${mode === m.key ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "SIMPLE" ? "عنوان (مثلاً قرض از رضا)" : "عنوان (مثلاً وام خودرو)"} className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" />
        {mode === "SIMPLE" ? (
          <>
            <MoneyInput value={simpleAmount} onChange={setSimpleAmount} placeholder="مبلغ کل بدهی" required />
            <div>
              <input
                type="number"
                dir="ltr"
                required
                min={1}
                max={360}
                value={simpleCount}
                onChange={(e) => setSimpleCount(e.target.value)}
                placeholder="تعداد پرداخت ماهانه"
                className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm text-right"
              />
              <p className="text-xs text-muted mt-1">
                {simplePerPaymentAmount
                  ? `${toPersianDigits(Number(simpleCount))} پرداخت ماهانه، هرکدام ${format(simplePerPaymentAmount, { withSuffix: true })}`
                  : "برای پرداخت یکجا ۱ بذار؛ برای تقسیم به چند قسط ماهانه مساوی، عدد بزرگ‌تر بذار."}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MoneyInput value={totalAmount} onChange={setTotalAmount} placeholder="مبلغ کل وام (اصل)" required />
              <MoneyInput value={installmentAmount} onChange={setInstallmentAmount} placeholder="مبلغ هر قسط" required />
            </div>
            <input type="number" dir="ltr" required min={1} max={360} value={numberOfInstallments} onChange={(e) => setNumberOfInstallments(e.target.value)} placeholder="تعداد اقساط" className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm text-right" />
          </>
        )}

        <div className="space-y-1.5">
          <p className="text-xs text-muted">{mode === "SIMPLE" ? "تاریخ اولین پرداخت (شمسی)" : "تاریخ اولین قسط (شمسی)"}</p>
          <JalaliDateInput value={firstDate} onChange={setFirstDate} />
          <SchedulePreview firstDueDate={firstDate} count={installmentCount} />
        </div>

        {hasLoanFigures && (
          <div className="rounded-xl bg-canvas p-3">
            <InterestSummary
              totalAmount={Number(totalAmount)}
              installmentAmount={Number(installmentAmount)}
              numberOfInstallments={Number(numberOfInstallments)}
            />
          </div>
        )}

        <div>
          <p className="text-xs text-muted mb-1.5">یادآوری هر قسط</p>
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_OFFSET_PRESETS.map((p) => (
              <button
                type="button"
                key={p.minutes}
                onClick={() => toggleOffset(p.minutes)}
                className={`text-xs px-2.5 py-1 rounded-full ${
                  reminderOffsets.includes(p.minutes) ? "bg-accent text-on-accent" : "bg-canvas text-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={loading} className="w-full rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
          ثبت طرح قسط
        </button>
      </form>
    </Card>
  );
}
