"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { buildTree, progressOf, type TreeNode } from "@/lib/checklistTree";
import { CHECKLIST_TITLE_MAX_LENGTH, type ChecklistItemDto, type ChecklistTreeNode } from "@/lib/schemas/checklists";
import { describeRule } from "@/lib/checklistSchedule";
import { formatDuration } from "@/lib/money";
import ItemSettingsSheet, { LINK_LABELS } from "@/components/checklists/ItemSettingsSheet";
import SchedulePanel from "@/components/checklists/SchedulePanel";
import { CHECKLIST_TEMPLATES, templateLeafCount, type ChecklistTemplate } from "@/lib/checklistTemplates";
import { toPersianDigits } from "@/lib/money";
import { Card, EmptyState } from "@/components/ui/Card";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon, PlusIcon, RotateIcon, TrashIcon, XIcon } from "@/components/icons";

type Node = TreeNode<ChecklistItemDto>;
const KEY = "/api/checklists";
const inputClass = "bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";

/** One title per non-empty line — a pasted list becomes that many items. */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => l.slice(0, CHECKLIST_TITLE_MAX_LENGTH));
}

function useChecklists() {
  const { data, mutate, error } = useSWR<{ items: ChecklistItemDto[] }>(KEY, fetcher);
  const items = useMemo(() => data?.items ?? [], [data]);
  const tree = useMemo(() => buildTree(items), [items]);
  return { items, tree, loading: !data && !error, mutate };
}

export default function ChecklistsPage() {
  return (
    <Suspense fallback={null}>
      <ChecklistsInner />
    </Suspense>
  );
}

function ChecklistsInner() {
  const id = useSearchParams().get("id");
  return id ? <ChecklistView id={id} /> : <ChecklistIndex />;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
      <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ChecklistIndex() {
  const router = useRouter();
  const { items, tree, loading, mutate } = useChecklists();
  const [showTemplates, setShowTemplates] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost(KEY, { title });
      setTitle("");
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ساخت چک‌لیست انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">چک‌لیست‌ها</h1>
        <p className="text-xs text-muted mt-1">فهرست‌هایی که بارها به کارت می‌آیند — سفر، خرید، سمینار… هر مورد می‌تواند زیرمورد خودش را داشته باشد.</p>
      </div>

      <form onSubmit={add} className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CHECKLIST_TITLE_MAX_LENGTH} placeholder="چک‌لیست تازه، مثلاً «سفر»" className={inputClass} />
        <button type="submit" disabled={saving || !title.trim()} className="shrink-0 flex items-center gap-1 rounded-xl bg-accent text-on-accent px-3 text-sm disabled:opacity-40">
          <PlusIcon className="w-4 h-4" />
          بساز
        </button>
      </form>
      {error && <p className="text-xs text-waste">{error}</p>}

      <button type="button" onClick={() => setShowTemplates(true)} className="w-full rounded-xl border border-dashed border-accent text-accent py-2.5 text-sm">
        ✨ چک‌لیست‌های آماده — سفر، سمینار، مرور هفتگی…
      </button>
      {showTemplates && (
        <TemplateGallery
          onClose={() => setShowTemplates(false)}
          onAdded={async (id) => {
            setShowTemplates(false);
            await mutate();
            router.push(`/checklists?id=${id}`);
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : tree.length === 0 ? (
        <Card>
          <EmptyState message="هنوز چک‌لیستی نساخته‌ای — یکی بساز یا از چک‌لیست‌های آماده شروع کن." />
        </Card>
      ) : (
        <div className="space-y-2">
          {tree.map((list) => {
            const { done, total } = progressOf(items, list.item.id);
            return (
              <Link key={list.item.id} href={`/checklists?id=${list.item.id}`} className="block">
                <Card className="p-4 space-y-2 hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink truncate">{list.item.title}</p>
                    <span className="text-xs text-muted shrink-0">
                      {total === 0 ? "خالی" : done === total ? "همه انجام شد ✓" : `${toPersianDigits(String(done))} از ${toPersianDigits(String(total))}`}
                    </span>
                  </div>
                  {total > 0 && <ProgressBar done={done} total={total} />}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function findNode(nodes: Node[], id: string): Node | null {
  for (const n of nodes) {
    if (n.item.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function ChecklistView({ id }: { id: string }) {
  const router = useRouter();
  const { items, tree, loading, mutate } = useChecklists();
  const list = useMemo(() => findNode(tree, id), [tree, id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"LIST" | "PLAN">("LIST");
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await mutate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      await mutate();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted text-center py-12">در حال بارگذاری...</p>;
  if (!list) {
    return (
      <div className="px-4 py-6 space-y-3">
        <Link href="/checklists" className="text-sm text-accent">
          → همهٔ چک‌لیست‌ها
        </Link>
        <Card>
          <EmptyState message="این چک‌لیست پیدا نشد." />
        </Card>
      </div>
    );
  }

  const { done, total } = progressOf(items, id);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const ctx: RowContext = { run, busy, openSettings: setSettingsFor, titleOf: (itemId) => titleById.get(itemId) ?? null };

  // The item whose settings are open, with what the sheet needs to know about its place.
  const settingsItem = settingsFor ? items.find((i) => i.id === settingsFor) : undefined;
  const siblings = settingsItem ? items.filter((i) => i.parentId === settingsItem.parentId).sort((a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt))) : [];

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href="/checklists" className="inline-flex items-center gap-1 text-sm text-accent">
        <ChevronRightIcon className="w-4 h-4" />
        همهٔ چک‌لیست‌ها
      </Link>

      <ListHeader list={list} done={done} total={total} ctx={ctx} onDeleted={() => router.push("/checklists")} />
      {error && <p className="text-xs text-waste">{error}</p>}

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
        {(
          [
            ["LIST", "فهرست"],
            ["PLAN", "زمان‌بندی (پیشرفته)"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-lg py-2 text-sm ${tab === value ? "bg-surface text-ink font-medium shadow-card" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "LIST" ? (
        <Card className="p-2">
          {list.children.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">هنوز موردی نیست — اولین را پایین اضافه کن.</p>
          ) : (
            <SiblingList nodes={list.children} depth={0} ctx={ctx} />
          )}
          <div className="px-1 pt-2">
            <AddItems parentId={id} ctx={ctx} placeholder="مورد تازه (هر خط یک مورد)" />
          </div>
          <p className="px-1 pt-2 text-[11px] text-muted">برای ویرایش، حذف، زمان و ترتیب هر مورد، روی خودش بزن.</p>
        </Card>
      ) : (
        <SchedulePanel items={items} rootId={id} onEditItem={setSettingsFor} onChanged={mutate} />
      )}

      {settingsItem && (
        <ItemSettingsSheet
          key={settingsItem.id}
          item={settingsItem}
          items={items}
          rootId={id}
          hasChildren={items.some((i) => i.parentId === settingsItem.id)}
          isFirst={siblings[0]?.id === settingsItem.id}
          isLast={siblings[siblings.length - 1]?.id === settingsItem.id}
          onClose={() => setSettingsFor(null)}
          onChanged={mutate}
        />
      )}
    </div>
  );
}

interface RowContext {
  run: (action: () => Promise<unknown>, fallback: string) => Promise<boolean>;
  busy: boolean;
  /** Opens the item's settings sheet (edit, delete, time, order, turn into…). */
  openSettings: (id: string) => void;
  titleOf: (id: string) => string | null;
}

function ListHeader({ list, done, total, ctx, onDeleted }: { list: Node; done: number; total: number; ctx: RowContext; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(list.item.title);

  return (
    <Card className="p-4 space-y-3">
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim() && (await ctx.run(() => apiPatch(`${KEY}/${list.item.id}`, { title }), "ذخیره انجام نشد."))) setEditing(false);
          }}
          className="flex gap-2"
        >
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CHECKLIST_TITLE_MAX_LENGTH} className={inputClass} />
          <button type="submit" className="shrink-0 rounded-xl bg-accent text-on-accent px-3 text-sm">
            ذخیره
          </button>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-bold text-ink break-words min-w-0">{list.item.title}</h1>
          <div className="flex items-center shrink-0">
            <button type="button" aria-label="تغییر نام" onClick={() => setEditing(true)} className="p-2 text-muted hover:text-ink">
              <EditIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="حذف چک‌لیست"
              onClick={async () => {
                if (!confirm(`«${list.item.title}» با همهٔ مواردش حذف شود؟`)) return;
                if (await ctx.run(() => apiDelete(`${KEY}/${list.item.id}`), "حذف انجام نشد.")) onDeleted();
              }}
              className="p-2 text-waste"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar done={done} total={total} />
        </div>
        <span className="text-xs text-muted shrink-0">
          {toPersianDigits(String(done))} از {toPersianDigits(String(total))}
        </span>
      </div>
      <button
        type="button"
        disabled={ctx.busy || done === 0}
        onClick={() => {
          if (confirm("همهٔ تیک‌های این چک‌لیست برداشته شود تا دوباره از اول استفاده شود؟")) void ctx.run(() => apiPost(`${KEY}/${list.item.id}/reset`), "از نو کردن انجام نشد.");
        }}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-sm text-ink disabled:opacity-40"
      >
        <RotateIcon className="w-4 h-4" />
        از نو (برداشتن همهٔ تیک‌ها)
      </button>
    </Card>
  );
}

function AddItems({ parentId, ctx, placeholder, autoFocus, onDone }: { parentId: string; ctx: RowContext; placeholder: string; autoFocus?: boolean; onDone?: () => void }) {
  const [text, setText] = useState("");
  const titles = splitLines(text);

  async function submit() {
    if (titles.length === 0) return;
    const ok = await ctx.run(() => (titles.length === 1 ? apiPost(KEY, { parentId, title: titles[0] }) : apiPost(KEY, { parentId, titles })), "افزودن انجام نشد.");
    if (ok) {
      setText("");
      onDone?.();
    }
  }

  return (
    <div className="flex gap-2 items-start">
      <textarea
        autoFocus={autoFocus}
        value={text}
        rows={text.includes("\n") ? Math.min(6, text.split("\n").length) : 1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds; Shift+Enter (or a paste) makes more lines — each becomes an item.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        className={`${inputClass} resize-none`}
      />
      <button type="button" disabled={ctx.busy || titles.length === 0} onClick={() => void submit()} className="shrink-0 rounded-xl bg-accent text-on-accent px-3 py-2 text-sm disabled:opacity-40">
        {titles.length > 1 ? `افزودن ${toPersianDigits(String(titles.length))}` : "افزودن"}
      </button>
    </div>
  );
}

function ChecklistRow({ node, depth, ctx, handle }: { node: Node; depth: number; ctx: RowContext; isFirst: boolean; isLast: boolean; handle: React.ReactNode }) {
  const { item, children } = node;
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);

  const hasChildren = children.length > 0;
  const doneChildren = children.filter((c) => c.item.checked).length;
  const url = `${KEY}/${item.id}`;
  const rule = describeRule(item.depType, item.depItemId ? ctx.titleOf(item.depItemId) : null, item.lagMin);

  return (
    <div>
      <div className="flex items-start gap-1.5 py-1.5 rounded-lg hover:bg-canvas/60" style={{ paddingRight: depth * 20 }}>
        {handle}
        <button
          type="button"
          aria-label={hasChildren ? (open ? "بستن" : "باز کردن") : undefined}
          onClick={() => hasChildren && setOpen((v) => !v)}
          className={`w-5 h-6 shrink-0 flex items-center justify-center text-muted ${hasChildren ? "" : "invisible"}`}
        >
          {open ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronLeftIcon className="w-4 h-4" />}
        </button>
        <button
          type="button"
          role="checkbox"
          aria-checked={item.checked}
          disabled={ctx.busy}
          onClick={() => void ctx.run(() => apiPatch(url, { checked: !item.checked }), "تیک زدن انجام نشد.")}
          className={`mt-0.5 w-5 h-5 rounded-md border shrink-0 flex items-center justify-center transition ${item.checked ? "bg-accent border-accent text-on-accent" : "border-line bg-surface"}`}
        >
          {item.checked && "✓"}
        </button>
        <button type="button" onClick={() => ctx.openSettings(item.id)} className="flex-1 min-w-0 text-right">
          <span className={`text-sm break-words ${item.checked ? "line-through text-muted" : "text-ink"}`}>{item.title}</span>
          {hasChildren && (
            <span className="text-[11px] text-muted mr-1.5">
              ({toPersianDigits(String(doneChildren))}/{toPersianDigits(String(children.length))})
            </span>
          )}
          {item.note && <span className="block text-xs text-muted whitespace-pre-wrap break-words">{item.note}</span>}
          {(item.durationMin || rule || item.linkedType) && (
            <span className="flex flex-wrap gap-1 mt-0.5">
              {item.durationMin && !hasChildren ? <Badge>⏱ {formatDuration(item.durationMin)}</Badge> : null}
              {rule && <Badge>{rule}</Badge>}
              {item.linkedType && <Badge accent>✓ {LINK_LABELS[item.linkedType] ?? item.linkedType}</Badge>}
            </span>
          )}
        </button>
        <button type="button" aria-label="افزودن زیرمورد" onClick={() => setAdding((v) => !v)} className="p-1 text-muted hover:text-accent shrink-0">
          <PlusIcon className="w-4 h-4" />
        </button>
        <button type="button" aria-label="ویرایش، حذف و زمان‌بندی" onClick={() => ctx.openSettings(item.id)} className="p-1 text-muted hover:text-ink shrink-0">
          <EditIcon className="w-4 h-4" />
        </button>
      </div>

      {adding && (
        <div className="pb-2" style={{ paddingRight: depth * 20 + 70 }}>
          <AddItems parentId={item.id} ctx={ctx} autoFocus placeholder={`زیرمورد «${item.title}»`} onDone={() => setOpen(true)} />
        </div>
      )}

      {hasChildren && open && <SiblingList nodes={children} depth={depth + 1} ctx={ctx} />}
    </div>
  );
}

function Badge({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={`inline-block px-1.5 py-0.5 rounded-md text-[10px] ${accent ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}>{children}</span>;
}

/**
 * The items of one level, in order, each draggable by its handle within that level: hold the ⋮⋮ handle,
 * drag up or down, a line shows where it will land, release to save. Moving between levels is done by
 * deleting and re-adding (kept simple on purpose — a drop "inside" an item is easy to hit by accident on a phone).
 */
function SiblingList({ nodes, depth, ctx }: { nodes: Node[]; depth: number; ctx: RowContext }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number } | null>(null);
  const start = useRef<{ y: number; centers: number[] } | null>(null);

  function targetIndex(pointerY: number, from: number): number {
    const centers = start.current?.centers ?? [];
    let to = 0;
    centers.forEach((c, i) => {
      if (i !== from && pointerY > c) to++;
    });
    return to;
  }

  function onPointerDown(e: React.PointerEvent, id: string, index: number) {
    if (ctx.busy) return;
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    start.current = { y: e.clientY, centers: rows.map((r) => r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2) };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, from: index, to: index, dy: 0 });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || !start.current) return;
    setDrag({ ...drag, dy: e.clientY - start.current.y, to: targetIndex(e.clientY, drag.from) });
  }

  function onPointerUp() {
    if (!drag) return;
    const { id, from, to } = drag;
    setDrag(null);
    start.current = null;
    if (to !== from) void ctx.run(() => apiPatch(`${KEY}/${id}`, { position: to }), "جابه‌جایی انجام نشد.");
  }

  // Where the insertion line goes: above the item now at `to` (counting without the dragged one).
  const others = drag ? nodes.filter((n) => n.item.id !== drag.id) : [];
  const lineBefore = drag && drag.to !== drag.from ? (others[drag.to]?.item.id ?? "END") : null;

  return (
    <ul ref={listRef}>
      {nodes.map((child, i) => {
        const dragging = drag?.id === child.item.id;
        return (
          <li
            key={child.item.id}
            className={`${dragging ? "relative z-10 bg-surface shadow-lg rounded-lg opacity-90" : ""} ${lineBefore === child.item.id ? "border-t-2 border-accent" : ""}`}
            style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}
          >
            <ChecklistRow
              node={child}
              depth={depth}
              ctx={ctx}
              isFirst={i === 0}
              isLast={i === nodes.length - 1}
              handle={
                nodes.length > 1 ? (
                  <span
                    role="button"
                    aria-label="جابه‌جایی با کشیدن"
                    onPointerDown={(e) => onPointerDown(e, child.item.id, i)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="w-4 h-6 shrink-0 flex items-center justify-center text-muted cursor-grab select-none"
                    style={{ touchAction: "none" }}
                  >
                    ⋮⋮
                  </span>
                ) : (
                  <span className="w-4 shrink-0" />
                )
              }
            />
          </li>
        );
      })}
      {lineBefore === "END" && <li aria-hidden className="border-t-2 border-accent" />}
    </ul>
  );
}

function TemplatePreview({ node, depth = 0 }: { node: ChecklistTreeNode; depth?: number }) {
  return (
    <ul className="space-y-0.5">
      {(node.children ?? []).map((child, i) => (
        <li key={i} style={{ paddingRight: depth * 14 }}>
          <span className={`text-xs ${child.children?.length ? "text-ink font-medium" : "text-muted"}`}>{child.children?.length ? child.title : `☐ ${child.title}`}</span>
          {child.children?.length ? <TemplatePreview node={child} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** The ready-made lists: look inside one, add it — it becomes an ordinary list of your own to change at will. */
function TemplateGallery({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(template: ChecklistTemplate) {
    setSaving(template.id);
    setError(null);
    try {
      const res = await apiPost<{ items: ChecklistItemDto[] }>(KEY, { tree: template.tree });
      onAdded(res.items[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "افزودن انجام نشد.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto scrollbar-thin" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 className="font-bold text-ink">چک‌لیست‌های آماده</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="بستن">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <p className="px-5 text-xs text-muted">بعد از افزودن، مال خودت است: هر مورد را عوض کن، حذف کن یا اضافه کن.</p>
        {error && <p className="px-5 pt-2 text-xs text-waste">{error}</p>}
        <div className="p-4 space-y-2">
          {CHECKLIST_TEMPLATES.map((t) => (
            <div key={t.id} className="rounded-xl border border-line">
              <div className="flex items-center gap-3 p-3">
                <span className="text-2xl shrink-0">{t.icon}</span>
                <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} className="flex-1 min-w-0 text-right">
                  <p className="text-sm font-medium text-ink">{t.title}</p>
                  <p className="text-[11px] text-muted">
                    {t.description} · {toPersianDigits(String(templateLeafCount(t.tree)))} مورد · {open === t.id ? "بستن" : "دیدن"}
                  </p>
                </button>
                <button type="button" disabled={saving !== null} onClick={() => void add(t)} className="shrink-0 rounded-lg bg-accent text-on-accent px-3 py-1.5 text-xs disabled:opacity-40">
                  {saving === t.id ? "..." : "افزودن"}
                </button>
              </div>
              {open === t.id && (
                <div className="px-4 pb-3">
                  <TemplatePreview node={t.tree} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
