"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { queryTerms, type SearchResult } from "@/lib/searchEngine";
import { presentSearchResult, SEARCH_GROUPS, type SearchCard, type SearchFactTone } from "@/lib/searchPresenter";
import { SearchIcon, XIcon } from "@/components/icons";
import { Card } from "@/components/ui/Card";

const TONE_CLASS: Record<SearchFactTone, string> = { positive: "text-accent", negative: "text-waste", accent: "text-accent" };
const DEBOUNCE_MS = 250;

function Highlighted({ parts }: { parts: Array<{ text: string; match: boolean }> }) {
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="bg-accent-soft text-accent rounded px-0.5">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

function ResultCard({ card }: { card: SearchCard }) {
  return (
    <Link href={card.href} className="block rounded-2xl border border-line bg-surface p-3.5 shadow-card hover:border-accent transition">
      <div className="flex items-start gap-2">
        {card.icon && <span className="text-base leading-6 shrink-0">{card.icon}</span>}
        <p className="flex-1 min-w-0 text-sm font-medium text-ink leading-6 break-words">
          <Highlighted parts={card.titleParts} />
        </p>
        {card.badges.map((b) => (
          <span key={b} className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">
            {b}
          </span>
        ))}
      </div>

      {card.snippetParts && (
        <p className="mt-1.5 text-sm text-muted leading-relaxed break-words">
          <Highlighted parts={card.snippetParts} />
        </p>
      )}

      {card.facts.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {card.facts.map((f) => (
            <div key={f.label} className={f.label === "زمان" || f.label === "آخرین بار" ? "col-span-2" : ""}>
              <dt className="text-[10px] text-muted leading-tight">{f.label}</dt>
              <dd className={`text-xs font-medium leading-snug ${f.tone ? TONE_CLASS[f.tone] : "text-ink"}`}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Link>
  );
}

function SearchPageInner() {
  const initial = useSearchParams().get("q") ?? "";
  const [text, setText] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const { format } = useCurrencyUnit();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The query is applied a moment after typing stops, and kept in the address so going back to the
  // list from a result lands on the same search.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = text.trim();
      setApplied(next);
      const url = next ? `/search?q=${encodeURIComponent(next)}` : "/search";
      window.history.replaceState(window.history.state, "", url);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const { data, error, isLoading } = useSWR<{ results: SearchResult[] }>(applied ? `/api/search?q=${encodeURIComponent(applied)}` : null, fetcher, {
    keepPreviousData: true,
  });

  const terms = useMemo(() => queryTerms(applied), [applied]);
  const groups = useMemo(() => {
    const results = data?.results ?? [];
    return SEARCH_GROUPS.map((g) => ({
      ...g,
      cards: results.filter((r) => r.type === g.type).map((r) => presentSearchResult(r, terms, (n) => format(n, { withSuffix: true }))),
    })).filter((g) => g.cards.length > 0);
  }, [data, terms, format]);
  const total = groups.reduce((sum, g) => sum + g.cards.length, 0);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="sticky top-0 z-10 -mx-4 px-4 pb-2 pt-1 bg-canvas">
        <div className="relative">
          <SearchIcon className="w-4 h-4 text-muted absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            ref={inputRef}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="جستجو در کارها، رویدادها، نوت‌ها، عادت‌ها، اقساط…"
            className="w-full rounded-2xl border border-line bg-surface py-3 pr-10 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                setText("");
                inputRef.current?.focus();
              }}
              aria-label="پاک کردن"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted p-1"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!applied ? (
        <Card className="p-5">
          <p className="text-sm text-ink font-medium">دنبال چی می‌گردی؟</p>
          <p className="text-xs text-muted mt-1.5 leading-relaxed">
            نام یک کار یا رویداد، یک عادت یا دسته‌بندی، یک قسط، یا حتی کلمه‌ای از یک نوت روزانه. هر نتیجه همان‌جا روز و ساعت، مدت، هزینه (با هزینهٔ پنهان) و جمع‌بندی‌اش را نشان می‌دهد؛ با لمس آن به همان روز یا بخش می‌روی.
          </p>
        </Card>
      ) : error ? (
        <p className="text-sm text-waste text-center py-8">جستجو انجام نشد. دوباره تلاش کنید.</p>
      ) : !data || (isLoading && total === 0) ? (
        <p className="text-sm text-muted text-center py-8">در حال جستجو…</p>
      ) : total === 0 ? (
        <p className="text-sm text-muted text-center py-8">نتیجه‌ای برای «{applied}» پیدا نشد.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.type}>
              <h2 className="text-xs font-medium text-muted mb-2">
                {g.heading} <span className="opacity-70">({g.cards.length.toLocaleString("fa-IR")})</span>
              </h2>
              <div className="space-y-2">
                {g.cards.map((card) => (
                  <ResultCard key={card.key} card={card} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the static (Android) export.
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
