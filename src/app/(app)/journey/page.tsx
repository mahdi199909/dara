"use client";

// «مسیر» — the person's days told back to them as prose, newest at the bottom (where the page opens) and older ones
// above: scrolling up loads the month before, and the one before that, until the first thing they ever recorded.
// Reached by tapping «مسیر …» in the top bar. The words come from src/lib/journeyEngine.ts (pure); this page only
// fetches the facts a month at a time (/api/journey — the web routes or the phone's own dispatcher) and lays them out.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetcher } from "@/lib/apiClient";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";
import { buildChapter, isBeforeMonth, jalaliMonthOf, monthRangeIso, previousJalaliMonth, type JalaliMonth } from "@/lib/journeyEngine";
import type { JourneyChapter, JourneyRows } from "@/lib/journeyTypes";
import JourneyChapterView from "@/components/journey/JourneyChapterView";
import { ChevronDownIcon } from "@/components/icons";

/** Start loading the earlier month when the reader is this close to the top of what is already there. */
const LOAD_OLDER_WITHIN_PX = 700;
/** Show «back to today» once the reader is this far above the bottom. */
const SHOW_JUMP_AFTER_PX = 1400;

interface LoadedChapter {
  chapter: JourneyChapter;
  /** This chapter holds the first day ever recorded — there is nothing older to load. */
  isFirst: boolean;
}

async function loadChapter(month: JalaliMonth): Promise<LoadedChapter> {
  const { from, to } = monthRangeIso(month);
  const rows = await fetcher<JourneyRows>(`/api/journey?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const chapter = buildChapter({ month, rows, now: new Date() });
  // Nothing recorded anywhere, or the first recorded day is not before this month: this is where the story begins.
  const isFirst = rows.earliestDay === null || !isBeforeMonth(rows.earliestDay, month);
  return { chapter, isFirst };
}

export default function JourneyPage() {
  // Oldest first — the order they are read in.
  const [chapters, setChapters] = useState<JourneyChapter[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const oldestMonth = useRef<JalaliMonth>(jalaliMonthOf(new Date()));
  const busy = useRef(false);
  const scrolledToEnd = useRef(false);
  // Where the reader was before older days were added above them, so the page can hold them still.
  const anchor = useRef<{ height: number; top: number } | null>(null);

  const start = useCallback(async () => {
    busy.current = true;
    setState("loading");
    setError(null);
    try {
      const month = jalaliMonthOf(new Date());
      const { chapter, isFirst } = await loadChapter(month);
      oldestMonth.current = month;
      scrolledToEnd.current = false;
      setChapters([chapter]);
      setReachedStart(isFirst);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خواندن مسیر انجام نشد.");
      setState("error");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const loadOlder = useCallback(async () => {
    if (busy.current || reachedStart) return;
    busy.current = true;
    setLoadingOlder(true);
    try {
      const month = previousJalaliMonth(oldestMonth.current);
      const { chapter, isFirst } = await loadChapter(month);
      anchor.current = { height: document.documentElement.scrollHeight, top: window.scrollY };
      oldestMonth.current = month;
      setChapters((current) => [chapter, ...current]);
      if (isFirst) setReachedStart(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خواندن ماه‌های قبل انجام نشد.");
    } finally {
      busy.current = false;
      setLoadingOlder(false);
    }
  }, [reachedStart]);

  // After every change to the chapters: open at the bottom the first time, and afterwards keep the reader where they were
  // when older days appear above them.
  useLayoutEffect(() => {
    if (chapters.length === 0) return;
    if (!scrolledToEnd.current) {
      scrolledToEnd.current = true;
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }
    if (anchor.current) {
      const { height, top } = anchor.current;
      anchor.current = null;
      window.scrollTo(0, top + (document.documentElement.scrollHeight - height));
    }
  }, [chapters]);

  // A short first month leaves the top of the page in view: keep reaching back until the screen is full.
  useEffect(() => {
    if (state !== "ready" || reachedStart || loadingOlder || error) return;
    if (document.documentElement.scrollHeight <= window.innerHeight + LOAD_OLDER_WITHIN_PX) void loadOlder();
  }, [chapters, state, reachedStart, loadingOlder, error, loadOlder]);

  useEffect(() => {
    function onScroll() {
      const fromBottom = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      setShowJump(fromBottom > SHOW_JUMP_AFTER_PX);
      if (window.scrollY < LOAD_OLDER_WITHIN_PX) void loadOlder();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [loadOlder]);

  const nothingYet = state === "ready" && reachedStart && chapters.every((c) => !c.hasContent && c.entries.length === 0);

  return (
    <div className="mx-auto max-w-2xl pt-2">
      {state === "loading" && <p className="px-4 py-16 text-center text-sm text-muted">در حال نوشتن مسیر…</p>}

      {state === "error" && (
        <div className="px-4 py-16 text-center">
          <p className="text-sm text-waste">{error}</p>
          <button type="button" onClick={() => void start()} className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90">
            دوباره تلاش کن
          </button>
        </div>
      )}

      {state === "ready" && (
        <>
          <div className="px-4 py-6 text-center text-xs leading-6 text-muted">
            {loadingOlder ? (
              "در حال خواندن روزهای قبل…"
            ) : reachedStart ? (
              <>
                <p className="font-bold text-ink">اینجا مسیر شروع می‌شود</p>
                <p>هرچه بعد از این ثبت کرده‌ام، پایین‌تر آمده است.</p>
              </>
            ) : (
              "به بالا بکش تا روزهای قبل را بخوانی"
            )}
          </div>

          {error && (
            <p className="px-4 pb-3 text-center text-xs text-waste">
              {error}{" "}
              <button type="button" className="underline" onClick={() => void loadOlder()}>
                دوباره
              </button>
            </p>
          )}

          {nothingYet ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-bold text-ink">مسیر هنوز شروع نشده</p>
              <p className="mt-2 text-sm leading-7 text-muted">
                کارهایی که تمام می‌کنی، رویدادهای تقویم، عادت‌هایی که انجام می‌دهی و یادداشت‌هایی که می‌نویسی اینجا کم‌کم به یک روایت تبدیل می‌شوند —
                به زبان خودت و به ترتیب روزها.
              </p>
            </div>
          ) : (
            chapters.map((chapter) => <JourneyChapterView key={chapter.key} chapter={chapter} />)
          )}

          {!nothingYet && (
            <p className="px-4 pb-8 pt-2 text-center text-xs leading-6 text-muted">
              امروز هنوز ادامه دارد… هرچه ثبت کنم، همین‌جا به نوشته اضافه می‌شود.
            </p>
          )}
        </>
      )}

      {showJump && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}
          style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 1rem)` }}
          className="fixed right-6 z-30 flex h-11 items-center gap-1 rounded-full bg-surface px-4 text-xs font-medium text-ink shadow-lg ring-1 ring-line hover:bg-canvas"
          aria-label="برگشت به امروز"
        >
          <ChevronDownIcon className="h-4 w-4" />
          امروز
        </button>
      )}
    </div>
  );
}
