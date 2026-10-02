"use client";

// «تبدیل به…»: turning a piece of text into a task, event, transaction, installment plan, checklist,
// day note or habit — or letting smart capture decide («تشخیص خودکار»). Used by the inbox and by
// checklist items; each destination opens that section's own form, pre-filled with the text.
import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { useAccounts, useCategories } from "@/lib/hooks";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import CaptureFormModal from "@/components/CaptureFormModal";
import SmartCaptureConfirm from "@/components/SmartCaptureConfirm";
import CaptureIntentConfirm from "@/components/CaptureIntentConfirm";
import HabitFormModal from "@/components/habits/HabitFormModal";
import NewTransactionForm from "@/components/finance/NewTransactionForm";
import { NewInstallmentPlanForm } from "@/components/finance/InstallmentPlans";
import { XIcon } from "@/components/icons";
import { parseCaptureIntent, type CaptureIntent } from "@/lib/captureIntent";
import type { CapturePrefill } from "@/lib/smartCapture";
import { dayKeyIso } from "@/lib/calendarGrid";
import { toPersianDigits } from "@/lib/money";
import { notifySaved } from "@/lib/savedToast";
import { buildTree } from "@/lib/checklistTree";
import type { ChecklistItemDto } from "@/lib/schemas/checklists";
import { INBOX_DESTINATIONS, type InboxDestination } from "@/lib/schemas/inbox";
import { NOTE_MAX_LENGTH } from "@/lib/schemas/notes";

const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-400";

const DESTINATIONS: InboxDestination[] = [...INBOX_DESTINATIONS];

export const DESTINATION_OPTIONS: { to: InboxDestination; label: string; hint: string }[] = [
  { to: "AUTO", label: "✨ تشخیص خودکار", hint: "پروا از متن بفهمد چیست" },
  { to: "TASK", label: "کار", hint: "کاری برای انجام" },
  { to: "EVENT", label: "رویداد", hint: "قرار با ساعت و روز" },
  { to: "TRANSACTION", label: "تراکنش", hint: "هزینه، درآمد، انتقال" },
  { to: "INSTALLMENT", label: "قسط", hint: "وام، بدهی قسطی" },
  { to: "CHECKLIST", label: "چک‌لیست", hint: "فهرست تازه یا افزودن به یکی" },
  { to: "NOTE", label: "نوت روز", hint: "یادداشت یک روز" },
  { to: "HABIT", label: "عادت", hint: "کاری که هر روز تکرار شود" },
];

/** The first line, cut to what a task/event/habit title can hold. */
export function titleOf(content: string, max = 200): string {
  return (content.split(/\r?\n/).find((l) => l.trim()) ?? content).trim().slice(0, max);
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 className="font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="بستن">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 pt-3">{children}</div>
      </div>
    </div>
  );
}

export function DestinationSheet({
  text,
  onPick,
  onClose,
  destinations = DESTINATIONS,
  footer,
}: {
  text: string;
  onPick: (to: InboxDestination) => void;
  onClose: () => void;
  destinations?: InboxDestination[];
  footer?: string;
}) {
  return (
    <Sheet title="تبدیل به…" onClose={onClose}>
      <p className="text-sm text-muted mb-3 line-clamp-2 whitespace-pre-wrap">«{text}»</p>
      <div className="grid grid-cols-2 gap-2">
        {DESTINATION_OPTIONS.filter((d) => destinations.includes(d.to)).map((d) => (
          <button key={d.to} type="button" onClick={() => onPick(d.to)} className="rounded-xl border border-line px-3 py-2.5 text-right hover:bg-canvas">
            <span className="block text-sm font-medium text-ink">{d.label}</span>
            <span className="block text-[11px] text-muted">{d.hint}</span>
          </button>
        ))}
      </div>
      {footer && <p className="text-[11px] text-muted mt-3">{footer}</p>}
    </Sheet>
  );
}

/** The form for the chosen destination, pre-filled from the text; `onDone` once it was actually saved. */
export function DestinationForm({
  text,
  to,
  onDone,
  onClose,
  initialStart,
  initialEnd,
}: {
  text: string;
  to: InboxDestination;
  onDone: () => void;
  onClose: () => void;
  /** A checklist step with a duration opens the task/event form already timed. */
  initialStart?: Date;
  initialEnd?: Date;
}) {
  const { categories } = useCategories();
  const { accounts } = useAccounts();

  switch (to) {
    case "AUTO":
      return <SmartDestination text={text} onDone={onDone} onClose={onClose} />;
    case "TASK":
    case "EVENT":
      return <CaptureFormModal open onClose={onClose} onDone={onDone} initialTitle={titleOf(text)} initialEntityType={to} initialStart={initialStart} initialEnd={initialEnd} />;
    case "HABIT":
      return <HabitFormModal onClose={onClose} onSaved={onDone} initialTitle={titleOf(text)} />;
    case "TRANSACTION":
      return (
        <Sheet title="تراکنش تازه" onClose={onClose}>
          <NewTransactionForm categories={categories} accounts={accounts.filter((a: { isActive?: boolean }) => a.isActive !== false)} onDone={onDone} initialDescription={titleOf(text)} />
        </Sheet>
      );
    case "INSTALLMENT":
      return (
        <Sheet title="قسط تازه" onClose={onClose}>
          <NewInstallmentPlanForm onDone={onDone} initialTitle={titleOf(text)} />
        </Sheet>
      );
    case "CHECKLIST":
      return <ChecklistDestination text={text} onDone={onDone} onClose={onClose} />;
    case "NOTE":
      return <NoteDestination text={text} onDone={onDone} onClose={onClose} />;
  }
}

/**
 * «تشخیص خودکار»: the same reading Home's «ثبت...» field does — a line like «قسط وام ۲ میلیون ۱۵ هر ماه»
 * becomes an installment plan, «ناهار ۳۰۰ تومان» an expense — with the same one-glance confirm card
 * and the same ways out (fix it in the full form, or "just a plain entry").
 */
function SmartDestination({ text, onDone, onClose }: { text: string; onDone: () => void; onClose: () => void }) {
  const [stage, setStage] = useState<{ kind: "ENTRY"; prefill: CapturePrefill } | { kind: "INTENT"; intent: CaptureIntent } | { kind: "FORM"; prefill: CapturePrefill }>(() => {
    const parsed = parseCaptureIntent(text);
    return parsed.kind === "ENTRY" ? { kind: "ENTRY", prefill: parsed.prefill } : { kind: "INTENT", intent: parsed };
  });

  if (stage.kind === "INTENT") {
    return (
      <CaptureIntentConfirm
        intent={stage.intent}
        onDone={onDone}
        onCancel={onClose}
        onAsEntry={() => {
          const entry = parseCaptureIntent(text, new Date(), { forceEntry: true });
          if (entry.kind === "ENTRY") setStage({ kind: "ENTRY", prefill: entry.prefill });
        }}
      />
    );
  }
  if (stage.kind === "ENTRY") {
    return <SmartCaptureConfirm prefill={stage.prefill} onConfirmed={onDone} onEdit={() => setStage({ kind: "FORM", prefill: stage.prefill })} onCancel={onClose} />;
  }
  const p = stage.prefill;
  return (
    <CaptureFormModal
      open
      onClose={onClose}
      onDone={onDone}
      initialStart={p.start ?? undefined}
      initialEnd={p.end ?? undefined}
      initialTitle={p.title}
      initialDay={p.day}
      initialEntityType={p.entityType}
      initialFlowType={p.flowType}
      initialAmount={p.amount}
      initialCategoryHint={p.categoryHint}
    />
  );
}

function ChecklistDestination({ text, onDone, onClose }: { text: string; onDone: () => void; onClose: () => void }) {
  const { data } = useSWR<{ items: ChecklistItemDto[] }>("/api/checklists", fetcher);
  const lists = useMemo(() => buildTree(data?.items ?? []).map((n) => n.item), [data]);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, 300));
  const [target, setTarget] = useState<string>("NEW");
  const [title, setTitle] = useState(lines.length > 1 ? lines[0] : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new list: the first line names it when there are several, the rest become its items.
  const newItems = target === "NEW" ? (lines.length > 1 ? lines.slice(1) : []) : lines;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      let parentId = target;
      if (target === "NEW") {
        const created = await apiPost<{ item: ChecklistItemDto }>("/api/checklists", { title: (title || lines[0] || text).slice(0, 300) });
        parentId = created.item.id;
      }
      if (newItems.length > 0) await apiPost("/api/checklists", { parentId, titles: newItems });
      notifySaved();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="به چک‌لیست" onClose={onClose}>
      <div className="space-y-3">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
          <option value="NEW">چک‌لیست تازه</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              افزودن به «{l.title}»
            </option>
          ))}
        </select>
        {target === "NEW" && <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={lines[0] ?? "نام چک‌لیست"} className={inputClass} />}
        {newItems.length > 0 && (
          <div>
            <p className="text-xs text-muted mb-1">{toPersianDigits(String(newItems.length))} مورد اضافه می‌شود (هر خط یک مورد):</p>
            <ul className="text-sm text-ink list-disc pr-5 space-y-0.5 max-h-40 overflow-y-auto">
              {newItems.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-xs text-waste">{error}</p>}
        <button type="button" disabled={saving} onClick={() => void save()} className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
          {saving ? "در حال ثبت..." : "ثبت در چک‌لیست"}
        </button>
      </div>
    </Sheet>
  );
}

function NoteDestination({ text, onDone, onClose }: { text: string; onDone: () => void; onClose: () => void }) {
  const [day, setDay] = useState(new Date());
  const [content, setContent] = useState(text.slice(0, NOTE_MAX_LENGTH));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiPost("/api/notes", { day: dayKeyIso(day), content });
      notifySaved();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت نوت انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="نوت روز" onClose={onClose}>
      <div className="space-y-3">
        <JalaliDateInput value={day} onChange={setDay} />
        <textarea value={content} maxLength={NOTE_MAX_LENGTH} onChange={(e) => setContent(e.target.value)} rows={5} className={`${inputClass} resize-y`} />
        {error && <p className="text-xs text-waste">{error}</p>}
        <button type="button" disabled={saving || !content.trim()} onClick={() => void save()} className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
          {saving ? "در حال ثبت..." : "ثبت نوت"}
        </button>
      </div>
    </Sheet>
  );
}
