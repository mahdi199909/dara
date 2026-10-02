"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete, isNativePlatform } from "@/lib/apiClient";
import { useAccounts, useCategories } from "@/lib/hooks";
import { Card } from "@/components/ui/Card";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import CaptureFormModal from "@/components/CaptureFormModal";
import HabitFormModal from "@/components/habits/HabitFormModal";
import NewTransactionForm from "@/components/finance/NewTransactionForm";
import { NewInstallmentPlanForm } from "@/components/finance/InstallmentPlans";
import { ArrowForwardIcon, TrashIcon, XIcon } from "@/components/icons";
import { dayKeyIso } from "@/lib/calendarGrid";
import { toPersianDigits } from "@/lib/money";
import { notifySaved } from "@/lib/savedToast";
import { buildTree } from "@/lib/checklistTree";
import type { ChecklistItemDto } from "@/lib/schemas/checklists";
import { INBOX_MAX_LENGTH, INBOX_PRIORITY_LABELS, type InboxDestination, type InboxItemDto, type InboxPriority } from "@/lib/schemas/inbox";
import { NOTE_MAX_LENGTH } from "@/lib/schemas/notes";
import {
  DEFAULT_INBOX_REVIEW,
  WEEKDAYS_FA,
  describeReview,
  isReviewDue,
  markInboxReviewed,
  readInboxReviewSettings,
  saveInboxReviewSettings,
  type InboxReviewSettings,
} from "@/lib/inboxReview";

const KEY = "/api/inbox";
const DRAFT_KEY = "parva.inbox.draft.v1";
const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-400";

const DESTINATIONS: { to: InboxDestination; label: string; hint: string }[] = [
  { to: "TASK", label: "کار", hint: "کاری برای انجام" },
  { to: "EVENT", label: "رویداد", hint: "قرار با ساعت و روز" },
  { to: "TRANSACTION", label: "تراکنش", hint: "هزینه، درآمد، انتقال" },
  { to: "INSTALLMENT", label: "قسط", hint: "وام، بدهی قسطی" },
  { to: "CHECKLIST", label: "چک‌لیست", hint: "فهرست تازه یا افزودن به یکی" },
  { to: "NOTE", label: "نوت روز", hint: "یادداشت یک روز" },
  { to: "HABIT", label: "عادت", hint: "کاری که هر روز تکرار شود" },
];

const PRIORITY_STYLE: Record<InboxPriority, string> = {
  0: "bg-canvas text-muted",
  1: "bg-signal-100 text-signal-700",
  2: "bg-waste/15 text-waste",
};

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // the draft just isn't kept across visits
  }
}

/** The first line, cut to what a task/event/habit title can hold. */
function titleOf(content: string, max = 200): string {
  return (content.split(/\r?\n/).find((l) => l.trim()) ?? content).trim().slice(0, max);
}

export default function InboxPage() {
  const { data, mutate } = useSWR<{ items: InboxItemDto[] }>(KEY, fetcher);
  const items = useMemo(() => data?.items ?? [], [data]);
  const [moving, setMoving] = useState<{ item: InboxItemDto; to: InboxDestination | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewDue, setReviewDue] = useState(false);

  useEffect(() => {
    setReviewDue(isReviewDue(readInboxReviewSettings(), new Date()));
  }, []);
  // An empty inbox is a finished review.
  useEffect(() => {
    if (data && items.length === 0) {
      markInboxReviewed();
      setReviewDue(false);
    }
  }, [data, items.length]);

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setError(null);
    try {
      await action();
      await mutate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      return false;
    }
  }

  /** The item became something else: it leaves the inbox. */
  async function processed(item: InboxItemDto, to: InboxDestination) {
    setMoving(null);
    await run(() => apiPost(`${KEY}/${item.id}/process`, { to }), "برداشتن از صندوق انجام نشد.");
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">صندوق ورودی</h1>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          هرچه در ذهنت است اینجا خالی کن — بدون فکر کردن به جایش. بعد، سر فرصت، هرکدام را با دکمهٔ فلش به کار، رویداد، تراکنش، قسط، چک‌لیست… تبدیل کن یا دور بریز.
        </p>
      </div>

      {reviewDue && items.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-signal-300 bg-signal-50 px-3 py-2.5">
          <p className="text-sm text-signal-700">وقت خالی کردن صندوق است: {toPersianDigits(String(items.length))} مورد منتظر تصمیم توست.</p>
          <button
            type="button"
            onClick={() => {
              markInboxReviewed();
              setReviewDue(false);
            }}
            className="text-xs text-signal-700 shrink-0"
          >
            بعداً
          </button>
        </div>
      )}

      <CaptureBox onAdd={(contents) => run(async () => {
        for (const content of contents) await apiPost(KEY, { content });
      }, "افزودن انجام نشد.")} />

      {error && <p className="text-xs text-waste">{error}</p>}

      {!data ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-ink">صندوق خالی است ✓</p>
          <p className="text-xs text-muted mt-1">ذهن خالی، کار آرام.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted">{toPersianDigits(String(items.length))} مورد — فوری‌ها اول</p>
          {items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onSave={(patch) => run(() => apiPatch(`${KEY}/${item.id}`, patch), "ذخیره انجام نشد.")}
              onDiscard={() => {
                if (confirm("این مورد دور ریخته شود؟")) void run(() => apiDelete(`${KEY}/${item.id}`), "حذف انجام نشد.");
              }}
              onMove={() => setMoving({ item, to: null })}
            />
          ))}
        </div>
      )}

      <ReviewSettings />

      {moving && !moving.to && <DestinationSheet item={moving.item} onPick={(to) => setMoving({ ...moving, to })} onClose={() => setMoving(null)} />}
      {moving?.to && <DestinationForm item={moving.item} to={moving.to} onDone={() => void processed(moving.item, moving.to!)} onClose={() => setMoving(null)} />}
    </div>
  );
}

function CaptureBox({ onAdd }: { onAdd: (contents: string[]) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(readDraft()), []);

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const multi = lines.length > 1;

  async function add(contents: string[]) {
    if (contents.length === 0) return;
    setSaving(true);
    if (await onAdd(contents)) {
      setText("");
      writeDraft("");
    }
    setSaving(false);
  }

  return (
    <Card className="p-3 space-y-2">
      <textarea
        value={text}
        maxLength={INBOX_MAX_LENGTH}
        onChange={(e) => {
          setText(e.target.value);
          writeDraft(e.target.value);
        }}
        rows={4}
        placeholder="بنویس… یک فکر، یک خرید، یک قرار، یک ایده. چرک‌نویس است — تا نفرستی همین‌جا می‌ماند."
        className={`${inputClass} resize-y`}
      />
      <div className="flex gap-2">
        <button type="button" disabled={saving || !text.trim()} onClick={() => void add([text.trim()])} className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
          {saving ? "در حال ثبت..." : "به صندوق"}
        </button>
        {multi && (
          <button type="button" disabled={saving} onClick={() => void add(lines)} className="flex-1 rounded-xl border border-accent text-accent py-2 text-sm disabled:opacity-40">
            هر خط یک مورد ({toPersianDigits(String(lines.length))})
          </button>
        )}
      </div>
    </Card>
  );
}

function PriorityPicker({ value, onChange }: { value: InboxPriority; onChange: (p: InboxPriority) => void }) {
  return (
    <div className="flex gap-1.5">
      {([2, 1, 0] as InboxPriority[]).map((p) => (
        <button key={p} type="button" onClick={() => onChange(p)} className={`px-2.5 py-1 rounded-full text-xs border ${value === p ? "border-accent text-accent bg-accent-soft" : "border-line text-muted"}`}>
          {INBOX_PRIORITY_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function InboxRow({
  item,
  onSave,
  onDiscard,
  onMove,
}: {
  item: InboxItemDto;
  onSave: (patch: { content?: string; priority?: InboxPriority }) => Promise<boolean>;
  onDiscard: () => void;
  onMove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.content);

  return (
    <Card className="p-3">
      {editing ? (
        <div className="space-y-2">
          <textarea autoFocus value={text} maxLength={INBOX_MAX_LENGTH} onChange={(e) => setText(e.target.value)} rows={Math.min(8, Math.max(3, text.split("\n").length))} className={`${inputClass} resize-y`} />
          <div className="flex items-center justify-between gap-2">
            <PriorityPicker value={item.priority} onChange={(priority) => void onSave({ priority })} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!text.trim()}
              onClick={async () => {
                if (await onSave({ content: text })) setEditing(false);
              }}
              className="flex-1 rounded-lg bg-accent text-on-accent py-1.5 text-xs font-medium disabled:opacity-40"
            >
              ذخیره
            </button>
            <button
              type="button"
              onClick={() => {
                setText(item.content);
                setEditing(false);
              }}
              className="px-3 rounded-lg bg-canvas text-muted text-xs"
            >
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => setEditing(true)} className="flex-1 min-w-0 text-right space-y-1">
            {item.priority > 0 && <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${PRIORITY_STYLE[item.priority]}`}>{INBOX_PRIORITY_LABELS[item.priority]}</span>}
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">{item.content}</p>
          </button>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <button type="button" onClick={onMove} aria-label="انتقال به…" className="w-9 h-9 rounded-full bg-accent text-on-accent flex items-center justify-center">
              <ArrowForwardIcon className="w-4 h-4" />
            </button>
            <button type="button" onClick={onDiscard} aria-label="دور ریختن" className="p-1.5 text-muted hover:text-waste">
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function DestinationSheet({ item, onPick, onClose }: { item: InboxItemDto; onPick: (to: InboxDestination) => void; onClose: () => void }) {
  return (
    <Sheet title="تبدیل به…" onClose={onClose}>
      <p className="text-sm text-muted mb-3 line-clamp-2 whitespace-pre-wrap">«{item.content}»</p>
      <div className="grid grid-cols-2 gap-2">
        {DESTINATIONS.map((d) => (
          <button key={d.to} type="button" onClick={() => onPick(d.to)} className="rounded-xl border border-line px-3 py-2.5 text-right hover:bg-canvas">
            <span className="block text-sm font-medium text-ink">{d.label}</span>
            <span className="block text-[11px] text-muted">{d.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-3">بعد از ثبت، این مورد از صندوق برداشته می‌شود.</p>
    </Sheet>
  );
}

/** The form for the chosen destination, pre-filled from the item; `onDone` once it was actually saved. */
function DestinationForm({ item, to, onDone, onClose }: { item: InboxItemDto; to: InboxDestination; onDone: () => void; onClose: () => void }) {
  const { categories } = useCategories();
  const { accounts } = useAccounts();

  switch (to) {
    case "TASK":
    case "EVENT":
      return <CaptureFormModal open onClose={onClose} onDone={onDone} initialTitle={titleOf(item.content)} initialEntityType={to} />;
    case "HABIT":
      return <HabitFormModal onClose={onClose} onSaved={onDone} initialTitle={titleOf(item.content)} />;
    case "TRANSACTION":
      return (
        <Sheet title="تراکنش تازه" onClose={onClose}>
          <NewTransactionForm categories={categories} accounts={accounts.filter((a: { isActive?: boolean }) => a.isActive !== false)} onDone={onDone} initialDescription={titleOf(item.content)} />
        </Sheet>
      );
    case "INSTALLMENT":
      return (
        <Sheet title="قسط تازه" onClose={onClose}>
          <NewInstallmentPlanForm onDone={onDone} initialTitle={titleOf(item.content)} />
        </Sheet>
      );
    case "CHECKLIST":
      return <ChecklistDestination item={item} onDone={onDone} onClose={onClose} />;
    case "NOTE":
      return <NoteDestination item={item} onDone={onDone} onClose={onClose} />;
  }
}

function ChecklistDestination({ item, onDone, onClose }: { item: InboxItemDto; onDone: () => void; onClose: () => void }) {
  const { data } = useSWR<{ items: ChecklistItemDto[] }>("/api/checklists", fetcher);
  const lists = useMemo(() => buildTree(data?.items ?? []).map((n) => n.item), [data]);
  const lines = item.content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, 300));
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
        const created = await apiPost<{ item: ChecklistItemDto }>("/api/checklists", { title: (title || lines[0] || item.content).slice(0, 300) });
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

function NoteDestination({ item, onDone, onClose }: { item: InboxItemDto; onDone: () => void; onClose: () => void }) {
  const [day, setDay] = useState(new Date());
  const [content, setContent] = useState(item.content.slice(0, NOTE_MAX_LENGTH));
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

function ReviewSettings() {
  const [settings, setSettings] = useState<InboxReviewSettings>(DEFAULT_INBOX_REVIEW);
  const [open, setOpen] = useState(false);
  const [native, setNative] = useState(false);
  useEffect(() => {
    setSettings(readInboxReviewSettings());
    setNative(isNativePlatform());
  }, []);

  function update(patch: Partial<InboxReviewSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveInboxReviewSettings(next);
  }

  return (
    <Card className="p-3 space-y-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-right">
        <span className="text-sm text-ink">یادآور خالی کردن صندوق</span>
        <span className="text-xs text-muted">{describeReview(settings)} · تغییر</span>
      </button>
      {open && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="w-4 h-4 accent-accent" />
            یادآوری کن (فقط وقتی صندوق خالی نیست)
          </label>
          {settings.enabled && (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
                {(
                  [
                    ["DAILY", "هر روز"],
                    ["WEEKLY", "هر هفته"],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => update({ frequency: value })} className={`rounded-lg py-1.5 text-sm ${settings.frequency === value ? "bg-surface text-ink font-medium shadow-card" : "text-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {settings.frequency === "WEEKLY" ? (
                  <select value={settings.weekday} onChange={(e) => update({ weekday: Number(e.target.value) })} className={inputClass}>
                    {WEEKDAYS_FA.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span />
                )}
                <input type="time" value={settings.time} onChange={(e) => e.target.value && update({ time: e.target.value })} className={inputClass} dir="ltr" />
              </div>
            </>
          )}
          <p className="text-[11px] text-muted leading-relaxed">
            {native
              ? "روی همین گوشی اعلان می‌دهد، حتی وقتی اپ بسته است — و فقط اگر چیزی در صندوق مانده باشد."
              : "در نسخهٔ وب اعلان نمی‌آید؛ وقتش که برسد، بالای همین صفحه یادآوری می‌شود. اعلان واقعی در اپ اندروید است."}
          </p>
        </div>
      )}
    </Card>
  );
}
