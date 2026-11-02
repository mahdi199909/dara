// Drafts of the daily notes: what was typed into a day's note box and not yet saved with «ثبت نوت».
//
// A note is only a row in the database once the person presses save. Until then the text lives here, in the
// browser's own storage (localStorage on the web and in the app), so closing the day's window — or the app —
// does not lose it, and reopening the day brings it back. A draft is NEVER sent anywhere: it is not in the database,
// it does not sync, and it is not in a backup; only this device has it. Pressing save, or the explicit discard,
// removes it.
//
// Everything tolerates storage being unavailable or full (a private window, blocked site data): then there is
// simply no draft, and the note box works as it always did.
const PREFIX = "parva_note_draft_v1:";
/** A draft nobody came back to for this long is forgotten. */
const MAX_AGE_MS = 60 * 24 * 3_600_000;
const NEW_NOTE = "new";

interface StoredDraft {
  text: string;
  /** When it was last written, ms since the epoch. */
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The storage key of a draft: the day it belongs to, and the note being edited (none = a new note). */
export function draftKey(dayKey: string, noteId?: string | null): string {
  return `${PREFIX}${dayKey}:${noteId ?? NEW_NOTE}`;
}

/** The saved draft for a new note of this day (no `noteId`) or for the edit of one, or null. */
export function readDraft(dayKey: string, noteId?: string | null, now: number = Date.now()): string | null {
  const store = storage();
  if (!store) return null;
  const key = draftKey(dayKey, noteId);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.text !== "string" || typeof parsed.at !== "number" || parsed.text.trim() === "" || now - parsed.at > MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return parsed.text;
  } catch {
    return null;
  }
}

/**
 * Keeps `text` as the draft. Text that is empty or (for an edit) identical to the saved note is no draft at
 * all — it removes any earlier one, so a box that was cleared or typed back to the original leaves nothing behind.
 */
export function writeDraft(dayKey: string, noteId: string | null | undefined, text: string, original?: string, now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  const key = draftKey(dayKey, noteId);
  try {
    if (text.trim() === "" || (original !== undefined && text === original)) {
      store.removeItem(key);
      return;
    }
    const draft: StoredDraft = { text, at: now };
    store.setItem(key, JSON.stringify(draft));
  } catch {
    // Not remembering is fine.
  }
}

export function clearDraft(dayKey: string, noteId?: string | null): void {
  try {
    storage()?.removeItem(draftKey(dayKey, noteId));
  } catch {
    // Nothing to clear.
  }
}

/** The days that have a draft for a NEW note, as "YYYY-MM-DD" — what the calendar marks. */
export function draftDays(now: number = Date.now()): Set<string> {
  const days = new Set<string>();
  const store = storage();
  if (!store) return days;
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(PREFIX) || !key.endsWith(`:${NEW_NOTE}`)) continue;
      const day = key.slice(PREFIX.length, key.length - NEW_NOTE.length - 1);
      if (readDraft(day, null, now) !== null) days.add(day);
    }
  } catch {
    // An unreadable store has no drafts to show.
  }
  return days;
}
