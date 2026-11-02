"use client";

import { useState } from "react";
import { mutate as mutateGlobal } from "swr";
import { apiPost } from "@/lib/apiClient";
import MoneyInput from "@/components/ui/MoneyInput";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "@/lib/types";

export interface CreatedAccount {
  id: string;
  name: string;
}

/**
 * A new account made right where it is needed — under the account choice of a task, an event or a
 * transaction — so someone who has none yet does not have to leave the form to go and make one. It is the
 * same account Finance → حساب‌ها makes (name, kind, starting balance), and it is a bank account unless
 * said otherwise. It sits inside the caller's own <form>, so it is not a form itself (a nested one is invalid
 * HTML, and Enter in the name field must add the account, not submit the entry around it).
 */
export default function AddAccountForm({ onCreated, onCancel }: { onCreated: (account: CreatedAccount) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("BANK_ACCOUNT");
  const [balance, setBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (saving) return;
    if (!name.trim()) {
      setError("نام حساب را بنویس؛ مثلاً بانک ملی.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { account } = await apiPost<{ account: CreatedAccount }>("/api/accounts", {
        name: name.trim(),
        type,
        initialBalance: balance ? Number(balance) : 0,
      });
      // Every list of accounts on screen (Finance, the other pickers) learns of it.
      await mutateGlobal("/api/accounts");
      onCreated(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ساخت حساب انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-canvas p-3 space-y-2">
      <p className="text-xs font-medium text-ink">حساب جدید</p>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void add();
          }
        }}
        placeholder="نام حساب؛ مثلاً بانک ملی"
        maxLength={100}
        aria-label="نام حساب"
        className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
          aria-label="نوع حساب"
          className="bg-surface rounded-xl border border-line px-2 py-2 text-sm"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <MoneyInput value={balance} onChange={setBalance} placeholder="موجودی اولیه (اختیاری)" />
      </div>
      {error && <p className="text-xs text-waste">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-line px-3 py-2 text-sm text-muted disabled:opacity-40">
          انصراف
        </button>
        <button type="button" onClick={() => void add()} disabled={saving} className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
          {saving ? "در حال ساخت..." : "افزودن حساب"}
        </button>
      </div>
    </div>
  );
}
