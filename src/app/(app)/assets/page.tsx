"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { formatDuration } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { PlusIcon, EditIcon, TrashIcon } from "@/components/icons";
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
      <p className="text-xs text-muted">{phraseMilestoneProgress(totalMinutes, nextHours, remaining)}</p>
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
  const { data: vaData, mutate: mutateVa } = useSWR<VirtualAssetResponse>("/api/virtual-assets", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const { format } = useCurrencyUnit();

  const realTotal = assetsData?.assets.reduce((s, a) => s + a.currentValue, 0) ?? 0;
  const virtualTotal = vaData?.total ?? 0;

  async function deleteAsset(id: string) {
    await apiDelete(`/api/assets/${id}`);
    mutateAssets();
  }

  async function deleteVirtualEntry(id: string) {
    await apiDelete(`/api/virtual-assets/${id}`);
    mutateVa();
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-ink">دارایی‌ها</h1>

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
          <h2 className="font-bold text-ink text-sm">دارایی‌های واقعی</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-1.5 rounded-xl hover:opacity-90"
          >
            <PlusIcon className="w-4 h-4" />
            دارایی جدید
          </button>
        </div>

        {showForm && <AssetForm onDone={() => { setShowForm(false); mutateAssets(); }} onCancel={() => setShowForm(false)} />}

        <div className="grid grid-cols-1 gap-3">
          {assetsData?.assets.map((a) =>
            editingAssetId === a.id ? (
              <AssetForm
                key={a.id}
                asset={a}
                onDone={() => { setEditingAssetId(null); mutateAssets(); }}
                onCancel={() => setEditingAssetId(null)}
              />
            ) : (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{a.name}</p>
                    <p className="text-xs text-muted mt-0.5">{a.category || "—"} · خرید {formatJalali(new Date(a.purchaseDate))}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditingAssetId(a.id)} aria-label="ویرایش" className="p-1.5 text-muted hover:text-accent transition">
                      <EditIcon className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteAsset(a.id)} aria-label="حذف" className="p-1.5 text-muted hover:text-waste transition">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted">قیمت خرید: {format(a.purchasePrice, { withSuffix: true })}</span>
                  <span className="text-base font-bold text-accent">{format(a.currentValue, { withSuffix: true })}</span>
                </div>
              </Card>
            )
          )}
          {assetsData?.assets.length === 0 && <EmptyState message="هنوز دارایی واقعی ثبت نکرده‌اید." />}
        </div>
      </section>

      {vaData && vaData.habitEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold text-ink text-sm">دارایی دیجیتال از عادت‌ها</h2>
          <p className="text-xs text-muted -mt-2">
            هر بار که یک عادت را تیک می‌زنید، ارزش تعریف‌شده برای آن به دارایی دیجیتال شما اضافه می‌شود.
          </p>
          <Card>
            <ul className="divide-y divide-line">
              {vaData.habitEntries.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-ink">{e.habitCheckIn?.habit?.icon} {e.habitCheckIn?.habit?.title}</p>
                    <p className="text-xs text-muted">{formatJalali(new Date(e.date))}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink">{format(e.totalValue, { withSuffix: true })}</span>
                    <button onClick={() => deleteVirtualEntry(e.id)} aria-label="حذف" className="p-1 text-muted hover:text-waste transition">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {vaData && vaData.projectEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold text-ink text-sm">دارایی از پروژه‌های تکمیل‌شده</h2>
          <p className="text-xs text-muted -mt-2">
            با اتمام یک پروژه، هزینه واقعی (مستقیم + زمانی) صرف‌شده روی آن به‌عنوان یک دارایی مجزا ثبت می‌شود.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {vaData.projectEntries.map((e: any) => (
              <Card key={e.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{e.project?.name}</p>
                    <p className="text-xs text-muted mt-0.5">تکمیل‌شده در {formatJalali(new Date(e.date))}</p>
                    <p className="text-base font-bold text-accent mt-2">{format(e.totalValue, { withSuffix: true })}</p>
                  </div>
                  <button onClick={() => deleteVirtualEntry(e.id)} aria-label="حذف" className="p-1.5 text-muted hover:text-waste transition shrink-0">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
                <MilestoneCaption totalMinutes={e.durationMin} />
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-bold text-ink text-sm">دارایی مجازی به تفکیک دسته‌بندی</h2>
        <p className="text-xs text-muted -mt-2">
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
                  <span className="text-sm text-ink flex items-center gap-2">
                    <span>{bucket.icon}</span>
                    {bucket.name}
                    <span className="text-xs text-muted">({bucket.entries.length})</span>
                  </span>
                  <span className="text-sm font-bold text-accent">{format(bucket.total, { withSuffix: true })}</span>
                </button>
                <div className="px-4 pb-3">
                  <MilestoneCaption totalMinutes={bucket.entries.reduce((s: number, e: any) => s + e.durationMin, 0)} />
                </div>
                {openCategory === bucket.categoryId && (
                  <ul className="divide-y divide-line border-t border-line">
                    {bucket.entries.map((e: any) => (
                      <li key={e.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <p className="text-sm text-ink">{(e.activity ?? e.task)?.title}</p>
                          <p className="text-xs text-muted">{formatDuration(e.durationMin)} · {formatJalali(new Date(e.date))}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-ink">{format(e.totalValue, { withSuffix: true })}</span>
                          <button onClick={() => deleteVirtualEntry(e.id)} aria-label="حذف" className="p-1 text-muted hover:text-waste transition">
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
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

function AssetForm({ asset, onDone, onCancel }: { asset?: any; onDone: () => void; onCancel: () => void }) {
  const isEdit = !!asset;
  const [name, setName] = useState(asset?.name ?? "");
  const [category, setCategory] = useState(asset?.category ?? "");
  const [purchasePrice, setPurchasePrice] = useState(asset ? String(asset.purchasePrice) : "");
  const [currentValue, setCurrentValue] = useState(asset ? String(asset.currentValue) : "");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEdit) {
        await apiPatch(`/api/assets/${asset.id}`, {
          name,
          category: category || null,
          currentValue: currentValue ? Number(currentValue) : undefined,
        });
      } else {
        await apiPost("/api/assets", {
          name,
          category: category || undefined,
          purchasePrice: Number(purchasePrice),
          currentValue: currentValue ? Number(currentValue) : undefined,
        });
      }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="نام دارایی" className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="دسته‌بندی (اختیاری)" className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <MoneyInput value={purchasePrice} onChange={setPurchasePrice} placeholder="قیمت خرید" required disabled={isEdit} />
          <MoneyInput value={currentValue} onChange={setCurrentValue} placeholder="ارزش فعلی (اختیاری)" />
        </div>
        <div className="flex gap-2">
          {isEdit && (
            <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-line text-muted py-2 text-sm hover:bg-canvas">
              انصراف
            </button>
          )}
          <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
            {loading ? "در حال ثبت..." : isEdit ? "ذخیره تغییرات" : "ثبت دارایی"}
          </button>
        </div>
      </form>
    </Card>
  );
}
