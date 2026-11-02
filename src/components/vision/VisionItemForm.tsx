"use client";

import { useState } from "react";
import { apiPatch, apiPost } from "@/lib/apiClient";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import Sheet from "@/components/ui/Sheet";
import { VISION_COLORS, VISION_MODES, VISION_MODE_LABELS, type VisionItemDto, type VisionMode } from "@/lib/schemas/vision";
import { formatVisionValue, parseVisionNumber } from "@/lib/visionFormat";

const QUICK_ICONS = ["🎯", "💰", "🏠", "💪", "📚", "✈️", "🌱", "💼", "❤️", "⭐"];
const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";

const MODE_HELP: Record<VisionMode, string> = {
  ADD: "هر ثبتی به مجموع اضافه می‌شود — مثل گرم طلایی که می‌خری یا صفحه‌هایی که می‌خوانی.",
  SET: "آخرین مقدار ثبت‌شده همان وضعیت فعلی است — مثل وزن یا موجودی حساب.",
};

/**
 * Makes a vision or a goal, or edits one. A vision can be plain words; a goal usually carries the
 * person's own yardstick — a unit ("گرم طلا"), where it starts and where it should end.
 */
export default function VisionItemForm({
  parentId,
  item,
  onClose,
  onSaved,
}: {
  /** Set to make a goal under this vision; left out for a vision. */
  parentId?: string;
  /** Set to edit an existing one. */
  item?: VisionItemDto;
  onClose: () => void;
  onSaved: (item: VisionItemDto) => void;
}) {
  const isGoal = Boolean(item ? item.parentId : parentId);
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [icon, setIcon] = useState(item?.icon ?? (isGoal ? "" : "🎯"));
  const [color, setColor] = useState(item?.color ?? VISION_COLORS[0]);
  const [hasMetric, setHasMetric] = useState(item ? item.targetValue !== null : isGoal);
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [startText, setStartText] = useState(item ? String(item.startValue) : "0");
  const [targetText, setTargetText] = useState(item?.targetValue !== null && item?.targetValue !== undefined ? String(item.targetValue) : "");
  const [mode, setMode] = useState<VisionMode>(item?.mode ?? "ADD");
  const [targetDate, setTargetDate] = useState<Date | null>(item?.targetDate ? new Date(item.targetDate) : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("عنوان را بنویسید.");
      return;
    }

    let start = 0;
    let target: number | null = null;
    if (hasMetric) {
      const parsedStart = parseVisionNumber(startText || "0");
      const parsedTarget = parseVisionNumber(targetText);
      if (parsedStart === null) return setError("عدد شروع را درست بنویسید.");
      if (parsedTarget === null) return setError("عددِ هدف را بنویسید؛ مثلاً ۱۰.");
      start = parsedStart;
      target = parsedTarget;
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      icon: icon.trim() || null,
      color,
      unit: hasMetric ? unit.trim() || null : null,
      startValue: hasMetric ? start : 0,
      targetValue: hasMetric ? target : null,
      mode,
      targetDate: targetDate ? targetDate.toISOString() : null,
    };

    setSaving(true);
    try {
      const saved = item
        ? ((await apiPatch<{ item: VisionItemDto }>(`/api/vision/${item.id}`, payload)).item)
        : ((await apiPost<{ item: VisionItemDto }>("/api/vision", { ...payload, ...(parentId ? { parentId } : {}) })).item);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={item ? (isGoal ? "ویرایش هدف" : "ویرایش ویژن") : isGoal ? "هدف جدید" : "ویژن جدید"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-xs text-muted mb-1.5 block">{isGoal ? "هدف" : "ویژن"}</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isGoal ? "مثلاً: خرید ۱۰ گرم طلا" : "مثلاً: آزادی مالی"}
            maxLength={120}
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-xs text-muted mb-1.5 block">چرا برایت مهم است؟ (اختیاری)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} className={`${inputClass} leading-relaxed`} />
        </div>

        <div>
          <p className="text-xs text-muted mb-1.5">نشانه و رنگ</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_ICONS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setIcon(icon === emoji ? "" : emoji)}
                aria-pressed={icon === emoji}
                className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center border transition ${icon === emoji ? "border-accent bg-accent-soft" : "border-line bg-canvas"}`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {VISION_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                aria-label={`رنگ ${c}`}
                aria-pressed={color === c}
                className={`w-7 h-7 rounded-full border-2 transition ${color === c ? "border-ink scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-canvas p-3 space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-sm text-ink">متر و معیار دارم</span>
            <input type="checkbox" checked={hasMetric} onChange={(e) => setHasMetric(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          </label>
          {!hasMetric && <p className="text-xs text-muted leading-relaxed">{isGoal ? "بدون عدد، فقط یک هدف نوشته‌شده است." : "یک ویژن می‌تواند فقط جمله باشد؛ پیشرفتش از هدف‌ها و پروژه‌های زیرش می‌آید."}</p>}

          {hasMetric && (
            <>
              <div>
                <label className="text-xs text-muted mb-1.5 block">با چه چیزی اندازه می‌گیری؟ (واحد)</label>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="گرم طلا، صفحه، کیلومتر، میلیون تومان..." maxLength={40} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted mb-1.5 block">از (شروع)</label>
                  <input dir="ltr" inputMode="decimal" value={startText} onChange={(e) => setStartText(e.target.value)} className={`${inputClass} text-right`} />
                </div>
                <div>
                  <label className="text-xs text-muted mb-1.5 block">تا (هدف)</label>
                  <input dir="ltr" inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="۱۰" className={`${inputClass} text-right`} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted mb-1.5">ثبت‌ها چطور خوانده شوند؟</p>
                <div className="flex gap-2">
                  {VISION_MODES.map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      className={`flex-1 text-xs py-2 rounded-xl border transition ${mode === m ? "bg-accent text-on-accent border-accent" : "bg-surface text-muted border-line"}`}
                    >
                      {VISION_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted mt-1.5 leading-relaxed">{MODE_HELP[mode]}</p>
              </div>
            </>
          )}
        </div>

        <div>
          <label className="text-xs text-muted mb-1.5 block">تاریخِ هدف (اختیاری)</label>
          {targetDate ? (
            <div className="relative">
              <JalaliDateInput value={targetDate} onChange={setTargetDate} className="pl-8" />
              <button type="button" onClick={() => setTargetDate(null)} aria-label="حذف تاریخ" className="absolute left-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-sm w-5 h-5">
                ×
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setTargetDate(new Date())} className="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted hover:text-ink">
              + تعیین تاریخ
            </button>
          )}
        </div>

        {error && <p className="text-sm text-waste">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40">
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl bg-canvas text-ink px-4 py-2.5 text-sm">
            انصراف
          </button>
        </div>
        {item && item.targetValue !== null && hasMetric && (
          <p className="text-[11px] text-muted">اگر عدد شروع یا هدف را عوض کنی، درصد پیشرفت همین حالا با عددهای تازه حساب می‌شود (از {formatVisionValue(Number(startText) || 0)} تا {formatVisionValue(Number(targetText) || 0)}).</p>
        )}
      </form>
    </Sheet>
  );
}
