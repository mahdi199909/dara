import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraft, draftDays, draftKey, readDraft, writeDraft } from "./noteDrafts";

// A small stand-in for localStorage.
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  } as Storage;
}

const DAY = "2026-11-03";
const NOW = Date.UTC(2026, 10, 3, 12);

describe("note drafts", () => {
  let store: Storage;
  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps what was typed for a new note, per day", () => {
    writeDraft(DAY, null, "امروز خوب بود", undefined, NOW);
    writeDraft("2026-11-04", null, "فردا", undefined, NOW);
    expect(readDraft(DAY, null, NOW)).toBe("امروز خوب بود");
    expect(readDraft("2026-11-04", null, NOW)).toBe("فردا");
    expect(readDraft("2026-11-05", null, NOW)).toBeNull();
  });

  it("keeps an edit of a saved note apart from the new note of the same day", () => {
    writeDraft(DAY, null, "تازه", undefined, NOW);
    writeDraft(DAY, "n1", "ویرایش یک", "متن اصلی", NOW);
    writeDraft(DAY, "n2", "ویرایش دو", "متن دیگر", NOW);
    expect(readDraft(DAY, null, NOW)).toBe("تازه");
    expect(readDraft(DAY, "n1", NOW)).toBe("ویرایش یک");
    expect(readDraft(DAY, "n2", NOW)).toBe("ویرایش دو");
  });

  it("is no draft when the text is empty, or an edit that is back to the saved text", () => {
    writeDraft(DAY, null, "چیزی", undefined, NOW);
    writeDraft(DAY, null, "   ", undefined, NOW);
    expect(readDraft(DAY, null, NOW)).toBeNull();
    expect(store.getItem(draftKey(DAY, null))).toBeNull();

    writeDraft(DAY, "n1", "تغییر", "اصلی", NOW);
    expect(readDraft(DAY, "n1", NOW)).toBe("تغییر");
    writeDraft(DAY, "n1", "اصلی", "اصلی", NOW);
    expect(readDraft(DAY, "n1", NOW)).toBeNull();
  });

  it("is gone once cleared", () => {
    writeDraft(DAY, null, "نوشته", undefined, NOW);
    clearDraft(DAY);
    expect(readDraft(DAY, null, NOW)).toBeNull();
    writeDraft(DAY, "n1", "ویرایش", "اصلی", NOW);
    clearDraft(DAY, "n1");
    expect(readDraft(DAY, "n1", NOW)).toBeNull();
  });

  it("forgets a draft nobody came back to for two months, and removes it from storage", () => {
    writeDraft(DAY, null, "قدیمی", undefined, NOW);
    expect(readDraft(DAY, null, NOW + 59 * 86_400_000)).toBe("قدیمی");
    expect(readDraft(DAY, null, NOW + 61 * 86_400_000)).toBeNull();
    expect(store.getItem(draftKey(DAY, null))).toBeNull();
  });

  it("ignores a stored value that is not a draft", () => {
    store.setItem(draftKey(DAY, null), "not json");
    expect(readDraft(DAY, null, NOW)).toBeNull();
    store.setItem(draftKey(DAY, null), JSON.stringify({ text: 5, at: "x" }));
    expect(readDraft(DAY, null, NOW)).toBeNull();
  });

  it("lists the days with a draft for a new note — not edits of saved notes, not other keys", () => {
    writeDraft("2026-11-03", null, "یک", undefined, NOW);
    writeDraft("2026-11-07", null, "دو", undefined, NOW);
    writeDraft("2026-11-09", "n1", "ویرایش", "اصلی", NOW);
    store.setItem("something_else", "x");
    expect([...draftDays(NOW)].sort()).toEqual(["2026-11-03", "2026-11-07"]);
  });

  it("works as no drafts at all when storage is missing or throws", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writeDraft(DAY, null, "x", undefined, NOW)).not.toThrow();
    expect(readDraft(DAY, null, NOW)).toBeNull();
    expect(draftDays(NOW).size).toBe(0);

    const broken = {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    vi.stubGlobal("window", { localStorage: broken });
    expect(() => writeDraft(DAY, null, "x", undefined, NOW)).not.toThrow();
    expect(readDraft(DAY, null, NOW)).toBeNull();
    expect(() => clearDraft(DAY)).not.toThrow();
    expect(draftDays(NOW).size).toBe(0);
  });
});
