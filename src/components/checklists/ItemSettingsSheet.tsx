"use client";

import { useMemo, useState } from "react";
import { apiDelete, apiPatch, apiPost } from "@/lib/apiClient";
import { DEP_LABELS, DEP_TYPES, dependencyCandidates, lagLabel, type DepType } from "@/lib/checklistSchedule";
import { buildTree, type TreeNode } from "@/lib/checklistTree";
import { CHECKLIST_NOTE_MAX_LENGTH, CHECKLIST_TITLE_MAX_LENGTH, type ChecklistItemDto } from "@/lib/schemas/checklists";
import type { InboxDestination } from "@/lib/schemas/inbox";
import { formatDuration, toPersianDigits } from "@/lib/money";
import { formatJalali } from "@/lib/jalali";
import { DestinationForm, DestinationSheet, Sheet } from "@/components/convert/ConvertSheet";

const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";

export const DURATION_PRESETS = [15, 30, 60, 120, 240, 480];
const LAG_PRESETS = [0, 60, 24 * 60, 2 * 24 * 60, 7 * 24 * 60];

export const LINK_LABELS: Record<string, string> = {
  TASK: "کار",
  EVENT: "رویداد",
  TRANSACTION: "تراکنش",
  INSTALLMENT: "قسط",
  HABIT: "عادت",
  NOTE: "نوت روز",
  AUTO: "ثبت هوشمند",
};

const ITEM_DESTINATIONS: InboxDestination[] = ["AUTO", "TASK", "EVENT", "TRANSACTION", "INSTALLMENT", "HABIT", "NOTE"];

/** The next quarter hour from now — where a single step lands when turned into a task or event. */
function nextQuarter(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15);
  return d;
}

/** "سالن › تماس" — an item's place in its list, for the rule's dropdown. */
function pathLabel(items: ChecklistItemDto[], id: string, rootId: string): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  for (let cur = byId.get(id); cur && cur.id !== rootId; cur = cur.parentId ? byId.get(cur.parentId) : undefined) parts.unshift(cur.title);
  return parts.join(" › ");
}

/**
 * Everything about one checklist item, opened by tapping it: its title and note, and — optional — how long
 * it takes and when it happens relative to another item of the same list («بعد از / قبل از / هم‌زمان با
 * شروع» + a gap). From here it can also be turned into a task, event, transaction… (timed by its duration),
 * moved, cleared («از نو») or deleted.
 */
export default function ItemSettingsSheet({
  item,
  items,
  rootId,
  hasChildren,
  isFirst,
  isLast,
  onClose,
  onChanged,
}: {
  item: ChecklistItemDto;
  items: ChecklistItemDto[];
  rootId: string;
  hasChildren: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note ?? "");
  const [duration, setDuration] = useState<number | null>(item.durationMin);
  const [customDuration, setCustomDuration] = useState(item.durationMin && !DURATION_PRESETS.includes(item.durationMin) ? String(item.durationMin) : "");
  const [depType, setDepType] = useState<string>(item.depType ?? "");
  const [depItemId, setDepItemId] = useState<string>(item.depItemId ?? "");
  const [lagMin, setLagMin] = useState<number>(item.lagMin ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<InboxDestination | "PICK" | null>(null);

  // In list order (depth first), the way the person sees the list.
  const candidates = useMemo(() => {
    const allowed = new Set(dependencyCandidates(items, rootId, item.id).map((c) => c.id));
    const ordered: ChecklistItemDto[] = [];
    const walk = (nodes: TreeNode<ChecklistItemDto>[]) => nodes.forEach((n) => (allowed.has(n.item.id) && ordered.push(n.item), walk(n.children)));
    const root = buildTree(items).find((n) => n.item.id === rootId);
    if (root) walk(root.children);
    return ordered;
  }, [items, rootId, item.id]);
  const dirty =
    title.trim() !== item.title ||
    (note.trim() || null) !== (item.note || null) ||
    duration !== item.durationMin ||
    (depType || null) !== (item.depType || null) ||
    (depItemId || null) !== (item.depItemId || null) ||
    lagMin !== (item.lagMin ?? 0);

  async function act(action: () => Promise<unknown>, fallback: string, close = true) {
    setSaving(true);
    setError(null);
    try {
      await action();
      await onChanged();
      if (close) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (!title.trim()) return;
    const rule = depType && depItemId ? { depType, depItemId } : { depType: null, depItemId: null };
    void act(() => apiPatch(`/api/checklists/${item.id}`, { title, note: note.trim() || null, durationMin: hasChildren ? null : duration, ...rule, lagMin: depType ? lagMin : 0 }), "ذخیره انجام نشد.");
  }

  if (converting && converting !== "PICK") {
    const start = nextQuarter();
    const end = duration ? new Date(start.getTime() + duration * 60_000) : undefined;
    return (
      <DestinationForm
        text={item.title + (item.note ? `\n${item.note}` : "")}
        to={converting}
        initialStart={converting === "TASK" || converting === "EVENT" ? start : undefined}
        initialEnd={converting === "TASK" || converting === "EVENT" ? end : undefined}
        onClose={() => setConverting(null)}
        onDone={() => void act(() => apiPatch(`/api/checklists/${item.id}`, { linkedType: converting }), "ثبت شد، ولی علامت‌گذاری مورد انجام نشد.")}
      />
    );
  }
  if (converting === "PICK") {
    return (
      <DestinationSheet
        text={item.title}
        destinations={ITEM_DESTINATIONS}
        onPick={(to) => setConverting(to)}
        onClose={() => setConverting(null)}
        footer={duration ? `کار و رویداد با مدت همین مورد (${formatDuration(duration)}) باز می‌شوند؛ روز و ساعتش را همان‌جا انتخاب کن.` : "برای زمان‌دار شدن، اول مدت این مورد را تعیین کن."}
      />
    );
  }

  return (
    <Sheet title="تنظیمات مورد" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CHECKLIST_TITLE_MAX_LENGTH} className={inputClass} aria-label="عنوان" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={CHECKLIST_NOTE_MAX_LENGTH} rows={2} placeholder="توضیح (اختیاری)" className={`${inputClass} resize-none`} />
        </div>

        {item.linkedType && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs">
            <span className="text-accent">
              ✓ به {LINK_LABELS[item.linkedType] ?? item.linkedType} تبدیل شد{item.linkedAt ? ` · ${formatJalali(new Date(item.linkedAt))}` : ""}
            </span>
            <button type="button" onClick={() => void act(() => apiPatch(`/api/checklists/${item.id}`, { linkedType: null }), "انجام نشد.", false)} className="text-muted">
              فراموش کن
            </button>
          </div>
        )}

        {hasChildren ? (
          <p className="text-xs text-muted leading-relaxed">این مورد زیرمورد دارد؛ زمانش از زیرموردهایش حساب می‌شود، پس مدت را برای زیرموردها تعیین کن. ترتیبی که اینجا بگذاری (مثلاً «بعد از گرفتن سالن») از اولین زیرموردش شروع می‌شود و بقیه پشت سرش می‌آیند.</p>
        ) : (
          <section className="space-y-3 rounded-xl border border-line p-3">
            <p className="text-sm font-medium text-ink">زمان‌بندی (اختیاری)</p>
            <div>
              <p className="text-xs text-muted mb-1.5">چقدر طول می‌کشد؟</p>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={duration === null} onClick={() => setDuration(null)}>
                  بدون زمان
                </Chip>
                {DURATION_PRESETS.map((m) => (
                  <Chip
                    key={m}
                    active={duration === m && !customDuration}
                    onClick={() => {
                      setDuration(m);
                      setCustomDuration("");
                    }}
                  >
                    {m === 480 ? "یک روز کاری" : formatDuration(m)}
                  </Chip>
                ))}
              </div>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={customDuration}
                onChange={(e) => {
                  setCustomDuration(e.target.value);
                  const n = Math.round(Number(e.target.value));
                  setDuration(n >= 1 ? Math.min(n, 7 * 24 * 60) : null);
                }}
                placeholder="یا به دقیقه، مثلاً ۴۵"
                className={`${inputClass} mt-2`}
              />
            </div>
          </section>
        )}

        <section className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-sm font-medium text-ink">ترتیب (اختیاری)</p>
          <p className="text-[11px] text-muted">بدون ترتیب، این مورد بعد از مورد قبلی فهرست می‌آید.</p>
          <div className="grid grid-cols-2 gap-2">
            <select value={depType} onChange={(e) => setDepType(e.target.value)} className={inputClass} aria-label="نوع ترتیب">
              <option value="">بدون ترتیب</option>
              {DEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DEP_LABELS[t as DepType]}
                </option>
              ))}
            </select>
            <select value={depItemId} onChange={(e) => setDepItemId(e.target.value)} disabled={!depType} className={`${inputClass} disabled:opacity-50`} aria-label="مورد مرجع">
              <option value="">کدام مورد؟</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {pathLabel(items, c.id, rootId)}
                </option>
              ))}
            </select>
          </div>
          {depType && <LagPicker depType={depType} lagMin={lagMin} onChange={setLagMin} />}
          {depType && !depItemId && <p className="text-[11px] text-signal-700">مورد مرجع را انتخاب کن، وگرنه ترتیب ذخیره نمی‌شود.</p>}
        </section>

        {error && <p className="text-xs text-waste">{error}</p>}

        <button type="button" disabled={saving || !dirty || !title.trim()} onClick={save} className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
          {saving ? "در حال ذخیره..." : "ذخیره"}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setConverting("PICK")} className="col-span-2 rounded-xl border border-accent text-accent py-2 text-sm">
            تبدیل به کار، رویداد، تراکنش… / افزودن به تقویم
          </button>
          {!isFirst && (
            <SmallButton onClick={() => void act(() => apiPatch(`/api/checklists/${item.id}`, { move: "UP" }), "جابه‌جایی انجام نشد.", false)}>↑ بالاتر</SmallButton>
          )}
          {!isLast && (
            <SmallButton onClick={() => void act(() => apiPatch(`/api/checklists/${item.id}`, { move: "DOWN" }), "جابه‌جایی انجام نشد.", false)}>↓ پایین‌تر</SmallButton>
          )}
          {hasChildren && <SmallButton onClick={() => void act(() => apiPost(`/api/checklists/${item.id}/reset`), "از نو کردن انجام نشد.")}>از نو (برداشتن تیک‌ها)</SmallButton>}
          <SmallButton
            danger
            onClick={() => {
              if (confirm(hasChildren ? `«${item.title}» با زیرموردهایش حذف شود؟` : `«${item.title}» حذف شود؟`)) void act(() => apiDelete(`/api/checklists/${item.id}`), "حذف انجام نشد.");
            }}
          >
            حذف{hasChildren ? ` (با ${toPersianDigits(String(items.filter((i) => i.parentId === item.id).length))} زیرمورد)` : ""}
          </SmallButton>
        </div>
      </div>
    </Sheet>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1 rounded-full text-xs ${active ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}>
      {children}
    </button>
  );
}

function SmallButton({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-xl border py-2 text-xs ${danger ? "border-waste/40 text-waste" : "border-line text-ink"}`}>
      {children}
    </button>
  );
}

const LAG_UNITS = [
  { value: 60, label: "ساعت" },
  { value: 24 * 60, label: "روز" },
  { value: 7 * 24 * 60, label: "هفته" },
] as const;
const MAX_LAG_MIN = 90 * 24 * 60;

/** The biggest unit the gap divides into evenly — 2880 min reads as «۲ روز», 90 as «۱.۵ ساعت». */
function splitLag(lagMin: number): { amount: string; unit: number } {
  for (const u of [...LAG_UNITS].reverse()) if (lagMin > 0 && lagMin % u.value === 0) return { amount: String(lagMin / u.value), unit: u.value };
  return { amount: lagMin > 0 ? String(Math.round((lagMin / 60) * 100) / 100) : "", unit: 60 };
}

/**
 * The gap in a rule: «۲ روز بعد از …», «۳ ساعت قبل از …». A few one-tap choices, or any number of
 * hours, days or weeks (up to 90 days).
 */
function LagPicker({ depType, lagMin, onChange }: { depType: string; lagMin: number; onChange: (lagMin: number) => void }) {
  const initial = splitLag(lagMin);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<number>(initial.unit);

  function apply(nextAmount: string, nextUnit: number) {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const n = Number(nextAmount);
    onChange(Number.isFinite(n) && n > 0 ? Math.min(MAX_LAG_MIN, Math.round(n * nextUnit)) : 0);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs text-muted">{depType === "BEFORE" ? "چقدر زودتر؟" : "با فاصلهٔ"}</span>
        {LAG_PRESETS.map((m) => (
          <Chip
            key={m}
            active={lagMin === m}
            onClick={() => {
              const s = splitLag(m);
              apply(s.amount, s.unit);
            }}
          >
            {m === 0 ? "بی‌فاصله" : lagLabel(m)}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={amount}
          onChange={(e) => apply(e.target.value, unit)}
          placeholder="مقدار دلخواه"
          aria-label="مقدار فاصله"
          className="w-28 bg-surface rounded-xl border border-line px-3 py-2 text-sm"
        />
        <select value={unit} onChange={(e) => apply(amount, Number(e.target.value))} aria-label="واحد فاصله" className="bg-surface rounded-xl border border-line px-2 py-2 text-sm">
          {LAG_UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{depType === "BEFORE" ? "زودتر" : depType === "WITH" ? "بعد از شروعش" : "بعد از پایانش"}</span>
      </div>
      {lagMin >= MAX_LAG_MIN && <p className="text-[11px] text-signal-700">بیشترین فاصله ۹۰ روز است.</p>}
    </div>
  );
}
