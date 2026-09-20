"use client";

import { useEffect, useState } from "react";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { useCategories } from "@/lib/hooks";
import { PlusIcon } from "@/components/icons";

export interface ChipCategory {
  id: string;
  name: string;
  icon?: string | null;
  isActive?: boolean;
  parentCategoryId?: string | null;
  projectId?: string | null;
  valueType?: string;
}

/**
 * The categories worth offering as chips: active ones (optionally narrowed by `filter`), one per
 * name — a double-submitted "new category" must not show up twice — first seen wins, in the order
 * they arrive.
 */
export function selectableCategories<T extends ChipCategory>(categories: T[], filter?: (c: T) => boolean): T[] {
  const seenNames = new Set<string>();
  return categories
    .filter((c) => c.isActive && (!filter || filter(c)))
    .filter((c) => {
      if (seenNames.has(c.name)) return false;
      seenNames.add(c.name);
      return true;
    });
}

/**
 * Category picker shared by Quick Capture and the Tasks page: one horizontally scrolling row of
 * chips, a second row of sub-categories under a tapped parent, and a dashed "new category" chip
 * that opens an inline name field — so a category can be made in passing without leaving the form.
 *
 * `categories` is expected to be already narrowed with selectableCategories(). A parent category
 * is itself a usable choice: tapping it selects it AND reveals its sub-categories; tapping one of
 * those then overrides the selection. With `allowClear`, tapping the selected chip again clears it
 * (for forms where a category is optional).
 */
export default function CategoryChipPicker<T extends ChipCategory>({
  categories,
  selectedId,
  onPick,
  allowClear = false,
  emptyHint,
}: {
  categories: T[];
  selectedId: string | null;
  onPick: (category: T | null) => void;
  allowClear?: boolean;
  /** Shown when there is nothing to pick and the inline "new category" field is closed. */
  emptyHint?: string;
}) {
  const { mutate: mutateCategories } = useCategories();
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const topLevel = categories.filter((c) => !c.parentCategoryId);
  const subCategories = expandedParentId ? categories.filter((c) => c.parentCategoryId === expandedParentId) : [];

  // An expanded sub-category row left over from a change to the list (e.g. Quick Capture's
  // expense/asset tab) must not linger once its parent is gone.
  useEffect(() => {
    if (expandedParentId && !categories.some((c) => c.id === expandedParentId)) setExpandedParentId(null);
  }, [categories, expandedParentId]);

  function pickTopLevel(cat: T) {
    if (allowClear && selectedId === cat.id) {
      onPick(null);
      setExpandedParentId(null);
      return;
    }
    onPick(cat);
    setExpandedParentId(categories.some((c) => c.parentCategoryId === cat.id) ? cat.id : null);
  }

  function pickSub(cat: T) {
    if (allowClear && selectedId === cat.id) {
      // Back up to the parent, which is still a valid choice on its own.
      const parent = categories.find((c) => c.id === cat.parentCategoryId);
      onPick(parent ?? null);
      return;
    }
    onPick(cat);
  }

  async function createInline() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setError(null);
    try {
      // Defaults to EXPENSE and a generic tag icon — a category made in passing isn't worth
      // interrupting the form with the full kind/icon/colour setup; it can be configured fully
      // afterwards in تنظیمات ← دسته‌بندی‌ها.
      const { category } = await apiPost<{ category: T }>("/api/categories", { name: trimmed, valueType: "EXPENSE", icon: "🏷️" });
      await mutateCategories();
      onPick(category);
      setNewName("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ساخت دسته‌بندی انجام نشد.");
    }
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
        {topLevel.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => pickTopLevel(c)}
            aria-pressed={selectedId === c.id}
            className={`shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition ${
              selectedId === c.id || expandedParentId === c.id ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"
            }`}
          >
            <span>{c.icon}</span>
            {c.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="shrink-0 flex items-center gap-1 text-sm px-3 py-1.5 rounded-full border border-dashed border-line text-muted hover:border-accent hover:text-accent transition"
        >
          <PlusIcon className="w-3.5 h-3.5" />
          دسته‌بندی جدید
        </button>
      </div>
      {subCategories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1 mt-1.5 pr-3 border-r-2 border-line">
          {subCategories.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => pickSub(c)}
              aria-pressed={selectedId === c.id}
              className={`shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition ${
                selectedId === c.id ? "bg-accent-soft text-accent border-accent" : "bg-canvas text-muted border-line"
              }`}
            >
              <span>{c.icon}</span>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {categories.length === 0 && !adding && emptyHint && <p className="text-xs text-muted mt-1">{emptyHint}</p>}
      {adding && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createInline();
                }
              }}
              placeholder="نام دسته‌بندی جدید"
              className="bg-surface flex-1 rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <button type="button" onClick={() => void createInline()} className="shrink-0 rounded-xl bg-accent text-on-accent px-3 py-2 text-xs font-medium">
              ثبت
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewName("");
                setError(null);
              }}
              className="shrink-0 text-xs text-muted px-1"
            >
              انصراف
            </button>
          </div>
          <p className="text-[11px] text-muted">به‌صورت پیش‌فرض «هزینه» ثبت می‌شود — تنظیمات کامل‌تر از تنظیمات ← دسته‌بندی‌ها.</p>
          {error && <p className="text-xs text-waste">{error}</p>}
        </div>
      )}
    </div>
  );
}
