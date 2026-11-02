"use client";

import { useState } from "react";
import { useAccounts } from "@/lib/hooks";
import { pickDefaultAccount } from "@/lib/defaultAccount";
import AddAccountForm from "@/components/AddAccountForm";

/**
 * «از کدام حساب؟» — shown next to an amount, so an expense or an income lands in the account it really
 * moved through. The default account (Finance → حساب‌ها) is already picked; a tap changes it for this one
 * entry only. The last choice is always «+ افزودن حساب»: someone with no account yet makes their first
 * one right here (until they do, the amount is booked to a cash account «صندوق», which the app makes on
 * the spot), and later ones can be added the same way or from Finance → حساب‌ها.
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
  const [adding, setAdding] = useState(false);
  const active = accounts.filter((a: any) => a.isActive);

  const selectedId = value ?? pickDefaultAccount(active)?.id ?? null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{flow === "COST" ? "از کدام حساب پرداخت شد؟" : "به کدام حساب واریز شد؟"}</p>
      {active.length === 0 && !adding && (
        <p className="text-[11px] text-muted leading-relaxed">هنوز حسابی نداری. بدون حساب، این مبلغ در «صندوق» (حساب نقدی) ثبت می‌شود.</p>
      )}
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
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 text-sm px-3 py-1.5 rounded-full border border-dashed border-accent text-accent hover:bg-accent-soft transition"
          >
            + افزودن حساب
          </button>
        )}
      </div>
      {adding && (
        <AddAccountForm
          onCancel={() => setAdding(false)}
          onCreated={(account) => {
            setAdding(false);
            onChange(account.id);
          }}
        />
      )}
    </div>
  );
}
