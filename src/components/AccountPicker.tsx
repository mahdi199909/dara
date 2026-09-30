"use client";

import { useAccounts } from "@/lib/hooks";
import { pickDefaultAccount } from "@/lib/defaultAccount";

/**
 * «از کدام حساب؟» — shown next to an amount, so an expense or an income lands in the account it really
 * moved through. The default account (Finance → حساب‌ها) is already picked; a tap changes it for this one
 * entry only. Nothing is shown to someone with a single account: there is nothing to ask.
 *
 * `value` null means "the default" — the caller can send it as is (the server falls back the same way).
 */
export default function AccountPicker({
  value,
  onChange,
  flow,
}: {
  value: string | null;
  onChange: (accountId: string) => void;
  flow: "COST" | "INCOME";
}) {
  const { accounts } = useAccounts();
  const active = accounts.filter((a: any) => a.isActive);
  if (active.length < 2) return null;

  const selectedId = value ?? pickDefaultAccount(active)?.id ?? null;

  return (
    <div>
      <p className="text-xs text-muted mb-1.5">{flow === "COST" ? "از کدام حساب پرداخت شد؟" : "به کدام حساب واریز شد؟"}</p>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-thin pb-0.5" role="radiogroup" aria-label="حساب">
        {active.map((a: any) => {
          const selected = a.id === selectedId;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(a.id)}
              className={`shrink-0 text-sm px-3 py-1.5 rounded-full border transition ${
                selected ? "border-accent bg-accent-soft text-accent font-medium" : "border-line bg-surface text-ink hover:border-accent"
              }`}
            >
              {a.name}
              {!!a.isDefault && <span className="text-xs text-muted mr-1.5">پیش‌فرض</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
