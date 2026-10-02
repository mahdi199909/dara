"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { buildTree, progressOf, type TreeNode } from "@/lib/checklistTree";
import { CHECKLIST_NOTE_MAX_LENGTH, CHECKLIST_TITLE_MAX_LENGTH, type ChecklistItemDto } from "@/lib/schemas/checklists";
import { toPersianDigits } from "@/lib/money";
import { Card, EmptyState } from "@/components/ui/Card";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon, PlusIcon, RotateIcon, TrashIcon } from "@/components/icons";

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
  const { items, tree, loading, mutate } = useChecklists();
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

      {loading ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : tree.length === 0 ? (
        <Card>
          <EmptyState message="هنوز چک‌لیستی نساخته‌ای." />
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
  const ctx: RowContext = { run, busy };

  return (
    <div className="px-4 py-6 space-y-4">
      <Link href="/checklists" className="inline-flex items-center gap-1 text-sm text-accent">
        <ChevronRightIcon className="w-4 h-4" />
        همهٔ چک‌لیست‌ها
      </Link>

      <ListHeader list={list} done={done} total={total} ctx={ctx} onDeleted={() => router.push("/checklists")} />
      {error && <p className="text-xs text-waste">{error}</p>}

      <Card className="p-2">
        {list.children.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">هنوز موردی نیست — اولین را پایین اضافه کن.</p>
        ) : (
          <ul>
            {list.children.map((child, i) => (
              <ChecklistRow key={child.item.id} node={child} depth={0} ctx={ctx} isFirst={i === 0} isLast={i === list.children.length - 1} />
            ))}
          </ul>
        )}
        <div className="px-1 pt-2">
          <AddItems parentId={id} ctx={ctx} placeholder="مورد تازه (هر خط یک مورد)" />
        </div>
      </Card>
    </div>
  );
}

interface RowContext {
  run: (action: () => Promise<unknown>, fallback: string) => Promise<boolean>;
  busy: boolean;
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

function ChecklistRow({ node, depth, ctx, isFirst, isLast }: { node: Node; depth: number; ctx: RowContext; isFirst: boolean; isLast: boolean }) {
  const { item, children } = node;
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note ?? "");

  const hasChildren = children.length > 0;
  const doneChildren = children.filter((c) => c.item.checked).length;
  const url = `${KEY}/${item.id}`;

  return (
    <li>
      <div className="flex items-start gap-1.5 py-1.5 rounded-lg hover:bg-canvas/60" style={{ paddingRight: depth * 20 }}>
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
        <div className="flex-1 min-w-0">
          {editing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (title.trim() && (await ctx.run(() => apiPatch(url, { title, note: note.trim() || null }), "ذخیره انجام نشد."))) setEditing(false);
              }}
              className="space-y-1.5"
            >
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CHECKLIST_TITLE_MAX_LENGTH} className={inputClass} />
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={CHECKLIST_NOTE_MAX_LENGTH} rows={2} placeholder="توضیح (اختیاری)" className={`${inputClass} resize-none`} />
              <div className="flex gap-2">
                <button type="submit" className="flex-1 rounded-lg bg-accent text-on-accent py-1.5 text-xs">
                  ذخیره
                </button>
                <button type="button" onClick={() => setEditing(false)} className="px-3 rounded-lg bg-canvas text-muted text-xs">
                  انصراف
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setMenu((v) => !v)} className="block w-full text-right">
              <span className={`text-sm break-words ${item.checked ? "line-through text-muted" : "text-ink"}`}>{item.title}</span>
              {hasChildren && (
                <span className="text-[11px] text-muted mr-1.5">
                  ({toPersianDigits(String(doneChildren))}/{toPersianDigits(String(children.length))})
                </span>
              )}
              {item.note && <span className="block text-xs text-muted whitespace-pre-wrap break-words">{item.note}</span>}
            </button>
          )}
        </div>
        {!editing && (
          <button type="button" aria-label="افزودن زیرمورد" onClick={() => setAdding((v) => !v)} className="p-1 text-muted hover:text-accent shrink-0">
            <PlusIcon className="w-4 h-4" />
          </button>
        )}
      </div>

      {menu && !editing && (
        <div className="flex flex-wrap gap-1.5 pb-2" style={{ paddingRight: depth * 20 + 48 }}>
          <MenuChip
            onClick={() => {
              setMenu(false);
              setTitle(item.title);
              setNote(item.note ?? "");
              setEditing(true);
            }}
          >
            ویرایش
          </MenuChip>
          {!isFirst && <MenuChip onClick={() => void ctx.run(() => apiPatch(url, { move: "UP" }), "جابه‌جایی انجام نشد.")}>↑ بالاتر</MenuChip>}
          {!isLast && <MenuChip onClick={() => void ctx.run(() => apiPatch(url, { move: "DOWN" }), "جابه‌جایی انجام نشد.")}>↓ پایین‌تر</MenuChip>}
          {hasChildren && <MenuChip onClick={() => void ctx.run(() => apiPost(`${url}/reset`), "از نو کردن انجام نشد.")}>از نو</MenuChip>}
          <MenuChip
            danger
            onClick={() => {
              if (confirm(hasChildren ? `«${item.title}» با زیرموردهایش حذف شود؟` : `«${item.title}» حذف شود؟`)) void ctx.run(() => apiDelete(url), "حذف انجام نشد.");
            }}
          >
            حذف
          </MenuChip>
        </div>
      )}

      {adding && (
        <div className="pb-2" style={{ paddingRight: depth * 20 + 48 }}>
          <AddItems parentId={item.id} ctx={ctx} autoFocus placeholder={`زیرمورد «${item.title}»`} onDone={() => setOpen(true)} />
        </div>
      )}

      {hasChildren && open && (
        <ul>
          {children.map((child, i) => (
            <ChecklistRow key={child.item.id} node={child} depth={depth + 1} ctx={ctx} isFirst={i === 0} isLast={i === children.length - 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function MenuChip({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`px-2.5 py-1 rounded-full text-xs border ${danger ? "border-waste/40 text-waste" : "border-line text-ink bg-surface"}`}>
      {children}
    </button>
  );
}
