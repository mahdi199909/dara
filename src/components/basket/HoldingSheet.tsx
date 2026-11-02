"use client";

import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "@/lib/apiClient";
import Sheet from "@/components/ui/Sheet";
import { BASKET_ASSETS, BASKET_KIND_LABELS, basketAssetById, type BasketKind } from "@/lib/basketCatalog";
import { formatQuantity, parseQuantityInput, type BasketLine } from "@/lib/basket";
import type { BasketHoldingDto } from "@/lib/schemas/basket";

const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
const KINDS: BasketKind[] = ["CURRENCY", "METAL"];

/**
 * Adds an asset to the basket, or changes / removes one that is there. An asset is picked from the catalog, then
 * the person says how many they hold (dollars, grams, coins). Editing a line that two devices had each added
 * leaves one row holding the total and removes the other(s) — the basket never keeps duplicates once it is touched.
 */
export default function HoldingSheet({
  takenAssetIds,
  line,
  holding,
  onClose,
  onSaved,
}: {
  /** Assets already in the basket (they cannot be added twice). */
  takenAssetIds: string[];
  /** Set to edit this line; left out to add a new asset. */
  line?: BasketLine;
  /** The row behind the line (the first of its holdings), for its note. */
  holding?: BasketHoldingDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [assetId, setAssetId] = useState<string | null>(line?.asset.id ?? null);
  const [quantityText, setQuantityText] = useState(line ? String(line.quantity) : "");
  const [note, setNote] = useState(holding?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asset = assetId ? basketAssetById(assetId) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!asset) return setError("یک دارایی را انتخاب کنید.");
    const quantity = parseQuantityInput(quantityText);
    if (quantity === null) return setError(`مقدار را به‌صورت یک عدد بزرگ‌تر از صفر بنویسید؛ مثلاً ${asset.unit === "گرم" ? "۱۲.۵" : "۱۰۰"}.`);

    setSaving(true);
    try {
      if (line) {
        const [primary, ...duplicates] = line.holdingIds;
        await apiPatch(`/api/basket/${primary}`, { quantity, note: note.trim() || null });
        for (const id of duplicates) await apiDelete(`/api/basket/${id}`);
      } else {
        await apiPost("/api/basket", { assetKey: asset.id, quantity, note: note.trim() || null });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!line) return;
    setSaving(true);
    setError(null);
    try {
      for (const id of line.holdingIds) await apiDelete(`/api/basket/${id}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حذف انجام نشد.");
      setSaving(false);
    }
  }

  return (
    <Sheet title={line ? `ویرایش ${line.asset.name}` : "افزودن به سبد دارایی"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!line && (
          <div className="space-y-3">
            {KINDS.map((kind) => (
              <div key={kind}>
                <p className="text-xs text-muted mb-1.5">{BASKET_KIND_LABELS[kind]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {BASKET_ASSETS.filter((a) => a.kind === kind).map((a) => {
                    const taken = takenAssetIds.includes(a.id);
                    const picked = assetId === a.id;
                    return (
                      <button
                        type="button"
                        key={a.id}
                        disabled={taken}
                        onClick={() => setAssetId(a.id)}
                        title={taken ? "از قبل در سبد هست" : undefined}
                        className={`text-xs rounded-xl border px-3 py-2 transition ${
                          picked ? "border-accent bg-accent-soft text-accent font-medium" : taken ? "border-line text-muted opacity-50" : "border-line text-ink hover:bg-canvas"
                        }`}
                      >
                        {a.icon} {a.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {asset && (
          <>
            <div>
              <label className="text-xs text-muted mb-1.5 block">
                {asset.icon} {asset.name} — چند {asset.unit} داری؟
              </label>
              <input
                autoFocus
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                placeholder={asset.unit === "گرم" ? "12.5" : "100"}
                className={`${inputClass} text-right`}
                aria-label="مقدار"
              />
              {line && line.holdingIds.length > 1 && (
                <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                  این دارایی روی دو دستگاه جدا ثبت شده بود؛ مجموع آن ({formatQuantity(line.quantity)} {asset.unit}) اینجا آمده و با ذخیره، یکی می‌شود.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted mb-1.5 block">یادداشت (اختیاری)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="مثلاً: نزد صرافی، گردنبند" className={inputClass} />
            </div>
          </>
        )}

        {error && <p className="text-xs text-waste">{error}</p>}

        <div className="flex gap-2">
          {line && (
            <button
              type="button"
              disabled={saving}
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
              className="rounded-xl border border-line px-4 py-2.5 text-sm text-waste disabled:opacity-40"
            >
              {confirmDelete ? "مطمئنی؟ حذف" : "حذف از سبد"}
            </button>
          )}
          <button type="submit" disabled={saving || !asset} className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
            {saving ? "در حال ذخیره..." : line ? "ذخیره" : "افزودن"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
