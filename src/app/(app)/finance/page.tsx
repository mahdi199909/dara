"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { useCategories, useAccounts } from "@/lib/hooks";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { formatJalali, toJalali } from "@/lib/jalali";
import { PlusIcon, EditIcon, TrashIcon } from "@/components/icons";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, REMINDER_OFFSET_PRESETS, type AccountType } from "@/lib/types";
import { computeLoanInterest, computeEffectiveAnnualRate } from "@/lib/installments";
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

      <FinanceSummary />

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

/**
 * موجودی نقد: sum of every account's balance — real, spendable money.
 * دارایی نقد شونده: registered real assets (Asset.currentValue) — physical things you could
 * actually go sell for cash, just not as instantly as an account balance.
 * دارایی غیر نقد شونده: virtual/digital assets — the app's own internal growth metric, already
 * described elsewhere as "نه پول نقد یا دارایی قابل‌فروش" (not cash or a sellable asset), which
 * is exactly what "non-liquid" means here.
 */
function FinanceSummary() {
  const { accounts } = useAccounts();
  const { data: assetsData } = useSWR<{ assets: any[] }>("/api/assets", fetcher);
  const { data: vaData } = useSWR<{ total: number }>("/api/virtual-assets", fetcher);
  const { format } = useCurrencyUnit();

  const cash = accounts.reduce((s: number, a: any) => s + a.balance, 0);
  const liquid = assetsData?.assets.reduce((s, a) => s + a.currentValue, 0) ?? 0;
  const nonLiquid = vaData?.total ?? 0;

  return (
    <div className="grid grid-cols-3 gap-2">
      <Card className="p-3">
        <StatItem label="موجودی نقد" value={format(cash, { withSuffix: true })} />
      </Card>
      <Card className="p-3">
        <StatItem label="دارایی نقد شونده" value={format(liquid, { withSuffix: true })} tone="positive" />
      </Card>
      <Card className="p-3">
        <StatItem label="دارایی غیر نقد شونده" value={format(nonLiquid, { withSuffix: true })} />
      </Card>
    </div>
  );
}

function TransactionsTab() {
  const { data, mutate } = useSWR<{ transactions: any[] }>("/api/transactions", fetcher);
  const { categories } = useCategories();
  const { accounts } = useAccounts();
  const [showForm, setShowForm] = useState(false);
  const [editingTx, setEditingTx] = useState<any | null>(null);
  const { format } = useCurrencyUnit();

  async function remove(id: string) {
    if (!confirm("این تراکنش حذف شود؟")) return;
    try {
      await apiDelete(`/api/transactions/${id}`);
      mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "حذف تراکنش ناموفق بود.");
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => {
          setEditingTx(null);
          setShowForm((v) => !v);
        }}
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

      {editingTx && (
        <EditTransactionForm
          tx={editingTx}
          categories={categories}
          onDone={() => {
            setEditingTx(null);
            mutate();
          }}
          onCancel={() => setEditingTx(null)}
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
              <li key={tx.id} className="flex items-center justify-between px-4 py-3 gap-2">
                <div className="min-w-0 flex-1">
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
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setEditingTx(tx);
                    }}
                    aria-label="ویرایش"
                    className="p-1.5 rounded-lg text-muted hover:bg-canvas"
                  >
                    <EditIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(tx.id)} aria-label="حذف" className="p-1.5 rounded-lg text-waste hover:bg-canvas">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function EditTransactionForm({
  tx,
  categories,
  onDone,
  onCancel,
}: {
  tx: any;
  categories: any[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(tx.amount));
  const [description, setDescription] = useState(tx.description ?? "");
  const [categoryId, setCategoryId] = useState(tx.categoryId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Only amount/description/category are editable after creation — type and account would
  // require re-deriving account balances, which the API intentionally doesn't support (see
  // updateTransactionSchema in src/lib/schemas/transactions.ts).
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount) return;
    setLoading(true);
    setError("");
    try {
      await apiPatch(`/api/transactions/${tx.id}`, {
        amount: Number(amount),
        description: description || null,
        categoryId: categoryId || null,
      });
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
        <p className="text-xs text-muted">
          {tx.type === "EXPENSE" ? "هزینه" : tx.type === "INCOME" ? "درآمد" : "انتقال"} · {tx.account?.name}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput value={amount} onChange={setAmount} placeholder="مبلغ" required />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیحات"
            className="bg-surface rounded-xl border border-line px-3 py-2 text-sm"
          />
        </div>
        {tx.type !== "TRANSFER" && (
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="bg-surface w-full rounded-xl border border-line px-2 py-2 text-sm">
            <option value="">دسته‌بندی</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
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
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
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

  async function remove(id: string) {
    if (!confirm("این حساب حذف شود؟")) return;
    try {
      await apiDelete(`/api/accounts/${id}`);
      mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "حذف حساب ناموفق بود.");
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => {
          setEditingAccount(null);
          setShowForm((v) => !v);
        }}
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

      {editingAccount && (
        <EditAccountForm
          account={editingAccount}
          onDone={() => {
            setEditingAccount(null);
            mutate();
          }}
          onCancel={() => setEditingAccount(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-3">
        {data?.accounts.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted">{ACCOUNT_TYPE_LABELS[a.type as AccountType]}</p>
                <p className="font-bold text-ink mt-0.5 truncate">{a.name}</p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditingAccount(a);
                  }}
                  aria-label="ویرایش"
                  className="p-1.5 rounded-lg text-muted hover:bg-canvas"
                >
                  <EditIcon className="w-4 h-4" />
                </button>
                <button onClick={() => remove(a.id)} aria-label="حذف" className="p-1.5 rounded-lg text-waste hover:bg-canvas">
                  <TrashIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-lg font-bold text-accent mt-2">{format(a.balance, { withSuffix: true })}</p>
          </Card>
        ))}
        {data?.accounts.length === 0 && <EmptyState message="هنوز حسابی ثبت نکرده‌اید." />}
      </div>
    </div>
  );
}

function EditAccountForm({ account, onDone, onCancel }: { account: any; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(account.name);
  const [type, setType] = useState<AccountType>(account.type);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiPatch(`/api/accounts/${account.id}`, { name, type });
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="نام حساب"
          className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
        />
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="bg-surface w-full rounded-xl border border-line px-2 py-2 text-sm">
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
          ))}
        </select>
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

function InstallmentsTab() {
  const { data, mutate } = useSWR<{ plans: any[] }>("/api/installment-plans", fetcher);
  const { accounts } = useAccounts();
  const [showForm, setShowForm] = useState(false);
  const { format } = useCurrencyUnit();

  // This Jalali month's installments across every plan — a planning overview independent of
  // any single plan's own card, which only shows that one plan's totals.
  const { jy: curJy, jm: curJm } = toJalali(new Date());
  const thisMonthInstallments = (data?.plans ?? []).flatMap((plan: any) =>
    plan.installments.filter((i: any) => {
      const { jy, jm } = toJalali(new Date(i.dueDate));
      return jy === curJy && jm === curJm;
    })
  );
  const thisMonthTotal = thisMonthInstallments.reduce((s: number, i: any) => s + i.amount, 0);
  const thisMonthPaid = thisMonthInstallments.filter((i: any) => i.status === "PAID").reduce((s: number, i: any) => s + i.amount, 0);
  const thisMonthRemaining = thisMonthTotal - thisMonthPaid;

  return (
    <div className="space-y-3">
      {thisMonthInstallments.length > 0 && (
        <Card className="p-4">
          <p className="text-xs text-muted mb-2">اقساط این ماه</p>
          <div className="grid grid-cols-3 gap-2">
            <StatItem label="مجموع" value={format(thisMonthTotal, { withSuffix: true })} />
            <StatItem label="پرداخت‌شده" value={format(thisMonthPaid, { withSuffix: true })} tone="positive" />
            <StatItem label="باقی‌مانده" value={format(thisMonthRemaining, { withSuffix: true })} tone="negative" />
          </div>
        </Card>
      )}

      <button
        onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
      >
        <PlusIcon className="w-4 h-4" />
        طرح قسط جدید
      </button>

      {showForm && <NewInstallmentPlanForm onDone={() => { setShowForm(false); mutate(); }} />}

      {data?.plans.length === 0 && <EmptyState message="هنوز طرح قسطی ثبت نکرده‌اید." />}

      {data?.plans
        // Chronological — the plan due soonest first; fully-paid plans (no nextDueDate) sink to the end.
        .slice()
        .sort((a, b) => {
          if (!a.summary.nextDueDate && !b.summary.nextDueDate) return 0;
          if (!a.summary.nextDueDate) return 1;
          if (!b.summary.nextDueDate) return -1;
          return new Date(a.summary.nextDueDate).getTime() - new Date(b.summary.nextDueDate).getTime();
        })
        .map((plan) => (
          <InstallmentPlanCard key={plan.id} plan={plan} accounts={accounts} onChanged={mutate} />
        ))}
    </div>
  );
}

const INSTALLMENT_STATUS_LABELS: Record<string, string> = { PENDING: "در انتظار", PAID: "پرداخت‌شده", OVERDUE: "دیرکرد" };

function InstallmentPlanCard({ plan, accounts, onChanged }: { plan: any; accounts: any[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [payAccountId, setPayAccountId] = useState(accounts[0]?.id ?? "");
  const [payingId, setPayingId] = useState<string | null>(null);
  const { format } = useCurrencyUnit();

  const interest = computeLoanInterest({
    totalAmount: plan.totalAmount,
    installmentAmount: plan.installmentAmount,
    numberOfInstallments: plan.numberOfInstallments,
  });
  const annualRate = computeEffectiveAnnualRate({
    totalAmount: plan.totalAmount,
    installmentAmount: plan.installmentAmount,
    numberOfInstallments: plan.numberOfInstallments,
  });

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
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-ink">{plan.title}</h3>
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
      {interest.interest > 0 && (
        <div className="mt-3 rounded-xl bg-waste-50 px-3 py-2 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted">
              مبلغ اصل: {format(plan.totalAmount, { withSuffix: true })} · مجموع بازپرداخت: {format(interest.totalPayable, { withSuffix: true })}
            </span>
            <span className="text-waste font-bold shrink-0">
              سود واقعی: {format(interest.interest, { withSuffix: true })} ({interest.interestPercent.toFixed(1)}٪)
            </span>
          </div>
          {annualRate.effectiveAnnualRate > 0 && (
            <div className="flex items-center justify-between border-t border-waste/10 pt-1">
              <span className="text-muted">نرخ سود واقعی سالانه (با احتساب مرکب ماهانه)</span>
              <span className="text-waste font-bold shrink-0">{annualRate.effectiveAnnualRatePercent.toFixed(1)}٪</span>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted mt-3 mb-1.5">
        {plan.summary.paidCount} از {plan.summary.totalCount} قسط پرداخت‌شده
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
            <span className="text-muted shrink-0">قسط {inst.index}</span>
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
  );
}

function EditInstallmentPlanForm({ plan, onDone, onCancel }: { plan: any; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(plan.title);
  const [dueDay, setDueDay] = useState(String(plan.dueDay));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDay) return;
    setLoading(true);
    setError("");
    try {
      await apiPatch(`/api/installment-plans/${plan.id}`, { title, dueDay: Number(dueDay) });
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
        <div>
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
          <p className="text-xs text-muted mt-1">فقط اقساط پرداخت‌نشده با روز سررسید جدید تنظیم می‌شوند؛ اقساط پرداخت‌شده تغییر نمی‌کنند.</p>
        </div>
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

function NewInstallmentPlanForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"PLAN" | "SIMPLE">("PLAN");
  const [title, setTitle] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [numberOfInstallments, setNumberOfInstallments] = useState("");
  const [simpleAmount, setSimpleAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([60 * 24]);
  const [loading, setLoading] = useState(false);
  const { format } = useCurrencyUnit();

  const preview =
    mode === "PLAN" && totalAmount && installmentAmount && numberOfInstallments
      ? computeLoanInterest({
          totalAmount: Number(totalAmount),
          installmentAmount: Number(installmentAmount),
          numberOfInstallments: Number(numberOfInstallments),
        })
      : null;
  const previewAnnualRate =
    mode === "PLAN" && totalAmount && installmentAmount && numberOfInstallments
      ? computeEffectiveAnnualRate({
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
      // "بدهی ساده" is just a 1-installment plan — same backend, same pay/edit/delete UI, just
      // without asking for a totalAmount separate from the single payment amount.
      const amount = mode === "SIMPLE" ? Number(simpleAmount) : Number(installmentAmount);
      const count = mode === "SIMPLE" ? 1 : Number(numberOfInstallments);
      await apiPost("/api/installment-plans", {
        title,
        totalAmount: mode === "SIMPLE" ? amount : Number(totalAmount),
        installmentAmount: amount,
        numberOfInstallments: count,
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
          <MoneyInput value={simpleAmount} onChange={setSimpleAmount} placeholder="مبلغ" required />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MoneyInput value={totalAmount} onChange={setTotalAmount} placeholder="مبلغ کل وام (اصل)" required />
              <MoneyInput value={installmentAmount} onChange={setInstallmentAmount} placeholder="مبلغ هر قسط" required />
            </div>
            <input type="number" dir="ltr" required value={numberOfInstallments} onChange={(e) => setNumberOfInstallments(e.target.value)} placeholder="تعداد اقساط" className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm text-right" />
          </>
        )}
        <input type="number" dir="ltr" required min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="روز سررسید (۱ تا ۳۱)" className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm text-right" />

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
            {previewAnnualRate && previewAnnualRate.effectiveAnnualRate > 0 && (
              <div className="flex justify-between border-t border-line pt-1">
                <span className="text-muted">نرخ سود واقعی سالانه (مرکب)</span>
                <span className="font-bold text-waste">{previewAnnualRate.effectiveAnnualRatePercent.toFixed(1)}٪</span>
              </div>
            )}
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
