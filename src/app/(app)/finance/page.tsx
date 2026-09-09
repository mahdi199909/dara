"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { useCategories, useAccounts } from "@/lib/hooks";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { formatJalali } from "@/lib/jalali";
import { PlusIcon } from "@/components/icons";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, REMINDER_OFFSET_PRESETS, type AccountType } from "@/lib/types";
import { computeLoanInterest } from "@/lib/installments";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import MoneyInput from "@/components/ui/MoneyInput";

const TABS = [
  { key: "transactions", label: "تراکنش‌ها" },
  { key: "accounts", label: "حساب‌ها" },
  { key: "installments", label: "اقساط" },
] as const;

export default function FinancePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("transactions");

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-ink">مالی</h1>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-3.5 py-1.5 rounded-full transition ${
              tab === t.key ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "transactions" && <TransactionsTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "installments" && <InstallmentsTab />}
    </div>
  );
}

function TransactionsTab() {
  const { data, mutate } = useSWR<{ transactions: any[] }>("/api/transactions", fetcher);
  const { categories } = useCategories();
  const { accounts } = useAccounts();
  const [showForm, setShowForm] = useState(false);
  const { format } = useCurrencyUnit();

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
      >
        <PlusIcon className="w-4 h-4" />
        تراکنش جدید
      </button>

      {showForm && (
        <NewTransactionForm
          categories={categories}
          accounts={accounts}
          onDone={() => {
            setShowForm(false);
            mutate();
          }}
        />
      )}

      <Card>
        {!data ? (
          <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
        ) : data.transactions.length === 0 ? (
          <EmptyState message="هنوز تراکنشی ثبت نکرده‌اید." />
        ) : (
          <ul className="divide-y divide-line">
            {data.transactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">{tx.description || tx.category?.name || "تراکنش"}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {tx.account.name} · {formatJalali(new Date(tx.date))}
                  </p>
                </div>
                <span
                  className={`text-sm font-bold shrink-0 ${
                    tx.type === "INCOME" ? "text-accent" : tx.type === "EXPENSE" ? "text-waste" : "text-muted"
                  }`}
                >
                  {tx.type === "EXPENSE" ? "-" : tx.type === "INCOME" ? "+" : ""}
                  {format(tx.amount, { withSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewTransactionForm({ categories, accounts, onDone }: { categories: any[]; accounts: any[]; onDone: () => void }) {
  const [type, setType] = useState<"INCOME" | "EXPENSE" | "TRANSFER">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [transferToAccountId, setTransferToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !accountId) return;
    setLoading(true);
    try {
      await apiPost("/api/transactions", {
        type,
        amount: Number(amount),
        description: description || undefined,
        accountId,
        transferToAccountId: type === "TRANSFER" ? transferToAccountId : undefined,
        categoryId: categoryId || undefined,
      });
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 text-sm py-1.5 rounded-lg ${type === t ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}
            >
              {t === "EXPENSE" ? "هزینه" : t === "INCOME" ? "درآمد" : "انتقال"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput value={amount} onChange={setAmount} placeholder="مبلغ" required />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیحات"
            className="bg-surface rounded-xl border border-line px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select required value={accountId} onChange={(e) => setAccountId(e.target.value)} className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
            <option value="">{type === "TRANSFER" ? "از حساب" : "حساب"}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {type === "TRANSFER" ? (
            <select required value={transferToAccountId} onChange={(e) => setTransferToAccountId(e.target.value)} className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
              <option value="">به حساب</option>
              {accounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          ) : (
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
              <option value="">دسته‌بندی</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          )}
        </div>
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40">
          ثبت تراکنش
        </button>
      </form>
    </Card>
  );
}

function AccountsTab() {
  const { data, mutate } = useSWR<{ accounts: any[] }>("/api/accounts", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("BANK_ACCOUNT");
  const [initialBalance, setInitialBalance] = useState("");
  const [loading, setLoading] = useState(false);
  const { format } = useCurrencyUnit();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await apiPost("/api/accounts", { name, type, initialBalance: initialBalance ? Number(initialBalance) : 0 });
      setName("");
      setInitialBalance("");
      setShowForm(false);
      mutate();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
      >
        <PlusIcon className="w-4 h-4" />
        حساب جدید
      </button>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام حساب"
              className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <MoneyInput value={initialBalance} onChange={setInitialBalance} placeholder="موجودی اولیه" />
            </div>
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
              ثبت حساب
            </button>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3">
        {data?.accounts.map((a) => (
          <Card key={a.id} className="p-4">
            <p className="text-xs text-muted">{ACCOUNT_TYPE_LABELS[a.type as AccountType]}</p>
            <p className="font-bold text-ink mt-0.5">{a.name}</p>
            <p className="text-lg font-bold text-accent mt-2">{format(a.balance, { withSuffix: true })}</p>
          </Card>
        ))}
        {data?.accounts.length === 0 && <EmptyState message="هنوز حسابی ثبت نکرده‌اید." />}
      </div>
    </div>
  );
}

function InstallmentsTab() {
  const { data, mutate } = useSWR<{ plans: any[] }>("/api/installment-plans", fetcher);
  const { accounts } = useAccounts();
  const [showForm, setShowForm] = useState(false);
  const { format } = useCurrencyUnit();

  async function pay(installmentId: string, accountId: string) {
    await apiPost(`/api/installments/${installmentId}/pay`, { accountId });
    mutate();
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
      >
        <PlusIcon className="w-4 h-4" />
        طرح قسط جدید
      </button>

      {showForm && <NewInstallmentPlanForm onDone={() => { setShowForm(false); mutate(); }} />}

      {data?.plans.length === 0 && <EmptyState message="هنوز طرح قسطی ثبت نکرده‌اید." />}

      {data?.plans.map((plan) => {
        const nextDue = plan.installments.find((i: any) => i.status !== "PAID");
        const interest = computeLoanInterest({
          totalAmount: plan.totalAmount,
          installmentAmount: plan.installmentAmount,
          numberOfInstallments: plan.numberOfInstallments,
        });
        return (
          <Card key={plan.id} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-ink">{plan.title}</h3>
              {nextDue && accounts[0] && (
                <button
                  onClick={() => pay(nextDue.id, accounts[0].id)}
                  className="text-xs bg-accent-soft text-accent px-3 py-1.5 rounded-lg hover:bg-accent-soft"
                >
                  پرداخت قسط بعدی
                </button>
              )}
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
            {interest.interest > 0 && (
              <div className="mt-3 rounded-xl bg-waste-50 px-3 py-2 flex items-center justify-between text-xs">
                <span className="text-muted">
                  مبلغ اصل: {format(plan.totalAmount, { withSuffix: true })} · مجموع بازپرداخت: {format(interest.totalPayable, { withSuffix: true })}
                </span>
                <span className="text-waste font-bold shrink-0">
                  سود واقعی: {format(interest.interest, { withSuffix: true })} ({interest.interestPercent.toFixed(1)}٪)
                </span>
              </div>
            )}
            <p className="text-xs text-muted mt-3">
              {plan.summary.paidCount} از {plan.summary.totalCount} قسط پرداخت‌شده
            </p>
          </Card>
        );
      })}
    </div>
  );
}

function NewInstallmentPlanForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [numberOfInstallments, setNumberOfInstallments] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([60 * 24]);
  const [loading, setLoading] = useState(false);
  const { format } = useCurrencyUnit();

  const preview =
    totalAmount && installmentAmount && numberOfInstallments
      ? computeLoanInterest({
          totalAmount: Number(totalAmount),
          installmentAmount: Number(installmentAmount),
          numberOfInstallments: Number(numberOfInstallments),
        })
      : null;

  function toggleOffset(minutes: number) {
    setReminderOffsets((prev) => (prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/installment-plans", {
        title,
        totalAmount: Number(totalAmount),
        installmentAmount: Number(installmentAmount),
        numberOfInstallments: Number(numberOfInstallments),
        dueDay: Number(dueDay),
        reminderOffsets,
      });
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان (مثلاً وام خودرو)" className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput value={totalAmount} onChange={setTotalAmount} placeholder="مبلغ کل وام (اصل)" required />
          <MoneyInput value={installmentAmount} onChange={setInstallmentAmount} placeholder="مبلغ هر قسط" required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" dir="ltr" required value={numberOfInstallments} onChange={(e) => setNumberOfInstallments(e.target.value)} placeholder="تعداد اقساط" className="bg-surface rounded-xl border border-line px-3 py-2 text-sm text-right" />
          <input type="number" dir="ltr" required min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="روز سررسید (۱ تا ۲۸)" className="bg-surface rounded-xl border border-line px-3 py-2 text-sm text-right" />
        </div>

        {preview && (
          <div className="rounded-xl bg-canvas p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted">مجموع بازپرداخت</span>
              <span className="text-ink font-medium">{format(preview.totalPayable, { withSuffix: true })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">سود واقعی</span>
              <span className={`font-bold ${preview.interest > 0 ? "text-waste" : "text-accent"}`}>
                {format(preview.interest, { withSuffix: true })} ({preview.interestPercent.toFixed(1)}٪)
              </span>
            </div>
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
