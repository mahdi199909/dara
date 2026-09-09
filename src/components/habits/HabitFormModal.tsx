"use client";

import { useState } from "react";
import { apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { useCategories } from "@/lib/hooks";
import MoneyInput from "@/components/ui/MoneyInput";
import { XIcon, TrashIcon } from "@/components/icons";

export default function HabitFormModal({
  habit,
  onClose,
  onSaved,
  onDeleted,
}: {
  habit?: any;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const { categories: allCategories } = useCategories();
  const isEdit = !!habit;

  // Defends against duplicate rows sharing a name (e.g. a double-submitted "new category")
  // showing up twice in this picker — first-seen wins, same order the list already comes in.
  const seenNames = new Set<string>();
  const categories = allCategories.filter((c: any) => {
    if (seenNames.has(c.name)) return false;
    seenNames.add(c.name);
    return true;
  });

  const [title, setTitle] = useState(habit?.title ?? "");
  const [icon, setIcon] = useState(habit?.icon ?? "");
  const [categoryId, setCategoryId] = useState(habit?.categoryId ?? "");
  const [virtualAssetValue, setVirtualAssetValue] = useState(
    habit?.virtualAssetValuePerCheckIn ? String(habit.virtualAssetValuePerCheckIn) : ""
  );
  const [isActive, setIsActive] = useState(habit?.isActive ?? true);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        title,
        icon: icon || (isEdit ? null : undefined),
        categoryId: categoryId || (isEdit ? null : undefined),
        virtualAssetValuePerCheckIn: virtualAssetValue ? Number(virtualAssetValue) : 0,
        ...(isEdit ? { isActive } : {}),
      };

      if (isEdit) {
        await apiPatch(`/api/habits/${habit.id}`, payload);
      } else {
        await apiPost("/api/habits", payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? "ثبت انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!habit) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/habits/${habit.id}`);
      onDeleted?.();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
      <div className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-bold text-ink">{isEdit ? "ویرایش عادت" : "ساخت عادت"}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div className="grid grid-cols-[3.5rem_1fr] gap-2">
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="🙂"
              className="bg-surface rounded-xl border border-line px-2 py-2.5 text-sm text-center"
            />
            <input
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان عادت (مثلاً مطالعه روزانه)"
              className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
            />
          </div>

          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm"
          >
            <option value="">دسته‌بندی (اختیاری)</option>
            {categories.filter((c: any) => c.isActive).map((c: any) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>

          <div>
            <MoneyInput value={virtualAssetValue} onChange={setVirtualAssetValue} placeholder="ارزش دارایی دیجیتال به‌ازای هر روز" />
            <p className="text-xs text-muted mt-1">هر روز که این عادت را تیک بزنید، این مبلغ به دارایی دیجیتال شما اضافه می‌شود.</p>
          </div>

          {isEdit && (
            <label className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2.5">
              <span className="text-sm text-ink">عادت فعال است</span>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 accent-accent" />
            </label>
          )}

          {error && <p className="text-sm text-waste">{error}</p>}

          <div className="flex gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 rounded-xl border border-waste-200 text-waste hover:bg-waste-50 transition disabled:opacity-40"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40">
              {loading ? "در حال ثبت..." : isEdit ? "ذخیره تغییرات" : "ساخت عادت"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
