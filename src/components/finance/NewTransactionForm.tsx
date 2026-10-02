"use client";

import { useState } from "react";
import { apiPost } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import MoneyInput from "@/components/ui/MoneyInput";
import { notifySaved } from "@/lib/savedToast";

/** The finance page's "new transaction" form — also opened by the inbox's «انتقال به تراکنش». */
export default function NewTransactionForm({
  categories,
  accounts,
  onDone,
  initialDescription,
}: {
  categories: any[];
  accounts: any[];
  onDone: () => void;
  /** Pre-fills the description (an inbox item being turned into a transaction). */
  initialDescription?: string;
}) {
  const [type, setType] = useState<"INCOME" | "EXPENSE" | "TRANSFER">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState(initialDescription ?? "");
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
