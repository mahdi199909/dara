"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { formatDuration } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { PlusIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import MoneyInput from "@/components/ui/MoneyInput";
import MilestoneProgressBar from "@/components/MilestoneProgressBar";
import { phraseMilestoneProgress } from "@/lib/phrasing";
import { nextMilestoneMinutes } from "@/lib/milestones";

function MilestoneCaption({ totalMinutes }: { totalMinutes: number }) {
  const next = nextMilestoneMinutes(totalMinutes);
  const nextHours = next !== null ? Math.round(next / 60) : null;
  const remaining = next !== null ? next - totalMinutes : null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-400">{phraseMilestoneProgress(totalMinutes, nextHours, remaining)}</p>
      <MilestoneProgressBar totalMinutes={totalMinutes} nextMilestoneMinutes={next} />
    </div>
  );
}

interface VirtualAssetResponse {
  entries: any[];
  total: number;
  byCategory: { categoryId: string; name: string; icon: string | null; total: number; entries: any[] }[];
  projectEntries: any[];
  habitEntries: any[];
}

export default function AssetsPage() {
  const { data: assetsData, mutate: mutateAssets } = useSWR<{ assets: any[] }>("/api/assets", fetcher);
  const { data: vaData } = useSWR<VirtualAssetResponse>("/api/virtual-assets", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const { format } = useCurrencyUnit();

  const realTotal = assetsData?.assets.reduce((s, a) => s + a.currentValue, 0) ?? 0;
  const virtualTotal = vaData?.total ?? 0;

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-gray-800">دارایی‌ها</h1>

      <div className="grid grid-cols-1 gap-3">
        <Card className="p-4">
          <StatItem label="دارایی واقعی" value={format(realTotal, { withSuffix: true })} />
        </Card>
        <Card className="p-4">
          <StatItem label="دارایی مجازی" value={format(virtualTotal, { withSuffix: true })} tone="positive" />
        </Card>
        <Card className="p-4">
          <StatItem label="مجموع دارایی" value={format(realTotal + virtualTotal, { withSuffix: true })} />
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-700 text-sm">دارایی‌های واقعی</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-xl hover:bg-brand-700"
          >
            <PlusIcon className="w-4 h-4" />
            دارایی جدید
          </button>
        </div>

        {showForm && <NewAssetForm onDone={() => { setShowForm(false); mutateAssets(); }} />}

        <div className="grid grid-cols-1 gap-3">
          {assetsData?.assets.map((a) => (
            <Card key={a.id} className="p-4">
              <p className="font-bold text-gray-800">{a.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{a.category || "—"} · خرید {formatJalali(new Date(a.purchaseDate))}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-400">قیمت خرید: {format(a.purchasePrice, { withSuffix: true })}</span>
                <span className="text-base font-bold text-brand-700">{format(a.currentValue, { withSuffix: true })}</span>
              </div>
            </Card>
          ))}
          {assetsData?.assets.length === 0 && <EmptyState message="هنوز دارایی واقعی ثبت نکرده‌اید." />}
        </div>
      </section>

      {vaData && vaData.habitEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold text-gray-700 text-sm">دارایی دیجیتال از عادت‌ها</h2>
          <p className="text-xs text-gray-400 -mt-2">
            هر بار که یک عادت را تیک می‌زنید، ارزش تعریف‌شده برای آن به دارایی دیجیتال شما اضافه می‌شود.
          </p>
          <Card>
            <ul className="divide-y divide-gray-50">
              {vaData.habitEntries.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-gray-700">{e.habitCheckIn?.habit?.icon} {e.habitCheckIn?.habit?.title}</p>
                    <p className="text-xs text-gray-400">{formatJalali(new Date(e.date))}</p>
                  </div>
                  <span className="text-sm text-gray-600">{format(e.totalValue, { withSuffix: true })}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {vaData && vaData.projectEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold text-gray-700 text-sm">دارایی از پروژه‌های تکمیل‌شده</h2>
          <p className="text-xs text-gray-400 -mt-2">
            با اتمام یک پروژه، هزینه واقعی (مستقیم + زمانی) صرف‌شده روی آن به‌عنوان یک دارایی مجزا ثبت می‌شود.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {vaData.projectEntries.map((e: any) => (
              <Card key={e.id} className="p-4 space-y-2">
                <div>
                  <p className="font-bold text-gray-800">{e.project?.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">تکمیل‌شده در {formatJalali(new Date(e.date))}</p>
                  <p className="text-base font-bold text-brand-700 mt-2">{format(e.totalValue, { withSuffix: true })}</p>
                </div>
                <MilestoneCaption totalMinutes={e.durationMin} />
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-bold text-gray-700 text-sm">دارایی مجازی به تفکیک دسته‌بندی</h2>
        <p className="text-xs text-gray-400 -mt-2">
          دارایی مجازی از کارها و فعالیت‌های مفیدی مثل مطالعه، یادگیری و استراحت بدون تکنولوژی که در دسته‌بندی آن‌ها فعال شده، محاسبه می‌شود. این یک معیار داخلی برای رشد شخصی است، نه پول نقد یا دارایی قابل‌فروش.
        </p>
        {!vaData || vaData.byCategory.length === 0 ? (
          <Card>
            <EmptyState message="هنوز دارایی مجازی ایجاد نشده. برای فعال‌سازی به تنظیمات > دسته‌بندی‌ها بروید." />
          </Card>
        ) : (
          <div className="space-y-2">
            {vaData.byCategory.map((bucket) => (
              <Card key={bucket.categoryId} className="overflow-hidden">
                <button
                  onClick={() => setOpenCategory(openCategory === bucket.categoryId ? null : bucket.categoryId)}
                  className="w-full flex items-center justify-between px-4 py-3"
                >
                  <span className="text-sm text-gray-800 flex items-center gap-2">
                    <span>{bucket.icon}</span>
                    {bucket.name}
                    <span className="text-xs text-gray-400">({bucket.entries.length})</span>
                  </span>
                  <span className="text-sm font-bold text-brand-700">{format(bucket.total, { withSuffix: true })}</span>
                </button>
                <div className="px-4 pb-3">
                  <MilestoneCaption totalMinutes={bucket.entries.reduce((s: number, e: any) => s + e.durationMin, 0)} />
                </div>
                {openCategory === bucket.categoryId && (
                  <ul className="divide-y divide-gray-50 border-t border-gray-50">
                    {bucket.entries.map((e: any) => (
                      <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-sm text-gray-700">{(e.activity ?? e.task)?.title}</p>
                          <p className="text-xs text-gray-400">{formatDuration(e.durationMin)} · {formatJalali(new Date(e.date))}</p>
                        </div>
                        <span className="text-sm text-gray-600">{format(e.totalValue, { withSuffix: true })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NewAssetForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiPost("/api/assets", {
        name,
        category: category || undefined,
        purchasePrice: Number(purchasePrice),
        currentValue: currentValue ? Number(currentValue) : undefined,
      });
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="نام دارایی" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="دسته‌بندی (اختیاری)" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput value={purchasePrice} onChange={setPurchasePrice} placeholder="قیمت خرید" required />
          <MoneyInput value={currentValue} onChange={setCurrentValue} placeholder="ارزش فعلی (اختیاری)" />
        </div>
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-brand-600 text-white py-2 text-sm font-medium disabled:opacity-40">
          ثبت دارایی
        </button>
      </form>
    </Card>
  );
}
