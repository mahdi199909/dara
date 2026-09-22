"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { useCategories, useAccounts, useBudgets, useSavingsGoals } from "@/lib/hooks";
import CategoryChipPicker, { selectableCategories } from "@/components/CategoryChipPicker";
import { computeBudgetProgress } from "@/lib/budgetProgress";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { formatJalali, toJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { dayKeyIso } from "@/lib/calendarGrid";
import { ringArcPath, RING_START_DEG, RING_SWEEP_DEG } from "@/lib/ringArc";
import { PlusIcon, EditIcon, TrashIcon } from "@/components/icons";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, REMINDER_OFFSET_PRESETS, type AccountType } from "@/lib/types";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import MoneyInput from "@/components/ui/MoneyInput";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { notifySaved } from "@/lib/savedToast";
import { InstallmentPlanCard, NewInstallmentPlanForm, formatPercent } from "@/components/finance/InstallmentPlans";
import { detectRecurringTransactions, recurringSpendThisMonth, type RecurringCandidate } from "@/lib/recurringTransactions";
import { computeEffectiveAnnualRate } from "@/lib/installments";
import { rankDebtsForPayoff, monthsSoonerWithExtra, type DebtForPayoff, type PayoffStrategy } from "@/lib/debtPayoffOptimizer";

const TABS = [
  { key: "transactions", label: "تراکنش‌ها" },
  { key: "accounts", label: "حساب‌ها" },
  { key: "installments", label: "اقساط" },
  { key: "budgets", label: "بودجه‌ها" },
  { key: "goals", label: "اهداف" },
] as const;

// useSearchParams needs a Suspense boundary for the static (Android) export.
export default function FinancePage() {
  return (
    <Suspense fallback={null}>
      <FinancePageInner />
    </Suspense>
  );
}

function FinancePageInner() {
  // A search result for an installment plan lands here as /finance?tab=installments&plan=<id>.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(TABS.some((t) => t.key === tabParam) ? (tabParam as (typeof TABS)[number]["key"]) : "transactions");

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-ink">مالی</h1>

      <FinanceSummary />
      <RecurringTransactionSuggestions />

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
      {tab === "installments" && <InstallmentsTab highlightPlanId={searchParams.get("plan")} />}
      {tab === "budgets" && <BudgetsTab />}
      {tab === "goals" && <SavingsGoalsTab />}
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

/**
 * "این هر ماه تکرار می‌شود، ثبت شود؟" — src/lib/recurringTransactions.ts finds ad-hoc (never an
 * installment/task/event/activity's own transaction) entries repeating in the same category at a
 * similar amount, and offers to log this month's occurrence in one tap. Nothing here ever writes
 * on its own — تأیید posts the same /api/transactions call a person typing it in by hand would,
 * and "فعلاً نه" only hides a candidate for this page view (not persisted — see the component's
 * own note on why that's an acceptable v1 scope rather than a real dismissal record).
 */
function RecurringTransactionSuggestions() {
  const { data, mutate } = useSWR<{ transactions: any[] }>("/api/transactions", fetcher);
  const { format } = useCurrencyUnit();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loggingId, setLoggingId] = useState<string | null>(null);

  const detected = detectRecurringTransactions(
    (data?.transactions ?? []).map((t: any) => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      date: new Date(t.date),
      type: t.type,
      categoryId: t.categoryId,
      accountId: t.accountId,
      installmentId: t.installmentId,
      taskId: t.taskId,
      eventId: t.eventId,
      activityId: t.activityId,
    }))
  );
  const monthlySpend = recurringSpendThisMonth(detected);
  const suggestions = detected.filter((c) => c.thisMonthAmount == null && !dismissed.has(c.categoryId));

  if (monthlySpend === 0 && suggestions.length === 0) return null;

  async function logNow(c: RecurringCandidate) {
    setLoggingId(c.categoryId);
    try {
      await apiPost("/api/transactions", {
        type: c.type,
        amount: c.averageAmount,
        accountId: c.accountId,
        categoryId: c.categoryId,
        description: c.title,
        date: new Date().toISOString(),
      });
      notifySaved();
      mutate();
    } catch {
      // The button's own disabled/loading state already communicates "still trying"; a failed
      // log just leaves the suggestion in place to try again, same as any other save failure here.
    } finally {
      setLoggingId(null);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      {monthlySpend > 0 && (
        <p className="text-sm text-ink">
          این ماه <span className="font-bold">{format(monthlySpend, { withSuffix: true })}</span> صرفِ تکرارشونده‌ها شد.
        </p>
      )}
      {suggestions.map((c) => (
        <div key={c.categoryId} className="flex items-center justify-between gap-2 pt-2 border-t border-line first:border-0 first:pt-0">
          <div className="min-w-0">
            <p className="text-sm text-ink truncate">{c.title}</p>
            <p className="text-xs text-muted mt-0.5">هر ماه تکرار می‌شود · {format(c.averageAmount, { withSuffix: true })}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setDismissed((prev) => new Set(prev).add(c.categoryId))}
              className="text-xs text-muted px-2 py-1.5"
            >
              فعلاً نه
            </button>
            <button
              type="button"
              disabled={loggingId === c.categoryId}
              onClick={() => logNow(c)}
              className="text-xs font-medium text-on-accent bg-accent rounded-lg px-3 py-1.5 disabled:opacity-40"
            >
              {loggingId === c.categoryId ? "..." : "ثبت کن"}
            </button>
          </div>
        </div>
      ))}
    </Card>
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
      notifySaved();
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

/** This month's paid-vs-total ratio as the same "open ring" gauge reports/page.tsx uses — the
 * dashboard's focal visual, not just three plain numbers. */
function MonthInstallmentRing({ paid, total }: { paid: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, paid / total) : 0;
  const sweep = RING_SWEEP_DEG * ratio;
  return (
    <div className="relative w-[132px] h-[132px] shrink-0">
      <svg viewBox="0 0 132 132" width="132" height="132">
        <path d={ringArcPath(66, 66, 58, RING_START_DEG, RING_SWEEP_DEG)} fill="none" stroke="rgb(var(--line))" strokeWidth="14" strokeLinecap="round" />
        <path d={ringArcPath(66, 66, 58, RING_START_DEG, sweep)} fill="none" stroke="rgb(var(--accent))" strokeWidth="14" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold text-ink">{toPersianDigits(Math.round(ratio * 100))}٪</span>
        <span className="text-[10px] text-muted mt-0.5">پرداخت‌شده</span>
      </div>
    </div>
  );
}

function InstallmentsTab({ highlightPlanId }: { highlightPlanId?: string | null }) {
  const { data, mutate } = useSWR<{ plans: any[] }>("/api/installment-plans", fetcher);
  const { accounts } = useAccounts();
  const [showForm, setShowForm] = useState(false);
  const { format } = useCurrencyUnit();

  // This Jalali month's installments across every plan — a planning overview independent of
  // any single plan's own card, which only shows that one plan's totals. Carries planTitle
  // through so the horizontal strip below can label each chip without a second lookup.
  const { jy: curJy, jm: curJm } = toJalali(new Date());
  const thisMonthInstallments = (data?.plans ?? [])
    .flatMap((plan: any) =>
      plan.installments
        .filter((i: any) => {
          const { jy, jm } = toJalali(new Date(i.dueDate));
          return jy === curJy && jm === curJm;
        })
        .map((i: any) => ({ ...i, planTitle: plan.title }))
    )
    .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const thisMonthTotal = thisMonthInstallments.reduce((s: number, i: any) => s + i.amount, 0);
  const thisMonthPaid = thisMonthInstallments.filter((i: any) => i.status === "PAID").reduce((s: number, i: any) => s + i.amount, 0);
  const thisMonthRemaining = thisMonthTotal - thisMonthPaid;

  // Lifetime totals across every plan (not just this month) — the "big picture" debt situation,
  // below the month dashboard. Each plan's own summary (summarizeInstallments) already has these.
  const overallTotal = (data?.plans ?? []).reduce((s: number, p: any) => s + p.summary.totalAmount, 0);
  const overallPaid = (data?.plans ?? []).reduce((s: number, p: any) => s + p.summary.paidAmount, 0);
  const overallRemaining = overallTotal - overallPaid;

  return (
    <div className="space-y-3">
      {data && data.plans.length > 0 && (
        <>
          <Card className="p-5">
            <p className="text-sm font-bold text-ink mb-4">اقساط این ماه</p>
            <div className="flex items-center gap-5">
              <MonthInstallmentRing paid={thisMonthPaid} total={thisMonthTotal} />
              <div className="flex-1 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">مجموع</span>
                  <span className="text-base font-bold text-ink">{format(thisMonthTotal, { withSuffix: true })}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">پرداخت‌شده</span>
                  <span className="text-base font-bold text-accent">{format(thisMonthPaid, { withSuffix: true })}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">باقی‌مانده</span>
                  <span className="text-base font-bold text-waste">{format(thisMonthRemaining, { withSuffix: true })}</span>
                </div>
              </div>
            </div>

            {thisMonthInstallments.length > 0 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-thin snap-x snap-mandatory pt-4 mt-4 border-t border-line -mx-1 px-1">
                {thisMonthInstallments.map((i: any) => (
                  <div key={i.id} className="shrink-0 snap-start w-[128px] rounded-xl border border-line bg-canvas p-2.5">
                    <p className="text-xs text-ink truncate">{i.planTitle}</p>
                    <p className="text-[10px] text-muted mt-1">{formatJalali(new Date(i.dueDate))}</p>
                    <p className={`text-xs font-bold mt-1.5 ${i.status === "PAID" ? "text-accent" : "text-ink"}`}>
                      {format(i.amount, { withSuffix: true })}
                    </p>
                    {i.status === "PAID" && <p className="text-[10px] text-accent mt-0.5">پرداخت‌شده</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-3 gap-2">
            <Card className="p-3 text-center">
              <p className="text-[11px] text-muted mb-1">مجموع کل اقساط</p>
              <p className="text-sm font-bold text-ink">{format(overallTotal, { withSuffix: true })}</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-[11px] text-muted mb-1">کل پرداخت‌شده</p>
              <p className="text-sm font-bold text-accent">{format(overallPaid, { withSuffix: true })}</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-[11px] text-muted mb-1">کل باقی‌مانده</p>
              <p className="text-sm font-bold text-waste">{format(overallRemaining, { withSuffix: true })}</p>
            </Card>
          </div>

          <DebtPayoffOptimizer plans={data.plans.filter((p: any) => p.summary.remainingCount > 0)} />
        </>
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
          <InstallmentPlanCard key={plan.id} plan={plan} accounts={accounts} onChanged={mutate} highlighted={plan.id === highlightPlanId} />
        ))}
    </div>
  );
}

/**
 * «بهینه‌سازِ بازپرداختِ بدهی» — only once there are 2+ open plans (one plan has no ordering
 * decision to make). بهمنی ranks by effectiveAnnualRatePercent (the real APR computeEffectiveAnnualRate
 * already derives per plan) — the most expensive money first; گلوله‌برفی ranks by remaining balance
 * ascending — the smallest debt first, for an early win. This app's plans are fixed nominal
 * installments with no amortization split and no early-settlement discount, so re-ordering payments
 * never changes any plan's own total interest (that was fixed when it was created) — only WHEN each
 * one finishes. So this only ever claims a debt "finishes sooner," never a fabricated "less interest."
 */
function DebtPayoffOptimizer({ plans }: { plans: any[] }) {
  const [strategy, setStrategy] = useState<PayoffStrategy>("AVALANCHE");
  const [extra, setExtra] = useState("");
  const { format } = useCurrencyUnit();

  if (plans.length < 2) return null;

  const debts: DebtForPayoff[] = plans.map((p) => ({
    id: p.id,
    title: p.title,
    remainingAmount: p.summary.remainingAmount,
    remainingCount: p.summary.remainingCount,
    installmentAmount: p.installmentAmount,
    effectiveAnnualRatePercent: computeEffectiveAnnualRate({
      totalAmount: p.totalAmount,
      installmentAmount: p.installmentAmount,
      numberOfInstallments: p.numberOfInstallments,
    }).effectiveAnnualRatePercent,
  }));
  const ranked = rankDebtsForPayoff(debts, strategy);
  const top = ranked[0];
  const extraAmount = Number(extra) || 0;
  const sooner = top ? monthsSoonerWithExtra(top.remainingCount, top.installmentAmount, extraAmount) : 0;

  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm font-bold text-ink">اولویتِ پرداختِ اضافه</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStrategy("AVALANCHE")}
          className={`flex-1 text-xs px-3 py-2 rounded-xl border transition ${strategy === "AVALANCHE" ? "bg-accent text-on-accent border-accent" : "bg-canvas text-muted border-line"}`}
        >
          بهمنی — گران‌ترین اول
        </button>
        <button
          type="button"
          onClick={() => setStrategy("SNOWBALL")}
          className={`flex-1 text-xs px-3 py-2 rounded-xl border transition ${strategy === "SNOWBALL" ? "bg-accent text-on-accent border-accent" : "bg-canvas text-muted border-line"}`}
        >
          گلوله‌برفی — کم‌مانده اول
        </button>
      </div>

      <div className="space-y-1.5">
        {ranked.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-line last:border-0">
            <span className="flex items-center gap-1.5 text-ink min-w-0">
              <span className="shrink-0 w-4 h-4 rounded-full bg-canvas text-muted text-[10px] flex items-center justify-center font-bold">{toPersianDigits(d.order)}</span>
              <span className="truncate">{d.title}</span>
            </span>
            <span className="shrink-0 text-muted">
              {format(d.remainingAmount, { withSuffix: true })}
              {d.effectiveAnnualRatePercent > 0 && <span className="text-waste"> · {formatPercent(d.effectiveAnnualRatePercent)}</span>}
            </span>
          </div>
        ))}
      </div>

      <MoneyInput value={extra} onChange={setExtra} placeholder="مبلغِ اضافهٔ ماهانه (اختیاری)" />

      {top && extraAmount > 0 && (
        <p className="text-xs text-ink leading-6">
          {sooner > 0 ? (
            <>
              با این مبلغِ اضافه روی «{top.title}»، این بدهی به‌جای {toPersianDigits(top.remainingCount)} ماهِ دیگر،{" "}
              <span className="font-bold text-accent">{toPersianDigits(top.remainingCount - sooner)} ماهِ دیگر</span> تمام می‌شود — {toPersianDigits(sooner)} ماه زودتر.
            </>
          ) : (
            "این مبلغ برای زودتر تمام‌شدن، هنوز به‌اندازهٔ یک قسط کامل نیست."
          )}
        </p>
      )}
    </Card>
  );
}

/**
 * «سقفِ ماهانه» یک دسته با نوار پیشرفت. سقف از طریق POST /api/budgets تنظیم می‌شود که یک upsert
 * روی categoryId است — یک دکمهٔ ادیت جدا معنا ندارد چون هر دسته حداکثر یک بودجه دارد؛ فرم ویرایش
 * همان فرم افزودن است، از پیش با سقف فعلی پر شده. رنگ هشدار نزدیکِ سقف از توکن‌های signal/signal-soft
 * است، نه waste — رسیدن به سقف باید خنثی/آگاهی‌بخش باشد، نه جریمه (قاعدهٔ ضدشرمساری این اپ).
 */
function BudgetsTab() {
  const { budgets, mutate } = useBudgets();
  const { categories } = useCategories();
  const { data: txData } = useSWR<{ transactions: any[] }>("/api/transactions", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState<any | null>(null);
  const { format } = useCurrencyUnit();

  const progressByCategory = new Map(
    computeBudgetProgress(
      budgets.map((b: any) => ({ categoryId: b.categoryId, monthlyCap: b.monthlyCap })),
      (txData?.transactions ?? []).map((t: any) => ({ type: t.type, categoryId: t.categoryId, amount: t.amount, date: new Date(t.date) }))
    ).map((p) => [p.categoryId, p] as const)
  );

  async function remove(id: string) {
    if (!confirm("این بودجه حذف شود؟")) return;
    try {
      await apiDelete(`/api/budgets/${id}`);
      mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "حذف بودجه ناموفق بود.");
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => {
          setEditingBudget(null);
          setShowForm((v) => !v);
        }}
        className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
      >
        <PlusIcon className="w-4 h-4" />
        بودجه جدید
      </button>

      {(showForm || editingBudget) && (
        <BudgetForm
          categories={categories}
          existingBudgets={budgets}
          editingBudget={editingBudget}
          onDone={() => {
            setShowForm(false);
            setEditingBudget(null);
            mutate();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditingBudget(null);
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-3">
        {budgets.map((b: any) => {
          const p = progressByCategory.get(b.categoryId);
          const pct = Math.min(100, p?.pct ?? 0);
          const near = p?.isNear ?? false;
          return (
            <Card key={b.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  <span>{b.category?.icon}</span>
                  <p className="font-bold text-ink truncate">{b.category?.name}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setEditingBudget(b);
                    }}
                    aria-label="ویرایش"
                    className="p-1.5 rounded-lg text-muted hover:bg-canvas"
                  >
                    <EditIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(b.id)} aria-label="حذف" className="p-1.5 rounded-lg text-waste hover:bg-canvas">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className={`h-1.5 rounded-full overflow-hidden mt-3 ${near ? "bg-signal-soft" : "bg-canvas"}`} role="img" aria-label="پیشرفت بودجه">
                <div className={`h-full rounded-full ${near ? "bg-signal" : "bg-accent"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className={`text-xs mt-1.5 ${near ? "text-signal" : "text-muted"}`}>
                {format(p?.spent ?? 0, { withSuffix: true })} از {format(b.monthlyCap, { withSuffix: true })}
              </p>
            </Card>
          );
        })}
        {budgets.length === 0 && !showForm && <EmptyState message="هنوز بودجه‌ای تعریف نکرده‌اید." />}
      </div>
    </div>
  );
}

function BudgetForm({
  categories,
  existingBudgets,
  editingBudget,
  onDone,
  onCancel,
}: {
  categories: any[];
  existingBudgets: any[];
  editingBudget: any | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(editingBudget?.categoryId ?? null);
  const [cap, setCap] = useState(editingBudget ? String(editingBudget.monthlyCap) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // A category that already has a budget can't be picked again from scratch — its own card IS
  // that budget, reachable via ویرایش — but the category currently being edited must stay offered.
  const budgetedIds = new Set(existingBudgets.filter((b) => b.id !== editingBudget?.id).map((b) => b.categoryId));
  const pickable = selectableCategories(categories, (c: any) => c.valueType !== "ASSET" && !budgetedIds.has(c.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId || !cap) return;
    setLoading(true);
    setError("");
    try {
      await apiPost("/api/budgets", { categoryId, monthlyCap: Number(cap) });
      notifySaved();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت بودجه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        {editingBudget ? (
          <p className="text-sm text-ink flex items-center gap-1.5">
            <span>{editingBudget.category?.icon}</span>
            {editingBudget.category?.name}
          </p>
        ) : (
          <CategoryChipPicker categories={pickable} selectedId={categoryId} onPick={(c) => setCategoryId(c?.id ?? null)} emptyHint="همهٔ دسته‌های هزینه‌ای قبلاً بودجه گرفته‌اند." />
        )}
        <MoneyInput value={cap} onChange={setCap} placeholder="سقف ماهانه" required />
        {error && <p className="text-xs text-waste">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading || !categoryId} className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40">
            ثبت بودجه
          </button>
          <button type="button" onClick={onCancel} className="px-4 rounded-xl bg-canvas text-muted text-sm">
            انصراف
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * «برای X، Y تومان تا فلان تاریخ» — progress is the linked account's own real, live balance
 * (from useAccounts(), already SWR-cached elsewhere on this page) against the target, never a
 * separately tracked "contributed so far" figure — see the SavingsGoal model's own comment on why
 * the account IS the goal's real money. Reaching the target is stated as a plain fact, not a badge
 * or celebration screen, per the anti-gamification rule (the number itself is the reward).
 */
function SavingsGoalsTab() {
  const { goals, mutate } = useSavingsGoals();
  const { accounts } = useAccounts();
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<any | null>(null);
  const { format } = useCurrencyUnit();

  const balanceByAccount = new Map(accounts.map((a: any) => [a.id, a.balance]));

  async function remove(id: string) {
    if (!confirm("این هدف حذف شود؟")) return;
    try {
      await apiDelete(`/api/savings-goals/${id}`);
      mutate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "حذف هدف ناموفق بود.");
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => {
          setEditingGoal(null);
          setShowForm((v) => !v);
        }}
        className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90"
      >
        <PlusIcon className="w-4 h-4" />
        هدف جدید
      </button>

      {(showForm || editingGoal) && (
        <SavingsGoalForm
          accounts={accounts}
          editingGoal={editingGoal}
          onDone={() => {
            setShowForm(false);
            setEditingGoal(null);
            mutate();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditingGoal(null);
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-3">
        {goals.map((g: any) => {
          const balance = balanceByAccount.get(g.accountId) ?? 0;
          const pct = g.targetAmount > 0 ? Math.min(100, Math.max(0, (balance / g.targetAmount) * 100)) : 0;
          const reached = balance >= g.targetAmount;
          return (
            <Card key={g.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-ink truncate">{g.title}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {g.account?.name}
                    {g.targetDate && ` · تا ${formatJalali(new Date(g.targetDate))}`}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setEditingGoal(g);
                    }}
                    aria-label="ویرایش"
                    className="p-1.5 rounded-lg text-muted hover:bg-canvas"
                  >
                    <EditIcon className="w-4 h-4" />
                  </button>
                  <button onClick={() => remove(g.id)} aria-label="حذف" className="p-1.5 rounded-lg text-waste hover:bg-canvas">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mt-3 bg-canvas">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-muted mt-1.5">
                {format(balance, { withSuffix: true })} از {format(g.targetAmount, { withSuffix: true })}
                {reached && <span className="text-accent font-bold"> — به هدف رسیدی</span>}
              </p>
            </Card>
          );
        })}
        {goals.length === 0 && !showForm && <EmptyState message="هنوز هدفی تعریف نکرده‌اید." />}
      </div>
    </div>
  );
}

function SavingsGoalForm({
  accounts,
  editingGoal,
  onDone,
  onCancel,
}: {
  accounts: any[];
  editingGoal: any | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const oneYearFromNow = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d;
  };
  const [title, setTitle] = useState(editingGoal?.title ?? "");
  const [targetAmount, setTargetAmount] = useState(editingGoal ? String(editingGoal.targetAmount) : "");
  const [accountId, setAccountId] = useState(editingGoal?.accountId ?? "");
  const [targetDate, setTargetDate] = useState(editingGoal?.targetDate ? new Date(editingGoal.targetDate) : oneYearFromNow());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { format } = useCurrencyUnit();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !targetAmount || !accountId) return;
    setLoading(true);
    setError("");
    try {
      const payload = { title: title.trim(), targetAmount: Number(targetAmount), accountId, targetDate: dayKeyIso(targetDate) };
      if (editingGoal) await apiPatch(`/api/savings-goals/${editingGoal.id}`, payload);
      else await apiPost("/api/savings-goals", payload);
      notifySaved();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت هدف ناموفق بود.");
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
          placeholder="عنوان هدف (مثلاً: پیش‌پرداخت خانه)"
          className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput value={targetAmount} onChange={setTargetAmount} placeholder="مبلغ هدف" required />
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
            <option value="">حساب</option>
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name} — {format(a.balance, { withSuffix: true })}
              </option>
            ))}
          </select>
        </div>
        <JalaliDateInput value={targetDate} onChange={setTargetDate} />
        {error && <p className="text-xs text-waste">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
            ثبت هدف
          </button>
          <button type="button" onClick={onCancel} className="px-4 rounded-xl bg-canvas text-muted text-sm">
            انصراف
          </button>
        </div>
      </form>
    </Card>
  );
}
