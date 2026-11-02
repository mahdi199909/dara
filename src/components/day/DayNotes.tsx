"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import { fetcher, apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { NOTE_MAX_LENGTH, type NoteDto } from "@/lib/schemas/notes";
import { clearDraft, readDraft, writeDraft } from "@/lib/noteDrafts";
import { Card } from "@/components/ui/Card";
import { EditIcon, TrashIcon } from "@/components/icons";

/**
 * The notes written for one calendar day. With none yet it is just a box to write in; with some it
 * lists them (each editable in place, or deletable) and offers one more. Several notes can share a
 * day — each is its own record, so notes written on two devices for the same day never collide.
 *
 * What is typed is kept as a DRAFT on this device while it is typed (src/lib/noteDrafts.ts): closing the day's
 * window, or the app, leaves it there, and reopening the day brings it back in the box. It is not in the database
 * — and so not synced — until «ثبت نوت» / «ذخیره» is pressed; «انصراف» or «حذف پیش‌نویس» throws it away.
 */
export default function DayNotes({ dayKey, highlightId, onChanged }: { dayKey: string; highlightId?: string | null; onChanged?: () => void }) {
  const url = `/api/notes?day=${dayKey}`;
  const { data, mutate } = useSWR<{ notes: NoteDto[] }>(url, fetcher);
  const notes = data?.notes ?? [];

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Something typed on an earlier visit was brought back into a box.
  const [restored, setRestored] = useState(false);

  // A draft left behind comes back once the day's notes are known: one for a new note opens the writing box with
  // it, one for the edit of a saved note reopens that note's editor. Read after mount — storage is the browser's.
  const restoredOnce = useRef(false);
  useEffect(() => {
    if (!data || restoredOnce.current) return;
    restoredOnce.current = true;
    const fresh = readDraft(dayKey);
    if (fresh !== null) {
      setDraft(fresh);
      setAdding(true);
      setRestored(true);
    }
    for (const note of data.notes) {
      const edited = readDraft(dayKey, note.id);
      if (edited !== null) {
        setEditingId(note.id);
        setEditText(edited);
        setRestored(true);
        break;
      }
    }
  }, [data, dayKey]);

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await action();
      await mutate();
      // The calendar's month grid marks the days that have notes.
      void mutateGlobal((key) => typeof key === "string" && key.startsWith("/api/notes"));
      onChanged?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setSaving(false);
    }
  }

  function changeDraft(text: string) {
    setDraft(text);
    writeDraft(dayKey, null, text);
  }

  function discardDraft() {
    clearDraft(dayKey);
    setDraft("");
    setAdding(false);
    setRestored(false);
  }

  async function add() {
    if (!draft.trim()) return;
    if (await run(() => apiPost("/api/notes", { day: dayKey, content: draft }), "ثبت نوت انجام نشد.")) {
      clearDraft(dayKey);
      setDraft("");
      setAdding(false);
      setRestored(false);
    }
  }

  function startEdit(note: NoteDto) {
    setEditingId(note.id);
    setEditText(readDraft(dayKey, note.id) ?? note.content);
  }

  function changeEdit(note: NoteDto, text: string) {
    setEditText(text);
    writeDraft(dayKey, note.id, text, note.content);
  }

  function cancelEdit(note: NoteDto) {
    clearDraft(dayKey, note.id);
    setEditingId(null);
    setRestored(false);
  }

  async function saveEdit(note: NoteDto) {
    if (!editText.trim()) return;
    if (await run(() => apiPatch(`/api/notes/${note.id}`, { content: editText }), "ذخیره نوت انجام نشد.")) {
      clearDraft(dayKey, note.id);
      setEditingId(null);
      setRestored(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("این نوت حذف شود؟")) return;
    if (await run(() => apiDelete(`/api/notes/${id}`), "حذف نوت انجام نشد.")) clearDraft(dayKey, id);
  }

  const showBox = notes.length === 0 || adding;

  return (
    <section>
      <p className="text-xs font-medium text-muted mb-1.5">نوت روز</p>
      <Card className="p-3 space-y-2.5">
        {notes.map((note) => (
          <div key={note.id} data-note-id={note.id} className={`rounded-xl ${highlightId === note.id ? "bg-accent-soft -mx-1 px-1 py-1" : ""}`}>
            {editingId === note.id ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={editText}
                  maxLength={NOTE_MAX_LENGTH}
                  onChange={(e) => changeEdit(note, e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                {editText !== note.content && (
                  <p className="text-[11px] text-muted leading-relaxed">
                    {restored ? "ویرایشی که دفعهٔ قبل نیمه‌کاره ماند برگردانده شد. " : ""}پیش‌نویس است و هنوز ذخیره نشده؛ با بستن این پنجره می‌ماند.
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={saving || !editText.trim()} onClick={() => void saveEdit(note)} className="flex-1 rounded-lg bg-accent text-on-accent py-1.5 text-xs font-medium disabled:opacity-40">
                    ذخیره
                  </button>
                  <button type="button" onClick={() => cancelEdit(note)} className="px-3 rounded-lg bg-canvas text-muted text-xs">
                    انصراف
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <p className="flex-1 min-w-0 text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">{note.content}</p>
                <div className="flex items-center shrink-0 -mt-0.5">
                  <button type="button" aria-label="ویرایش نوت" onClick={() => startEdit(note)} className="p-1.5 text-muted hover:text-ink">
                    <EditIcon className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" aria-label="حذف نوت" onClick={() => void remove(note.id)} className="p-1.5 text-waste">
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {showBox ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              maxLength={NOTE_MAX_LENGTH}
              onChange={(e) => changeDraft(e.target.value)}
              placeholder="چه گذشت؟ یادداشت این روز را بنویس…"
              rows={notes.length === 0 ? 3 : 2}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            {draft.trim() !== "" && (
              <p className="text-[11px] text-muted leading-relaxed">
                {restored ? "نوشته‌ای که دفعهٔ قبل نیمه‌کاره ماند برگردانده شد. " : ""}پیش‌نویس است و هنوز ثبت نشده؛ با بستن این پنجره می‌ماند و تا «ثبت نوت» نزنی در پایگاه‌داده نمی‌رود.
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={saving || !draft.trim()} onClick={() => void add()} className="flex-1 rounded-lg bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
                {saving ? "در حال ثبت..." : "ثبت نوت"}
              </button>
              {draft.trim() !== "" && (
                <button type="button" onClick={discardDraft} className="px-3 rounded-lg bg-canvas text-muted text-sm">
                  حذف پیش‌نویس
                </button>
              )}
              {draft.trim() === "" && notes.length > 0 && (
                <button type="button" onClick={discardDraft} className="px-3 rounded-lg bg-canvas text-muted text-sm">
                  انصراف
                </button>
              )}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-accent">
            + نوت دیگر
          </button>
        )}

        {error && <p className="text-xs text-waste">{error}</p>}
      </Card>
    </section>
  );
}
